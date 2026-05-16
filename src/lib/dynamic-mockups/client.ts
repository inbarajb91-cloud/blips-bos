/**
 * Phase 11D.5 — Dynamic Mockups API client.
 *
 * Fetch-based wrapper around DM's REST surface. Reads
 * `process.env.DYNAMIC_MOCKUPS_API_KEY` for auth, never reads .env.local
 * directly. NEVER logs the key.
 *
 * The exposed surface:
 *   - listMockups()              → catalog of available templates
 *   - getMockup(uuid)            → single template detail with smart_objects
 *   - renderComposite(req)       → composite a design onto a template
 *
 * Defensive about response shape — DM has been known to wrap data in either
 * { data: [...] } or { mockups: [...] }; we accept either.
 *
 * Error handling: throws Error with provider message + HTTP status on non-2xx.
 * Inngest step retry catches transient errors in production.
 */

import {
  type MockupTemplate,
  type ListMockupsResponse,
  type RenderRequest,
  type RenderResponse,
  DM_DEFAULT_BASE_URL,
} from "./types";

const DEFAULT_TIMEOUT_MS = 60_000;

function getApiKey(): string {
  const k = process.env.DYNAMIC_MOCKUPS_API_KEY;
  if (!k || k.startsWith("REPLACE_") || k.length < 10) {
    throw new Error(
      "[dynamic-mockups] DYNAMIC_MOCKUPS_API_KEY is not set (or is a placeholder). " +
        "Set the real key in .env.local for dev and in Vercel env for production.",
    );
  }
  return k;
}

function getBaseUrl(): string {
  return process.env.DYNAMIC_MOCKUPS_API_URL ?? DM_DEFAULT_BASE_URL;
}

async function dmFetch<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-KEY": apiKey,
        ...(init.headers ?? {}),
      },
    });
  } catch (e: unknown) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) {
      throw new Error(`[dynamic-mockups] ${path} timed out`);
    }
    throw new Error(`[dynamic-mockups] network error on ${path}: ${msg}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const errSnippet = errText.slice(0, 500);
    throw new Error(
      `[dynamic-mockups] ${path} returned HTTP ${res.status}: ${errSnippet}`,
    );
  }

  return (await res.json()) as T;
}

/**
 * List all mockup templates available on the account.
 *
 * DM may paginate, in which case we'd need to walk pages. For BLIPS scale
 * (we're picking 1–5 templates total, ever), a single page is fine — most
 * accounts list under 100 templates by default.
 */
export async function listMockups(): Promise<MockupTemplate[]> {
  const json = await dmFetch<ListMockupsResponse | MockupTemplate[]>(
    "/mockups",
  );

  // DM has been known to return either { data: [...] }, { mockups: [...] }, or
  // a bare array. Handle all three.
  if (Array.isArray(json)) {
    return json;
  }
  if (Array.isArray(json.data)) {
    return json.data;
  }
  if (Array.isArray(json.mockups)) {
    return json.mockups;
  }
  // If none match, log the keys we saw and return empty — caller decides.
  console.warn(
    "[dynamic-mockups] /mockups response had unexpected shape; keys =",
    Object.keys(json),
  );
  return [];
}

/**
 * Get the full detail of one template by uuid.
 *
 * NOTE: DM's API at /api/v1/mockups/{uuid} returns 404 — the catalog list
 * endpoint already includes everything (smart_objects, print_area_presets,
 * thumbnails, etc.) in the list response. This function is implemented as
 * a client-side filter on the list result. Kept as a separate function so
 * callers don't have to know whether DM has a real detail endpoint.
 *
 * Verified May 16 against the live BLIPS DM account.
 */
export async function getMockup(uuid: string): Promise<MockupTemplate> {
  const list = await listMockups();
  const match = list.find((t) => t.uuid === uuid);
  if (!match) {
    throw new Error(`[dynamic-mockups] template ${uuid} not found in catalog`);
  }
  return match;
}

/**
 * Composite a design onto a template's smart object. The canonical BOILER
 * production path — called by the Inngest mockup-side-effect after each
 * design_version write.
 *
 * Returns the CDN URL of the composited image. Caller (Inngest handler)
 * uploads the CDN URL through Cloudinary to our own CDN for cache stability
 * (DM's CDN is fine but having it in our Cloudinary account means we can
 * apply f_auto,q_auto for WebP/AVIF delivery + we own the URL).
 */
export async function renderComposite(
  req: RenderRequest,
): Promise<RenderResponse> {
  return dmFetch<RenderResponse>("/renders", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * Health-check / probe. Used by verify scripts to confirm the API key works
 * without burning a render credit. Just hits the list endpoint and checks
 * it returns successfully.
 */
export async function probeDynamicMockups(): Promise<{
  ok: boolean;
  templateCount: number;
}> {
  const list = await listMockups();
  return { ok: true, templateCount: list.length };
}
