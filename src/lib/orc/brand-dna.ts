/**
 * Brand DNA — BLIPS's canonical framing.
 *
 * Shared across every skill and ORC itself. The 7-dimensions × 3-decades
 * lens is the substrate of every signal evaluation, every product
 * decision, every voice call ORC makes. Phase 6 baked this into BUNKER's
 * system prompt inline; this file extracts it as a single source of
 * truth so ORC (Phase 8) and later skills stay aligned.
 *
 * (Follow-up: once ORC and one more skill both reference this, retrofit
 * BUNKER to import from here too, eliminating the duplicated prose in
 * `src/skills/bunker.ts`. For now BUNKER keeps its inline copy — no
 * rewrite justified by Phase 8 alone.)
 *
 * RCK / RCL / RCD are the codebase shorthand for the three decade
 * cohorts. They map to signal_decades.decade_lens enum values and are
 * how skills downstream of STOKER reference manifestations. The prose
 * version below is what the LLM reads; the shorthand is what the code
 * checks.
 */

export const DECADE_COHORTS = [
  { code: "RCK", ageRange: "28-38", label: "building career, young parents, first-decade regret" },
  { code: "RCL", ageRange: "38-48", label: "mid-career, sandwich generation, trade-offs permanent" },
  { code: "RCD", ageRange: "48-58", label: "late career, empty-nester, legacy questions" },
] as const;

export const LIFE_DIMENSIONS = [
  "Social (friendships, community, belonging)",
  "Musical (discovery, nostalgia, generational memory)",
  "Cultural (entertainment, reference points, curation)",
  "Career (ambition arc, professional stage, meaning at work)",
  "Responsibilities (parenting, caregiving, commitments)",
  "Expectations (society's pressure, self-imposed milestones)",
  "Sports (identity, fandom, aging body)",
] as const;

/**
 * The full brand DNA prose, ready to drop into a system prompt's
 * stable prefix. Reads as one cohesive passage rather than fragments
 * so the LLM gets the framing as a whole, not as a bullet salad.
 *
 * Sits inside the prompt cache — re-billed at 90% discount every turn
 * within TTL on Anthropic, free inside Gemini named caches, implicit
 * on OpenAI prefix caching.
 */
export const BRAND_DNA = `BRAND DNA — the framing that never drifts

BLIPS t-shirts name what a decade of life feels like across 7 life dimensions:
  1. Social (friendships, community, belonging)
  2. Musical (discovery, nostalgia, generational memory)
  3. Cultural (entertainment, reference points, curation)
  4. Career (ambition arc, professional stage, meaning at work)
  5. Responsibilities (parenting, caregiving, commitments)
  6. Expectations (society's pressure, self-imposed milestones)
  7. Sports (identity, fandom, aging body)

A great BLIPS signal resonates through MULTIPLE dimensions at MULTIPLE decade stages. "Revenge bedtime procrastination" isn't just about rest — it's a social moment (alone at night), a generational symptom (only now named), a career rebellion (reclaiming what work stole), and a responsibility-tension (parents staying up after kids sleep). That multi-dimensionality is the BLIPS signature.

AUDIENCE — three decade cohorts

Urban English-speaking professionals, ages 28-58. Coded in the pipeline as RCK / RCL / RCD:
  RCK (28-38) — building career, young parents, first-decade regret
  RCL (38-48) — mid-career, sandwich generation, trade-offs permanent
  RCD (48-58) — late career, empty-nester, legacy questions

Primary market: Chennai, India. May expand globally. First-language content is English. Voice is observational, calmly confrontational. It smirks, doesn't shout.

PRINCIPLE — Signals don't have passports

Indian urban professional suffering is globally legible. An Indian 35-year-old feels quiet-quit resentment the same way an American does. Both feel Sunday-night dread. A signal from /r/antiwork applies to both; a signal from The Hindu applies to both. Never filter on geographic origin. Only filter on whether the tension resonates with the 28-58 cohort's life stages.`;
