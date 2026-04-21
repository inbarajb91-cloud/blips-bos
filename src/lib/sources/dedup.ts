import { createHash } from "node:crypto";

/**
 * Compute a SHA-256 content hash for dedup.
 *
 * Hashing strategy — in priority order:
 *   1. If a canonical URL exists, hash that (handles article republishing
 *      across sources — same URL = same article)
 *   2. Otherwise hash the normalized title + first 500 chars of body
 *      (handles repost variation where URLs differ slightly)
 *
 * Stored on `bunker_candidates.content_hash` with unique constraint on
 * `(org_id, content_hash)` so duplicate candidates get rejected at insert
 * time — no BUNKER extraction cost wasted on re-processing the same content.
 */
export function computeContentHash(input: {
  url?: string;
  title: string;
  body: string;
}): string {
  // Normalize URL — lowercase, strip trailing slash + query params for stability
  if (input.url) {
    try {
      const u = new URL(input.url);
      const normalized = `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
      return sha256(`url:${normalized}`);
    } catch {
      // Bad URL — fall through to content-based hash
    }
  }
  const title = input.title.trim().toLowerCase();
  const body = input.body.trim().toLowerCase().slice(0, 500);
  return sha256(`content:${title}\n${body}`);
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
