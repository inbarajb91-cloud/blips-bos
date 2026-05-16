/**
 * Phase 11D — BOILER v2 prompt construction.
 *
 * Pure function. Takes a FURNACE brief + locked palette roles + composition meta
 * + (optional) refinement instruction and produces a single gpt-image-2 prompt
 * string. No LLM call here — the prompt is deterministic given the inputs.
 *
 * Why pure: easy to unit-test, easy to audit, easy to show the founder the
 * actual prompt that produced a design (persisted as design_versions.prompt_used).
 *
 * The output prompt structure is one coherent description, not a templated
 * variable substitution. Structure mirrors the BLIPS-DESIGN-CALIBRATION.md
 * anchor (PAPER-RCK) — six explicit dimensions: garment, composition, elements,
 * palette, typography, print spec.
 *
 * Refinement chains: when input.refinementInstruction + input.parent are set,
 * the prompt is much terser (focuses on the change, not the full brief) because
 * gpt-image-2 sees the previous version via `previous_response_id`. This is how
 * "tighten the type column, push the square down" stays a 1-line refinement
 * rather than a re-statement of the whole design.
 */

import type {
  GenerateDesignInput,
  PaletteRoles,
  CompositionMeta,
} from "./types";

/** Build the gpt-image-2 prompt for a fresh generation (no parent). */
function buildFreshPrompt(input: GenerateDesignInput): string {
  const { context, furnaceBrief, paletteRoles, compositionMeta } = input;
  const { decadePlaybook, brandIdentity, materialsVocabulary, fashionSkills } =
    input.knowledgeContext ?? {};

  const knowledge = (label: string, body: string | undefined): string => {
    const trimmed = (body ?? "").trim();
    return trimmed.length > 0 ? `\n${label}\n${trimmed}\n` : "";
  };

  return [
    `Design a single-piece BLIPS flat artwork (transparent background, ready for print) for the following manifestation. This is a PREMIUM APPAREL DESIGN — multi-element composition with conceptual logic, NOT a wordmark on a solid tee.`,
    ``,
    `## MANIFESTATION`,
    `Shortcode: ${context.shortcode}`,
    `Decade: ${context.manifestationDecade} · Season: ${context.season}`,
    `Framing hook: ${context.framingHook}`,
    ``,
    `## DESIGN DIRECTION (from FURNACE brief — read carefully)`,
    `Brand-fit score: ${furnaceBrief.brandFitScore}/100`,
    `Brand-fit rationale: ${furnaceBrief.brandFitRationale}`,
    ``,
    `Design direction: ${furnaceBrief.designDirection}`,
    `Tactile intent: ${furnaceBrief.tactileIntent}`,
    `Mood + tone: ${furnaceBrief.moodAndTone}`,
    `Composition approach: ${furnaceBrief.compositionApproach}`,
    `Color treatment: ${furnaceBrief.colorTreatment}`,
    `Typographic treatment: ${furnaceBrief.typographicTreatment}`,
    `Art direction: ${furnaceBrief.artDirection}`,
    `Reference anchors: ${furnaceBrief.referenceAnchors}`,
    `Placement intent: ${furnaceBrief.placementIntent}`,
    `Voice in visual: ${furnaceBrief.voiceInVisual}`,
    ...(furnaceBrief.addenda.length > 0
      ? [
          ``,
          `## ADDENDA (founder-added direction)`,
          ...furnaceBrief.addenda.map(
            (a) => `- ${a.label}: ${a.content}`,
          ),
        ]
      : []),
    ``,
    `## LOCKED PALETTE — use these hex codes exactly, in their stated roles`,
    `Garment base: ${paletteRoles.garment_base}`,
    `Ring outer / outermost graphic element: ${paletteRoles.ring_outer}`,
    `Ring inner / inner glow / accent: ${paletteRoles.ring_inner}`,
    `Front ink (front-face text + foreground): ${paletteRoles.front_ink}`,
    `Back ink (back-face text + accent): ${paletteRoles.back_ink}`,
    ``,
    `## COMPOSITION META`,
    formatCompositionMeta(compositionMeta),
    ``,
    `## OUTPUT REQUIREMENTS`,
    `- TRANSPARENT BACKGROUND. The artwork is composited onto a garment template at the mockup stage — do NOT render the tee silhouette, do NOT render a background of any kind. Only the design elements on a transparent canvas.`,
    `- Multi-element composition. NOT typography alone. NOT a centered logo on white. Multiple visual elements composing one conceptual idea (matching the FURNACE composition approach above).`,
    `- Hex palette used precisely. Do not substitute "close" colors.`,
    `- Typography rendered as actual type, not approximated. Weight + tracking per the FURNACE typographic treatment.`,
    `- Flat / screen-print-ready aesthetic. No photographic gradients. No halftones unless the FURNACE brief explicitly calls for them.`,
    `- The work and the thinking is visible in the design. Someone looking at this should feel that work went into it.`,
    knowledge(`## DECADE PLAYBOOK (${context.manifestationDecade})`, decadePlaybook),
    knowledge(`## BLIPS BRAND IDENTITY`, brandIdentity),
    knowledge(`## MATERIALS VOCABULARY`, materialsVocabulary),
    knowledge(`## FASHION DESIGN + DIGITAL TOOLS PLAYBOOK`, fashionSkills),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Build the gpt-image-2 prompt for a refinement (chained from parent). */
function buildRefinementPrompt(input: GenerateDesignInput): string {
  const { paletteRoles, compositionMeta, refinementInstruction } = input;
  if (!refinementInstruction) {
    throw new Error(
      "[boiler] buildRefinementPrompt called without refinementInstruction",
    );
  }

  // gpt-image-2 sees the previous design via previous_response_id, so this prompt
  // is much terser — focuses on what to change, not what to keep.
  return [
    `Refine the previous BLIPS design with the following adjustment. Keep EVERYTHING ELSE unchanged — palette roles, composition, typography, placement.`,
    ``,
    `## ADJUSTMENT`,
    refinementInstruction,
    ``,
    `## INVARIANTS (these stay locked)`,
    `Garment base: ${paletteRoles.garment_base}`,
    `Ring outer: ${paletteRoles.ring_outer}`,
    `Ring inner: ${paletteRoles.ring_inner}`,
    `Front ink: ${paletteRoles.front_ink}`,
    `Back ink: ${paletteRoles.back_ink}`,
    ``,
    formatCompositionMeta(compositionMeta),
    ``,
    `Output remains: single-piece flat artwork, transparent background, multi-element composition. Apply only the requested adjustment.`,
  ].join("\n");
}

/** Build the gpt-image-2 prompt for branching (fork from older parent, no instruction). */
function buildBranchPrompt(input: GenerateDesignInput): string {
  const { paletteRoles, compositionMeta } = input;

  // Branching: re-emit the locked invariants without the refinement instruction.
  // gpt-image-2 sees the parent version via previous_response_id and produces
  // a parallel design at the same parameters. Useful when the founder wants
  // an alternative direction from an earlier version.
  return [
    `Produce an alternative variation of the previous BLIPS design. Same palette, same composition rules, same typography spec — but explore a different sub-arrangement of the elements within those constraints. This is a parallel exploration, NOT a refinement.`,
    ``,
    `## LOCKED PALETTE`,
    `Garment base: ${paletteRoles.garment_base}`,
    `Ring outer: ${paletteRoles.ring_outer}`,
    `Ring inner: ${paletteRoles.ring_inner}`,
    `Front ink: ${paletteRoles.front_ink}`,
    `Back ink: ${paletteRoles.back_ink}`,
    ``,
    formatCompositionMeta(compositionMeta),
    ``,
    `Output: single-piece flat artwork, transparent background, multi-element composition.`,
  ].join("\n");
}

/** Render the composition_meta JSONB as a prompt-friendly description. */
function formatCompositionMeta(meta: CompositionMeta): string {
  const parts: string[] = [];

  if (meta.exact_text) {
    const t = meta.exact_text;
    const lines = [
      t.front ? `  Front: "${t.front}"` : null,
      t.back ? `  Back: "${t.back}"` : null,
    ].filter(Boolean);
    if (lines.length > 0) {
      parts.push(`Exact text content:\n${lines.join("\n")}`);
    }
  }

  if (meta.typography) {
    const t = meta.typography;
    const lines = [
      t.front_weight !== undefined
        ? `  Front weight: ${t.front_weight}${
            t.front_tracking ? `, tracking: ${t.front_tracking}` : ""
          }`
        : null,
      t.back_weight !== undefined
        ? `  Back weight: ${t.back_weight}${
            t.back_tracking ? `, tracking: ${t.back_tracking}` : ""
          }`
        : null,
    ].filter(Boolean);
    if (lines.length > 0) {
      parts.push(`Typography spec:\n${lines.join("\n")}`);
    }
  }

  if (meta.composition_rules) {
    const rules = Object.entries(meta.composition_rules)
      .map(([k, v]) => `  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
    if (rules.length > 0) {
      parts.push(`Composition rules:\n${rules}`);
    }
  }

  if (meta.print_spec) {
    const p = meta.print_spec;
    const lines = [
      p.method ? `  Print method: ${p.method}` : null,
      p.separations !== undefined ? `  Color separations: ${p.separations}` : null,
      p.halftones !== undefined ? `  Halftones: ${p.halftones ? "yes" : "no"}` : null,
      p.full_bleed !== undefined
        ? `  Full bleed: ${p.full_bleed ? "yes — design extends off all edges" : "no — anchored composition"}`
        : null,
    ].filter(Boolean);
    if (lines.length > 0) {
      parts.push(`Print spec:\n${lines.join("\n")}`);
    }
  }

  return parts.join("\n");
}

/**
 * Public entry — picks the right prompt builder based on input shape.
 *
 * Fresh generate (no parent): full FURNACE brief + locked palette + composition + knowledge
 * Refinement (parent + instruction): terse adjustment + invariants
 * Branch (parent, no instruction): "parallel exploration" + invariants
 */
export function buildBoilerPrompt(input: GenerateDesignInput): string {
  if (input.parent && input.refinementInstruction) {
    return buildRefinementPrompt(input);
  }
  if (input.parent && !input.refinementInstruction) {
    return buildBranchPrompt(input);
  }
  return buildFreshPrompt(input);
}

/**
 * Helper: validate that a palette is "complete enough" to render. Used by
 * generate-design.ts before calling OpenAI. Returns an error message string if
 * incomplete (palette role missing or not a valid hex), else null.
 *
 * Validation is strict by design — gpt-image-2 prompts that say "garment base:
 * undefined" produce garbage. Better to fail loudly + early.
 */
export function validatePaletteRoles(
  roles: Partial<PaletteRoles>,
): string | null {
  const requiredRoles: Array<keyof PaletteRoles> = [
    "garment_base",
    "ring_outer",
    "ring_inner",
    "front_ink",
    "back_ink",
  ];
  for (const role of requiredRoles) {
    const value = roles[role];
    if (typeof value !== "string" || value.length === 0) {
      return `palette_roles.${role} is missing`;
    }
    if (!/^#[0-9a-fA-F]{6}$/u.test(value)) {
      return `palette_roles.${role} is not a 6-digit hex with leading # (got: ${value})`;
    }
  }
  return null;
}
