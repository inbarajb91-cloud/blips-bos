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
 * brief produced by the FURNACE skill (see agents/FURNACE.md). The new fields
 * from the Phase 11D FURNACE schema upgrade (exactText, paletteRolesByName,
 * compositionRules, typographySpec, printSeparationStrategy, fullGarmentTreatment)
 * are read from BOILER's separate inputs (paletteRoles + compositionMeta) rather
 * than from this brief — keeps the FURNACE schema upgrade independent of BOILER's
 * production ship.
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
