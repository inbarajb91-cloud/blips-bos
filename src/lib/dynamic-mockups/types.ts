/**
 * Phase 11D.5 — Dynamic Mockups API types.
 *
 * DM publishes a REST API at api.dynamicmockups.com. We hit two main surfaces:
 *   - GET  /api/v1/mockups            → list available mockup templates
 *   - GET  /api/v1/mockups/{uuid}     → get one template's smart_objects
 *   - POST /api/v1/renders            → composite a design onto a template
 *
 * Auth: X-API-KEY header. Key lives in process.env.DYNAMIC_MOCKUPS_API_KEY.
 *
 * Response shapes documented here are based on DM's published API spec; we
 * code defensively (optional fields, fall-through on unknown shape) so the
 * discovery script can tell us if the actual shape drifts.
 */

/**
 * Print area preset — a sub-zone within a smart object that defines where
 * the design lands. DM templates can have multiple presets (e.g. Center,
 * Left Chest, Across Back) — we pick the right one per design at render time.
 */
export interface PrintAreaPreset {
  uuid: string;
  name?: string; // "Center", "Left Chest", "Full Front", etc.
  size?: { width: number; height: number };
  position?: { top: number; left: number };
  thumbnails?: Array<{ width: number; url: string }>;
}

/**
 * A "smart object" is a garment zone in the template. For a tee mockup this
 * is typically the whole shirt — DM puts the design into one of the smart
 * object's `print_area_presets` to control where on the shirt it lands.
 */
export interface SmartObject {
  uuid: string;
  /** Human-readable name from DM — e.g. "T-shirt", "Chest Print", "Back Print". */
  name?: string;
  /** Dimensions of the smart object zone (pixels in the mockup image). */
  size?: { width: number; height: number };
  /** Top-left position of the smart object within the mockup image. */
  position?: { top: number; left: number };
  /** Sub-presets — where on the smart object the design lands. */
  print_area_presets?: PrintAreaPreset[];
}

/**
 * Thumbnail variant — DM serves multiple sizes for responsive UIs.
 */
export interface ThumbnailVariant {
  width: number;
  url: string;
}

/**
 * A mockup template. Shape matches the actual DM /api/v1/mockups response
 * (validated May 16 against the live account). DM's response is slim — many
 * "expected" fields like category, recolor_supported, view, tags don't exist
 * in the list response; what's actually populated:
 *   - uuid, name, type, thumbnail (string URL), thumbnails (array of sizes),
 *     smart_objects[] (with print_area_presets[] inside), text_layers[], collections[]
 */
export interface MockupTemplate {
  uuid: string;
  /** Display name from DM, e.g. "afternoon walk". */
  name: string;
  /** Template type — DM uses "classic" for stock mockups. */
  type?: string;
  /** Single primary thumbnail URL (S3-hosted JPEG). */
  thumbnail?: string;
  /** Array of size-tagged thumbnails (WebP, 240/480/720 widths). */
  thumbnails?: ThumbnailVariant[];
  /** Smart object zones — the garment regions where designs get composited. */
  smart_objects?: SmartObject[];
  /** Optional text layer overlays. Empty for most product mockups. */
  text_layers?: unknown[];
  /** Collection membership in DM's organization. */
  collections?: unknown[];
}

/**
 * Response shape from GET /api/v1/mockups. DM commonly wraps in { data: [...], meta: {...} }
 * for pagination but variants exist; we accept either.
 */
export interface ListMockupsResponse {
  data?: MockupTemplate[];
  mockups?: MockupTemplate[];
  meta?: {
    total?: number;
    page?: number;
    per_page?: number;
  };
}

/**
 * Render request — sent to POST /api/v1/renders. Composites a design (URL or base64)
 * onto a template's smart object, optionally recoloring the garment.
 */
export interface RenderRequest {
  mockup_uuid: string;
  smart_objects: Array<{
    uuid: string;
    asset: string; // URL or data: URI
    color?: string; // hex with leading #, when recolor_supported
  }>;
  /** Output format. */
  format?: "png" | "jpg" | "webp";
  /** Output dimensions. Caps at 4096×4096 on DM's free + standard tiers. */
  width?: number;
  height?: number;
}

export interface RenderResponse {
  /** The CDN-hosted render URL (HTTPS, served from DM's edge cache). */
  url?: string;
  render_url?: string;
  /** Render id for traceability. */
  uuid?: string;
  id?: string;
  /** Echo of the dimensions DM produced. */
  width?: number;
  height?: number;
}

/**
 * Default API base URL. Override via env var DYNAMIC_MOCKUPS_API_URL if DM
 * publishes a region-specific endpoint or if we ever proxy through Cloudflare.
 */
export const DM_DEFAULT_BASE_URL = "https://app.dynamicmockups.com/api/v1";
