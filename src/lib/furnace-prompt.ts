/**
 * FURNACE brief → consolidated design-generation prompt.
 *
 * Phase 10.5 — a "Download prompt" affordance on the FURNACE tab. FURNACE
 * produces a structured 10-section visual-design brief; BOILER consumes
 * that internally to render concepts. This util flattens the same brief
 * into a single self-contained markdown prompt the founder can take
 * OUTSIDE the pipeline — paste into an external image tool, hand to a
 * human designer, or keep as a record.
 *
 * Deliberately deterministic + pure (no LLM, no network). The FURNACE
 * sections are already rich descriptive prose written for exactly this
 * purpose; consolidating them in BOILER's reading order with the signal
 * context as a header IS a generation prompt. An LLM-polished variant
 * was considered and deferred — it adds latency, token cost, and a
 * failure surface for marginal "prompt-shaped-ness" gain.
 *
 * Plain TS (no "use server") so the client renderer imports it freely.
 */

/** The decade cohort keys STOKER scores against. */
export type FurnacePromptDecade = "RCK" | "RCL" | "RCD";

/** Human-readable decade label for the prompt header. */
const DECADE_LABELS: Record<FurnacePromptDecade, string> = {
  RCK: "RCK (28–38)",
  RCL: "RCL (38–48)",
  RCD: "RCD (48–58)",
};

/**
 * The brief's section fields + brand-fit metadata. Mirrors the
 * `BriefContent` shape the FURNACE renderer holds; redefined here (not
 * imported) so this lib stays decoupled from the renderer component.
 */
export interface FurnacePromptContent {
  brandFitScore?: number;
  brandFitRationale?: string | null;
  refused?: boolean;
  designDirection?: string | null;
  tactileIntent?: string | null;
  moodAndTone?: string | null;
  compositionApproach?: string | null;
  colorTreatment?: string | null;
  typographicTreatment?: string | null;
  artDirection?: string | null;
  referenceAnchors?: string | null;
  placementIntent?: string | null;
  voiceInVisual?: string | null;
  addenda?: Array<{
    label: string;
    content: string;
    addedBy?: string;
    reason?: string;
  }>;
}

/** Signal + manifestation context that frames the brief. */
export interface FurnacePromptContext {
  /** The manifestation child this brief belongs to. */
  manifestationShortcode: string;
  manifestationTitle: string;
  decade: FurnacePromptDecade;
  /** The parent cultural signal the manifestation descends from. */
  parentShortcode: string;
  parentWorkingTitle: string;
  parentConcept: string | null;
}

/**
 * The 10 sections in BOILER's reading order, with the labels the
 * renderer uses. designDirection is the hero and leads; the rest flow
 * from physical feel → composition → color → type → art → references →
 * placement → voice, which is the order a designer (or image model)
 * benefits from reading them in.
 */
const SECTION_ORDER: Array<{
  key: keyof FurnacePromptContent;
  label: string;
}> = [
  { key: "designDirection", label: "Design direction" },
  { key: "tactileIntent", label: "Tactile intent" },
  { key: "moodAndTone", label: "Mood + tone" },
  { key: "compositionApproach", label: "Composition approach" },
  { key: "colorTreatment", label: "Color treatment" },
  { key: "typographicTreatment", label: "Typographic treatment" },
  { key: "artDirection", label: "Art direction" },
  { key: "referenceAnchors", label: "Reference anchors" },
  { key: "placementIntent", label: "Placement intent" },
  { key: "voiceInVisual", label: "Voice in visual" },
];

/**
 * Build the consolidated design-generation prompt as a markdown string.
 *
 * Returns a complete, self-contained document: signal context header,
 * the 10 visual-design sections in order, any ORC/founder addenda, and
 * a brand-fit footer. Safe to call on any non-refused brief; sections
 * that are somehow null are skipped rather than emitted empty.
 */
export function buildFurnacePrompt(
  content: FurnacePromptContent,
  context: FurnacePromptContext,
): string {
  const lines: string[] = [];

  // ─── Header — what this design IS, and where it came from ──────
  lines.push(`# Design Generation Prompt — ${context.manifestationShortcode}`);
  lines.push("");
  lines.push(`**Manifestation:** ${context.manifestationTitle}`);
  lines.push(`**Decade cohort:** ${DECADE_LABELS[context.decade]}`);
  lines.push(
    `**Origin signal:** ${context.parentWorkingTitle} (${context.parentShortcode})`,
  );
  if (context.parentConcept && context.parentConcept.trim().length > 0) {
    lines.push("");
    lines.push(`> ${context.parentConcept.trim()}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ─── The 10 visual-design sections, in reading order ───────────
  for (const { key, label } of SECTION_ORDER) {
    const value = content[key];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    lines.push(`## ${label}`);
    lines.push("");
    lines.push(value.trim());
    lines.push("");
  }

  // ─── Addenda — ORC/founder-added sections beyond the core 10 ────
  if (content.addenda && content.addenda.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Addenda");
    lines.push("");
    for (const addendum of content.addenda) {
      lines.push(`### ${addendum.label}`);
      lines.push("");
      lines.push(addendum.content.trim());
      lines.push("");
    }
  }

  // ─── Footer — brand-fit provenance ─────────────────────────────
  lines.push("---");
  lines.push("");
  const scoreText =
    typeof content.brandFitScore === "number"
      ? `${content.brandFitScore}/100`
      : "n/a";
  lines.push(`_Brand-fit: ${scoreText}_`);
  if (content.brandFitRationale && content.brandFitRationale.trim().length > 0) {
    lines.push(`_${content.brandFitRationale.trim()}_`);
  }
  lines.push("_Consolidated from the FURNACE visual-design brief · BLIPS Engine Room_");
  lines.push("");

  return lines.join("\n");
}

/**
 * Download filename for a manifestation's consolidated prompt.
 * Example: `FURNACE-prompt-POLANX-RCL.md`
 */
export function furnacePromptFilename(manifestationShortcode: string): string {
  // Shortcodes are already filesystem-safe (uppercase alnum + dash), but
  // sanitize defensively in case an addendum-era shortcode ever isn't.
  const safe = manifestationShortcode.replace(/[^A-Za-z0-9._-]/g, "_");
  return `FURNACE-prompt-${safe}.md`;
}
