/**
 * Phase 11D — BOILER v2 shared types.
 *
 * The new BOILER architecture: single design + ORC iteration loop (not 4-variant
 * fan-out), gpt-image-2 Responses API with `previous_response_id` chaining,
 * three quality tiers (low/medium/high), Cloudinary upload after each generation,
 * Dynamic Mockups API for photo-real mockup composition (Phase 11D.5).
 *
 * Surface architecture locked by Design/Phase-11-BOILER-v2/v5.html (founder
 * approved May 15). Schema lives in drizzle/0011_boiler_v2.sql. Detailed spec
 * in agents/BOILER.md + agents/PIPELINE-v2.md § Phase 11D.
 */

import type {
  PaletteRoles,
  CompositionMeta,
  Tier,
  PaletteRoleName,
} from "@/db/zod";

export type { PaletteRoles, CompositionMeta, Tier, PaletteRoleName };

/**
 * FURNACE brief shape consumed by BOILER. Matches the 10-section visual-design
 * brief produced by the FURNACE skill (see agents/FURNACE.md).
 *
 * Phase 11D schema upgrade (May 18, 2026): the 6 machine-readable spec fields
 * below were added so BOILER can construct a deterministic gpt-image-1 prompt
 * from explicit specs rather than dumping prose. The prose sections (10 above)
 * are EDITORIAL INTENT for human review on the FURNACE tab; the spec fields
 * (6 below) are EXACT SPECIFICATIONS for the design engine.
 *
 * All 6 spec fields are OPTIONAL for backward compatibility with FURNACE
 * briefs generated before the upgrade. BOILER's prompt builder prefers
 * explicit fields when present, falls back to prose otherwise.
 */
export interface FurnaceBriefForBoiler {
  designDirection: string;
  tactileIntent: string;
  moodAndTone: string;
  compositionApproach: string;
  colorTreatment: string;
  typographicTreatment: string;
  artDirection: string;
  referenceAnchors: string;
  placementIntent: string;
  voiceInVisual: string;
  brandFitScore: number;
  brandFitRationale: string;
  addenda: Array<{ label: string; content: string }>;

  // ─── Phase 11D FURNACE schema upgrade — 6 machine-readable spec fields
  // All optional; BOILER falls back to prose when missing.

  /** Literal text per garment surface. Null fields = no text on that surface. */
  exactText?: {
    front: string | null;
    back: string | null;
    sleeve_left: string | null;
    sleeve_right: string | null;
    hem: string | null;
    inside_print: string | null;
  } | null;

  /** Every color in the design with role + hex (more flexible than 5-role PaletteRoles). */
  colorPalette?: Array<{
    role: string;
    name: string;
    hex: string;
  }> | null;

  /** Conceptual + spatial logic — the composition's "punchline". 300-1200 chars. */
  compositionRules?: string | null;

  /** Per-text-element render spec. ONE entry per text element; max 6. */
  typographySpec?: Array<{
    surface: string;
    content: string;
    font: "Syne" | "Cormorant Garamond" | "DM Mono";
    weight: number;
    tracking: string;
    orientation: "horizontal" | "vertical" | "90_CCW" | "90_CW";
    size_hint: "hero" | "secondary" | "annotation" | "caption";
  }> | null;

  /** Print construction strategy decided at FURNACE time. */
  printSeparationStrategy?: {
    technique:
      | "screen"
      | "DTG"
      | "discharge"
      | "embroidery"
      | "rubber print"
      | "puff print"
      | "flock";
    separations: number;
    perSeparation: string[];
    baseColorInteraction:
      | "opaque on base"
      | "discharge through base"
      | "blend with base"
      | "tonal over base";
  } | null;

  /** When the design extends beyond the centered print zone (PAPER-RCK pattern). */
  fullGarmentTreatment?: {
    enabled: boolean;
    bleed_zones: Array<
      "hem" | "shoulders" | "sleeves" | "back_yoke" | "collar" | "side_seams"
    >;
  } | null;
}

/**
 * Manifestation context (shortcode + decade + season + framing hook) — what the
 * design lives inside. Used to anchor the gpt-image-2 prompt with concrete identity.
 */
export interface BoilerContext {
  signalId: string;
  shortcode: string;
  manifestationDecade: "RCK" | "RCL" | "RCD";
  season: string;
  framingHook: string;
}

