/**
 * REVIEW.md F12 (May 18, 2026) — slugify titles + well-known pipeline slugs.
 *
 * Why: FURNACE + BOILER pipeline stages used to fetch knowledge docs via
 * `ilike(title, "RCK Decade Playbook")`. Two problems:
 *   (1) `_` and `%` in titles match anything — wildcard footgun
 *   (2) Renaming a doc in the UI silently broke pipeline lookups; the
 *       brief would generate with empty playbook context.
 *
 * Fix: every knowledge doc auto-gets a stable `slug` derived from its
 * title on creation. Pipeline callers query by slug. Title is display-only.
 *
 * Convention: lowercase, non-alphanumeric → underscore, runs collapsed.
 *   "RCK Decade Playbook" → "rck_decade_playbook"
 *   "BLIPS Materials Playbook" → "blips_materials_playbook"
 *   "  Hello, World!  " → "hello_world"
 */

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "_") // non-alnum → underscore
    .replace(/^_+|_+$/g, "") // trim leading/trailing underscores
    .slice(0, 80); // cap at 80 chars for sanity
}

/**
 * Well-known slugs the pipeline depends on. If you rename a doc in the
 * UI, the slug stays the same (it was set at creation). If you delete and
 * re-create with a different title, the new slug won't match these — the
 * pipeline call returns empty content and the LLM stage runs context-less.
 *
 * Founder convention: when creating these specific docs via the Knowledge
 * UI, use these exact titles (which slugify to the well-known forms below)
 * — or pass the slug explicitly via createKnowledgeDocument.
 */
export const WELL_KNOWN_SLUGS = {
  /** Per-decade design + cohort playbook. STOKER + FURNACE + BOILER consume. */
  DECADE_PLAYBOOK_RCK: "rck_decade_playbook",
  DECADE_PLAYBOOK_RCL: "rcl_decade_playbook",
  DECADE_PLAYBOOK_RCD: "rcd_decade_playbook",
  /** BLIPS brand-identity reference. FURNACE consumes for brand-fit scoring. */
  BLIPS_BRAND_IDENTITY: "blips_brand_identity",
  /** Materials + finishes vocabulary. FURNACE consumes for tactileIntent. */
  BLIPS_MATERIALS_PLAYBOOK: "blips_materials_playbook",
  /** Fashion design + digital tools playbook. BOILER v2 consumes for
   *  design prompt construction. */
  FASHION_SKILLS: "fashion_design_digital_tools_playbook",
} as const;

export type WellKnownSlug = (typeof WELL_KNOWN_SLUGS)[keyof typeof WELL_KNOWN_SLUGS];

/** Helper: get the decade-playbook slug by decade key. */
export function decadePlaybookSlug(decade: "RCK" | "RCL" | "RCD"): string {
  switch (decade) {
    case "RCK":
      return WELL_KNOWN_SLUGS.DECADE_PLAYBOOK_RCK;
    case "RCL":
      return WELL_KNOWN_SLUGS.DECADE_PLAYBOOK_RCL;
    case "RCD":
      return WELL_KNOWN_SLUGS.DECADE_PLAYBOOK_RCD;
  }
}
