/**
 * Phase 11D — BOILER v2 public surface.
 *
 * Consumers (Inngest handler, ORC tools, eval script):
 *   - import { generateDesign } — main service entry
 *   - import { buildBoilerPrompt } — pure prompt builder, for previewing
 *   - import { probeOpenAIResponses } — health check for verify scripts
 *   - import { TIER_PRICING, DESIGN_DIMENSIONS } — constants
 *   - import type { GenerateDesignInput, GenerateDesignOutput, ... } — types
 */

export { generateDesign } from "./generate-design";
export {
  buildBoilerPrompt,
  validatePaletteRoles,
} from "./build-prompt";
export {
  generateImageViaResponses,
  probeOpenAIResponses,
} from "./openai-image-client";
export { verifyDesignOutput } from "./verify-output";
export type { VerificationResult, VerifyOptions } from "./verify-output";
export {
  TIER_PRICING,
  DESIGN_DIMENSIONS,
} from "./types";
export type {
  GenerateDesignInput,
  GenerateDesignOutput,
  BoilerContext,
  BoilerParentRef,
  FurnaceBriefForBoiler,
  PaletteRoles,
  CompositionMeta,
  Tier,
  PaletteRoleName,
} from "./types";
