/**
 * FURNACE shared constants + types — Phase 10D.
 *
 * Pulled OUT of `furnace.ts` because that file is `"use server"` and
 * Next.js App Router only allows async function exports in server-action
 * files. Importing non-function exports (constants, types) from a
 * "use server" file leads to bundle/runtime errors that surface as
 * masked "An error occurred in the Server Components render" messages
 * in production — caught during Phase 10D verification (May 6).
 *
 * This file is plain TS (no "use server" directive) so client components
 * (FurnaceBrief renderer) and server modules (furnace.ts, ORC tools)
 * can both import freely.
 */

/**
 * The 10 required visual-design sections in a FURNACE brief. Granular
 * approval flow gates promotion to APPROVED on all 10 being approved.
 * brandFitRationale is informational (not gated) since it's the score's
 * justification, not a design decision.
 */
export const REQUIRED_SECTIONS = [
  "designDirection",
  "tactileIntent",
  "moodAndTone",
  "compositionApproach",
  "colorTreatment",
  "typographicTreatment",
  "artDirection",
  "referenceAnchors",
  "placementIntent",
  "voiceInVisual",
] as const;

export type SectionName = (typeof REQUIRED_SECTIONS)[number];

/**
 * Per-section character bounds, mirrored from the FURNACE skill's Zod
 * output schema. Used by both the renderer (for live-edit validation)
 * and the editBriefSection server action (server-side bound check).
 */
export const SECTION_BOUNDS: Record<SectionName, { min: number; max: number }> = {
  designDirection: { min: 200, max: 700 },
  tactileIntent: { min: 100, max: 500 },
  moodAndTone: { min: 80, max: 400 },
  compositionApproach: { min: 80, max: 400 },
  colorTreatment: { min: 80, max: 450 },
  typographicTreatment: { min: 100, max: 500 },
  artDirection: { min: 100, max: 500 },
  referenceAnchors: { min: 100, max: 500 },
  placementIntent: { min: 60, max: 300 },
  voiceInVisual: { min: 80, max: 400 },
};
