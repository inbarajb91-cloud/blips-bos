/**
 * Pure shortcode collision resolver.
 *
 * BUNKER assigns shortcodes algorithmically and can produce duplicates
 * (especially on shared themes like ROOTS, CLOCK, LEGACY). The signals
 * table has a UNIQUE constraint on (org_id, shortcode), so a duplicate
 * insert crashes the approve flow.
 *
 * Strategy: given a base shortcode and the set of already-taken codes
 * in the same org, return base if free, else base-2 / base-3 / ... up
 * to base-99, with a random suffix as a paranoia ceiling.
 *
 * Pure function — no DB access — so it's testable in isolation. The
 * runtime caller (approveCandidate in src/lib/actions/candidates.ts)
 * does the DB query to build the `taken` set, then calls this. Phase 8
 * evals (scripts/phase-8-evals.ts) build a fake taken set and call
 * this directly.
 *
 * Pre-CodeRabbit-pass-1, this logic was inlined in candidates.ts and
 * the eval reimplemented it locally — meaning the eval could pass
 * even if the runtime version diverged from what the test verified.
 * Extracting both to use this single source of truth fixes that.
 */
export function resolveShortcode(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;

  // Try -2, -3, … up to -99. In practice we'll find an opening in the
  // first few attempts; 99 is a paranoia ceiling.
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Pathological: 99 same-base shortcodes already exist. Append a
  // random suffix so we never return undefined or throw.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}
