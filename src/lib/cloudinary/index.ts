import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary upload boundary — Phase 11C.1.
 *
 * Single module everything that touches Cloudinary goes through. Reads
 * `CLOUDINARY_URL` from env (format: `cloudinary://<key>:<secret>@<cloud_name>`)
 * and lazily configures the SDK on first call.
 *
 * Why a single boundary: keeps the BOILER handler + the backfill script +
 * any future ENGINE/PROPELLER image flows reading from one place. If we
 * ever swap providers (R2, S3, Bunny) or migrate accounts, the change is
 * scoped here.
 *
 * Fallback discipline: when `CLOUDINARY_URL` is missing (local dev, test
 * env), `isCloudinaryConfigured()` returns false and callers can choose
 * to fall back to inline base64 storage gracefully — for local DX only.
 * In production, the BOILER handler treats Cloudinary as required;
 * upload failures propagate and Inngest's retry path handles them, with
 * the onFailure hook persisting a marker row after retries exhaust.
 *
 * Resource awareness (per MEMORY.md "Free-tier limits + design-rule
 * discipline"):
 *   - Free tier: 25 GB storage · 25 GB bandwidth/mo · 25 credits/mo.
 *   - 1 credit = 1 transformation OR ~1000 cached image views.
 *   - `f_auto,q_auto` is mandatory on every delivery URL (saves ~30-70%
 *     bandwidth via WebP/AVIF). Bake into URL builder so it's not
 *     optional per-call — see `getOptimizedUrl()`.
 */

let configured = false;

/** Lazy-init the Cloudinary SDK from CLOUDINARY_URL. Returns whether
 *  the env is set + the SDK is now configured. Safe to call repeatedly. */
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!process.env.CLOUDINARY_URL) return false;
  // Calling config() with no args makes the SDK auto-parse CLOUDINARY_URL.
  cloudinary.config();
  configured = true;
  return true;
}

export interface CloudinaryUploadResult {
  /** Full HTTPS delivery URL (secure_url). NOT yet transformed; pass
   *  through `getOptimizedUrl()` before storing as `<img src>` so the
   *  `f_auto,q_auto` transformations are applied. */
  rawUrl: string;
  /** Optimized delivery URL with `/f_auto,q_auto/` injected after
   *  `/upload/`. Use this as the canonical `imageUrl` we store on
   *  variant rows + serve to browsers. */
  optimizedUrl: string;
  /** Hierarchical public id (e.g. "blips/boiler/POLANX-RCL/variant-1").
   *  Stored alongside the URL so future operations (delete, transform-
   *  override, etc.) don't have to parse it back out of the URL. */
  publicId: string;
  /** Asset format the server stored — usually "png" for BOILER, may differ
   *  if Cloudinary chose to recompress. */
  format: string;
  /** Stored size in bytes — useful for usage tracking later. */
  bytes: number;
  /** Stored dimensions. */
  width: number;
  height: number;
}

export interface UploadBase64ImageOptions {
  /** Hierarchical folder (e.g. "blips/boiler/POLANX-RCL"). The public id
   *  is folder + "/" + publicIdHint. */
  folder: string;
  /** Suggested asset name (e.g. "variant-1"). Combined with `folder`
   *  to form the public id. Same hint on re-upload → overwrite. */
  publicIdHint: string;
  /** Whether to overwrite an existing asset with the same public id.
   *  Defaults to true — re-runs of BOILER regenerate the gallery, so
   *  we want newest to win rather than accumulating versions. Set to
   *  false if you genuinely want a new asset per call. */
  overwrite?: boolean;
}

/**
 * Upload a base64-encoded PNG to Cloudinary. The base64 string should be
 * the bare data (no `data:image/png;base64,` prefix) — we add the data-URI
 * wrapper here.
 *
 * Throws on:
 *   - CLOUDINARY_URL missing (caller should check `isCloudinaryConfigured()`
 *     first if it wants to fall back)
 *   - Network or API errors from Cloudinary
 *   - Auth errors (bad key/secret)
 *
 * Throwing is the right policy in production — Inngest's retry will catch
 * transient errors, and onFailure persists a marker row after retries
 * exhaust. Silent fallback to inline base64 in production would re-create
 * the Fast Origin Transfer problem this whole change is meant to fix.
 */
export async function uploadBase64Image(
  base64: string,
  options: UploadBase64ImageOptions,
): Promise<CloudinaryUploadResult> {
  if (!ensureConfigured()) {
    throw new Error(
      "[cloudinary] CLOUDINARY_URL not set — cannot upload. " +
        "Set it in .env.local + Vercel env (Production + Preview).",
    );
  }

  const dataUri = `data:image/png;base64,${base64}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: options.folder,
    public_id: options.publicIdHint,
    overwrite: options.overwrite ?? true,
    resource_type: "image",
    // Keep the upload itself untransformed — transformations applied at
    // delivery time via getOptimizedUrl() so caching works per-format.
  });

  const rawUrl = result.secure_url;
  return {
    rawUrl,
    optimizedUrl: getOptimizedUrl(rawUrl),
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}

/**
 * Inject `/f_auto,q_auto/` between `/upload/` and the version path in a
 * Cloudinary secure URL. This serves WebP/AVIF to browsers that support
 * them (transparently falls back to PNG/JPG) + picks the optimal quality
 * for the content. Result is cached per-format at Cloudinary's edge after
 * first delivery.
 *
 * Idempotent: if `f_auto,q_auto` is already present, returns the URL
 * unchanged (cheap regex check). Safe to call on already-optimized URLs.
 */
export function getOptimizedUrl(secureUrl: string): string {
  if (secureUrl.includes("/f_auto,q_auto/")) return secureUrl;
  return secureUrl.replace("/upload/", "/upload/f_auto,q_auto/");
}

/**
 * Whether the Cloudinary SDK is configured and ready to upload. Used by
 * callers (BOILER handler) that want to fall back to inline base64 in
 * local dev when CLOUDINARY_URL isn't set.
 *
 * Note: returns false on first call if env is missing; subsequent calls
 * return the cached value. Always returns true once configure has succeeded.
 */
export function isCloudinaryConfigured(): boolean {
  return ensureConfigured();
}

/**
 * Delete a Cloudinary asset by public id. Best-effort — never throws,
 * logs a warning on failure. Designed for cleanup paths (manifestation
 * dismissed, gallery regenerated, etc.) where a failed delete shouldn't
 * block the surrounding operation.
 *
 * Returns true on success, false on any failure (including SDK not
 * configured — there's nothing to delete in that case anyway).
 */
export async function deleteAsset(publicId: string): Promise<boolean> {
  if (!ensureConfigured()) return false;
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok";
  } catch (e) {
    console.warn(
      `[cloudinary] delete failed for ${publicId}:`,
      (e as Error).message,
    );
    return false;
  }
}