/**
 * Parent-version pointer for refinement chaining.
 *
 * Implementation note (May 16): the earlier plan was to chain via OpenAI's
 * Responses API `previous_response_id`. That plan fell apart — gpt-image-2
 * isn't a real model, and gpt-5 + image_generation tool doesn't support
 * transparent backgrounds. The shipped path is gpt-image-1 via the Images API
 * with /v1/images/edits for refinement (multipart upload of the prior PNG).
 *
 * So `parentFlatArtworkUrl` is now the chaining primitive — the orchestrator
 * fetches the URL → bytes → passes to /edits as the `image` form field.
 */
export interface BoilerParentRef {
  parentVersionId: string;
  parentFlatArtworkUrl: string;
}

/**
 * Inputs to the generate-design service. One shape for fresh generation, refinement,
 * branching, and finalize — the differences are which optional fields are set.
 *
 * - Fresh generate: parent = undefined, refinement = undefined, tier from caller
 * - Refine: parent set, refinement.instruction set, tier from caller (typically medium)
 * - Branch: parent set (to older version), refinement = undefined, tier from caller
 * - Finalize: parent = current active, refinement = undefined, tier = 'high'
 */
export interface GenerateDesignInput {
  context: BoilerContext;
  furnaceBrief: FurnaceBriefForBoiler;
  paletteRoles: PaletteRoles;
  compositionMeta: CompositionMeta;
  tier: Tier;
  refinementInstruction?: string;
  parent?: BoilerParentRef;
  knowledgeContext?: {
    decadePlaybook?: string;
    brandIdentity?: string;
    materialsVocabulary?: string;
    fashionSkills?: string;
  };
}

/**
 * Service output — what `generateDesign()` returns. Maps 1:1 to a `design_versions`
 * row; the caller (Inngest handler or eval script) is responsible for the DB write.
 */
export interface GenerateDesignOutput {
  /** The assembled gpt-image prompt — persisted as design_versions.prompt_used. */
  promptUsed: string;
  /** Synthetic response id (Images API has no native chain id). Kept for log continuity. */
  gptImage2ResponseId: string;
  /** Cloudinary URL of the uploaded transparent-PNG flat artwork. */
  flatArtworkUrl: string;
  /** Cloudinary public id for future delete/transform. */
  cloudinaryPublicId: string;
  /** Image dimensions as returned by the Images API. */
  widthPx: number;
  heightPx: number;
  /** Estimated cost of this generation in USD (per the tier pricing table). */
  costUsd: number;
  /** Wall-clock ms of the gpt-image call (for performance monitoring). */
  durationMs: number;
  /**
   * Vision-LLM verification result. Persisted to
   * design_versions.composition_meta.verification by the Inngest handler.
   * The orchestrator runs this AFTER the Cloudinary upload, BEFORE returning
   * to caller — so callers always have the pass/fail signal available.
   * Null only when verifySkip=true was passed (eval scripts running probe-only).
   */
  verification: VerificationResultLite | null;
}

/**
 * Lightweight version of VerificationResult, defined in types.ts to avoid
 * circular import with verify-output.ts. The shape matches.
 */
export interface VerificationResultLite {
  passed: boolean;
  overall_score: number;
  text_legibility: {
    score: number;
    detected_strings: string[];
    expected_strings_found: string[];
    issues: string;
  };
  palette_adherence: {
    score: number;
    dominant_hex_codes: string[];
    issues: string;
  };
  composition: {
    score: number;
    element_count: number;
    elements_observed: string[];
    issues: string;
  };
  conceptual_fit: {
    score: number;
    summary: string;
    issues: string;
  };
  refinement_suggestions: string[];
  verifier_model: string;
  verified_at: string;
  duration_ms: number;
}

/**
 * Tier pricing — Path B from PIPELINE-v2 § cost ceiling math (locked May 15).
 * Maps each tier to the gpt-image-2 quality parameter + USD per call.
 */
export const TIER_PRICING: Record<Tier, { quality: string; usd: number }> = {
  low: { quality: "low", usd: 0.006 },
  medium: { quality: "medium", usd: 0.053 },
  high: { quality: "high", usd: 0.211 },
};

/**
 * Image dimensions used for BOILER generations. Square 4096×4096 maximum supported
 * by gpt-image-2 today. Square avoids per-tier aspect-ratio routing complexity
 * (the actual print silhouette is handled at the mockup composition stage, not
 * here). Future variant: portrait 1024×1536 for layered prints that need vertical
 * dominance — deferred.
 */
export const DESIGN_DIMENSIONS = {
  width: 1024,
  height: 1024,
} as const;
