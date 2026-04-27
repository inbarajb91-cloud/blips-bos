/**
 * Simple in-memory sliding-window rate limiter — Phase 8G.
 *
 * Scope: Phase 8 single-user (Inba). 30 requests/minute/user on the
 * /api/orc/reply endpoint, protecting against:
 *   - accidental frontend loops (stream abort handling bugs)
 *   - browser rapid-click on the Send button while ORC is replying
 *   - future multi-user abuse patterns when DECK ships
 *
 * Implementation notes:
 *   - In-memory Map keyed by userId, value is the array of request
 *     timestamps (ms) within the current window
 *   - On each check, drop timestamps older than the window
 *   - Return allow/deny + the retry-after hint if denied
 *   - Cleanup happens lazily inside `check()` — no separate interval
 *     needed, so no cold-start hazard on serverless
 *
 * Known limitations:
 *   - Each Vercel serverless instance keeps its own Map, so at scale
 *     a user could exceed the limit across N instances. Acceptable
 *     at Phase 8 single-user scale. Migrate to DB-backed counters
 *     (rate_limit_buckets table with SELECT FOR UPDATE + INSERT, or
 *     a jsonb counter column with atomic `||` append) when teams
 *     ship and this matters.
 *   - On cold start the Map is empty, so the first request after a
 *     long idle always passes. That's fine — we want generous
 *     cold-start behavior anyway.
 */

/** Per-endpoint config lives here so callers don't guess. */
export const ORC_REPLY_LIMIT = {
  requests: 30,
  windowMs: 60_000,
} as const;

interface WindowState {
  /** Ascending timestamps of requests still inside the window. */
  timestamps: number[];
}

/**
 * Map of "endpoint:userId" keys to their sliding window state.
 * Single global Map — all endpoints share the structure, namespaced
 * by key prefix.
 */
const windows = new Map<string, WindowState>();

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the window after this check. */
  remaining: number;
  /** When the earliest relevant timestamp expires, in ms. */
  retryAfterMs: number;
}

export interface RateLimitParams {
  /** Namespace for the limit (e.g. "orc-reply"). */
  endpoint: string;
  /** Identity to limit against — userId or IP or similar. */
  identity: string;
  /** Max requests allowed in the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

/**
 * Check + record a request for (endpoint, identity). Returns whether
 * the request is allowed. When denied, the caller should return
 * HTTP 429 with the retryAfterMs hint.
 */
export function checkRateLimit(params: RateLimitParams): RateLimitResult {
  const key = `${params.endpoint}:${params.identity}`;
  const now = Date.now();
  const windowStart = now - params.windowMs;

  const state = windows.get(key) ?? { timestamps: [] };

  // Drop expired timestamps. They're sorted ascending, so we can
  // scan from the front until we find one inside the window.
  const kept: number[] = [];
  for (const t of state.timestamps) {
    if (t > windowStart) kept.push(t);
  }
  state.timestamps = kept;

  if (kept.length >= params.limit) {
    // Denied. The earliest timestamp dictates when this user can
    // try again (that one has to fall out of the window first).
    const earliest = kept[0];
    const retryAfterMs = Math.max(0, earliest + params.windowMs - now);
    // Don't record this denied attempt so a loop of denied calls
    // doesn't extend the window indefinitely.
    windows.set(key, state);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  // Allowed. Record this timestamp.
  state.timestamps.push(now);
  windows.set(key, state);

  return {
    allowed: true,
    remaining: params.limit - state.timestamps.length,
    retryAfterMs: 0,
  };
}

/**
 * Helper for the ORC reply endpoint specifically. Keeps the default
 * 30/min config in one place.
 */
export function checkOrcReplyRateLimit(userId: string): RateLimitResult {
  return checkRateLimit({
    endpoint: "orc-reply",
    identity: userId,
    limit: ORC_REPLY_LIMIT.requests,
    windowMs: ORC_REPLY_LIMIT.windowMs,
  });
}
