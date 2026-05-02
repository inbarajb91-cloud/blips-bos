import { z } from "zod";
import type { Skill } from "./types";
import { registerSkill } from "./registry";

/**
 * FURNACE — Visual Design Brief skill (Phase 10).
 *
 * Takes one STOKER-approved manifestation child signal and produces:
 *   1. A brand-fit decision — score 0-100 + rationale. Below 50 = refusal,
 *      no brief sections produced. Refusal-as-quality, mirrors STOKER ethos.
 *   2. The visual design brief (when fit ≥ 50) — 11 fixed sections + an
 *      extensible `addenda[]` array. Pure visual design, NO product specs
 *      (material weight, garment cut, print technique, sizing — all live
 *      at ENGINE Step 1 per the May 3 mental-model correction).
 *
 * Architecture (Model 3 reuse — see agents/FURNACE.md May 3, 2026):
 *   FURNACE's output is consumed by the Inngest FURNACE handler (Phase 10C),
 *   which writes one agent_outputs row on the manifestation child signal:
 *   agentName='FURNACE', outputType='brief', content=<brief JSONB>.
 *   The skill itself doesn't write to the database.
 *
 * Knowledge integration: the manifestation's decade playbook + BRAND.md +
 * MATERIALS.md are passed IN the input — the Inngest handler fetches them
 * from knowledge_documents at prompt-build time and includes their text
 * in `input.knowledgeContext`. The skill stays pure (input → LLM → output).
 *
 * Premium-design rule (Inba May 3): tactileIntent is REQUIRED on every
 * brief, never optional. BLIPS designs must be VALUABLE — never default
 * to "white tee with print." Tier 1 material vocabulary anchored in this
 * system prompt; Tier 2 (MATERIALS.md) recalled per brief; Tier 3 (events
 * container learning) accumulates over time.
 *
 * Model: seed config_agents.FURNACE.model = gemini-2.5-flash, temp 0.4.
 * Visual design needs slightly more creative latitude than STOKER's
 * editorial reasoning (0.3) but less than BOILER's image-direction work
 * (0.7). May flip to Pro after eval if quality criteria require deeper
 * reasoning. Per Phase 10G.
 */

// ─── Input ───────────────────────────────────────────────────────

const decadeEnum = z.enum(["RCK", "RCL", "RCD"]);

const manifestationContextSchema = z.object({
  /** STOKER's hero one-liner. */
  framingHook: z.string().min(10).max(150),
  /** STOKER's specific psychological tension. */
  tensionAxis: z.string().min(10).max(200),
  /** STOKER's 2-3 sentence narrative angle. */
  narrativeAngle: z.string().min(50).max(800),
  /** STOKER's per-life-dimension alignment notes (7 dimensions). */
  dimensionAlignment: z.object({
    social: z.string().max(300),
    musical: z.string().max(300),
    cultural: z.string().max(300),
    career: z.string().max(300),
    responsibilities: z.string().max(300),
    expectations: z.string().max(300),
    sports: z.string().max(300),
  }),
});

const inputSchema = z.object({
  /** The manifestation child signal id. */
  signalId: z.string().uuid(),
  /** e.g. "VOTER-RCL". */
  shortcode: z.string().min(3).max(20),
  /** STOKER-extracted working title for the manifestation. */
  workingTitle: z.string().min(1),
  /** STOKER's narrative angle as the signal's concept text. */
  concept: z.string().min(1),
  /** Which decade this manifestation is for. */
  manifestationDecade: decadeEnum,
  /** Parent BUNKER signal context — useful for cross-decade references
   *  in the referenceAnchors section. */
  parentSignalId: z.string().uuid(),
  parentShortcode: z.string().min(3).max(10),

  /** STOKER's full output for this manifestation, passed in by the
   *  orchestrator. The richest input — FURNACE reads framingHook +
   *  tensionAxis + narrativeAngle + per-dimension alignment to inform
   *  every section of the brief. */
  manifestation: manifestationContextSchema,

  /** Knowledge context — recalled by the Inngest handler at prompt-build
   *  time from knowledge_documents. Empty strings are valid; FURNACE
   *  falls back to brand-DNA framing in its system prompt for any
   *  knowledge doc that hasn't been authored yet.
   *
   *  - decadePlaybook: RCK/RCL/RCD playbook for this manifestation's
   *    decade (Phase 9H scaffold doc, founder-edited over time).
   *  - brandIdentity: BRAND.md content (Phase 9H scaffold).
   *  - materialsVocabulary: MATERIALS.md content (Phase 10 scaffold) —
   *    the Tier 2 reference for tactileIntent vocabulary. */
  knowledgeContext: z.object({
    decadePlaybook: z.string(),
    brandIdentity: z.string(),
    materialsVocabulary: z.string(),
  }),

  /** Past-brief context — recalled from the events container for this
   *  decade. Tier 3 learning. Max 3 entries. Empty array is valid (cold
   *  start). Helps FURNACE maintain visual consistency without copying. */
  pastBriefsForDecade: z
    .array(
      z.object({
        shortcode: z.string(),
        workingTitle: z.string(),
        designDirection: z.string(),
        tactileIntent: z.string(),
        approvedAt: z.string(),
      }),
    )
    .max(3),
});

export type FurnaceInput = z.infer<typeof inputSchema>;

// ─── Output ──────────────────────────────────────────────────────

/**
 * The brief's 11 fixed visual-design sections + extensible addenda array.
 *
 * Character bounds enforced by Zod — the LLM physically cannot emit
 * out-of-bounds content (AI SDK's generateStructured rejects + re-prompts).
 *
 * Refusal pattern: when brandFitScore < 50, only score + rationale + the
 * `refused: true` flag are populated; all other section fields are null.
 * Founder reviews the refusal banner and decides force-advance or dismiss.
 */
const briefSectionsSchema = z
  .object({
    // Brand-fit gate — refusal-as-quality
    brandFitScore: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        "0-100. Below 50 = refuse with rationale, no brief sections produced. The bar is editorial — weak fits become dilutive product, not 'let's see what BOILER does with it.'",
      ),
    brandFitRationale: z
      .string()
      .min(100)
      .max(400)
      .describe(
        "Why this score. Be specific about what FITS or what DOESN'T. Vague rationales are themselves refusals of the rationale job.",
      ),

    // Refusal flag (drives everything below)
    refused: z
      .boolean()
      .describe(
        "true if and only if brandFitScore < 50. When true, all section fields below are null.",
      ),
    refusalReason: z
      .string()
      .min(100)
      .max(400)
      .nullable()
      .describe(
        "Required when refused=true. Specific failure mode — brand-voice mismatch / cohort wash / culturally opaque / generic-shaped framing / etc. Vague refusals are themselves refusals of the refusal job.",
      ),

    // Visual design sections — all required when not refused, all character-bounded
    designDirection: z
      .string()
      .min(200)
      .max(500)
      .nullable()
      .describe(
        "HERO. Single tight thesis statement of what this design IS. Editorial register, present tense. Reads as a designer's call, not marketing copy.",
      ),
    tactileIntent: z
      .string()
      .min(100)
      .max(400)
      .nullable()
      .describe(
        "REQUIRED — premium-design rule. What should the garment FEEL like + COMMUNICATE physically? Use specific material vocabulary (heavyweight cotton, brushed back fleece, corduroy, garment-dyed, etc.). 'Soft cotton' is a failure — be specific. ENGINE Step 1 reads this to derive material spec.",
      ),
    moodAndTone: z
      .string()
      .min(100)
      .max(300)
      .nullable()
      .describe(
        "Emotional register — raw / quiet / sardonic / spectral / weighted / declarative / unsettled. Single-thought, no caveats.",
      ),
    compositionApproach: z
      .string()
      .min(100)
      .max(300)
      .nullable()
      .describe(
        "Type-led / illustrative / photographic / abstract / mixed / negative-space-heavy / dense / single-statement. The PRIMARY composition register; use mixed only when the design genuinely combines two registers.",
      ),
    colorTreatment: z
      .string()
      .min(100)
      .max(300)
      .nullable()
      .describe(
        "Color choices + how they sit. Reference S01 Raw Industrial / S02 Cold Cosmic / S03 Warm Reckoning seasonal palettes OR explicitly justify why this design departs. High-contrast / muted monochrome / wash + accent / decade-palette-anchored.",
      ),
    typographicTreatment: z
      .string()
      .min(100)
      .max(400)
      .nullable()
      .describe(
        "If type-led: which Ink family (Syne display / Cormorant Garamond editorial / DM Mono) + scale (hero / pull-quote / sub-text) + treatment notes (debossed feel, screen-print texture, hand-drawn substitution, broken setting, set-as-quote, set-as-fragment).",
      ),
    artDirection: z
      .string()
      .min(100)
      .max(400)
      .nullable()
      .describe(
        "Illustrative style notes if illustration is involved (drawn / painted / printmaking-influenced / collaged); photo treatment if photo; iconographic system if iconographic. Specific enough that BOILER can render directly.",
      ),
    referenceAnchors: z
      .string()
      .min(100)
      .max(400)
      .nullable()
      .describe(
        "Visual references this is in conversation with — designers, art movements, artifacts (Acne posters, Brutalist editorial, early 90s rave flyers, Daniel Eatock's restraint, etc.). Push past streetwear default — Acne / ALD acceptable but not exclusive.",
      ),
    placementIntent: z
      .string()
      .min(80)
      .max(200)
      .nullable()
      .describe(
        "Front-only / back-panel / sleeve hit / wraparound / hem / all-over / inside-tag. Compositional, not technical. Print technique stays at ENGINE Step 1.",
      ),
    voiceInVisual: z
      .string()
      .min(100)
      .max(300)
      .nullable()
      .describe(
        "If text appears in the design itself, how does it read — sharp one-liner / quote / data-as-poem / fragment / unfinished thought? BLIPS voice (observational, calmly confrontational, smirks doesn't shout).",
      ),

    // ORC-extensible addenda — empty on initial generation; populated
    // by ORC's add_brief_addendum tool after founder approval.
    addenda: z
      .array(
        z.object({
          label: z.string().min(5).max(50),
          content: z.string().min(50).max(500),
          addedBy: z.enum(["orc", "founder"]),
          addedAt: z.string(),
          reason: z.string().min(50).max(300),
        }),
      )
      .describe(
        "Extensible addenda — sections that aren't in the core 11 but ORC or founder wants on this specific brief (hangtag content, special instructions, etc.). Empty on initial FURNACE generation; populated later via ORC tools.",
      ),
  })
  .refine(
    (val) => {
      // Refusal consistency: refused iff score < 50
      return val.refused === val.brandFitScore < 50;
    },
    {
      message:
        "refused must be true if and only if brandFitScore < 50.",
    },
  )
  .refine(
    (val) => {
      // refusalReason required when refused, null when not
      return val.refused
        ? val.refusalReason !== null
        : val.refusalReason === null;
    },
    {
      message:
        "refusalReason is required when refused=true and must be null when refused=false.",
    },
  )
  .refine(
    (val) => {
      // When refused, all section fields are null
      if (!val.refused) return true;
      return (
        val.designDirection === null &&
        val.tactileIntent === null &&
        val.moodAndTone === null &&
        val.compositionApproach === null &&
        val.colorTreatment === null &&
        val.typographicTreatment === null &&
        val.artDirection === null &&
        val.referenceAnchors === null &&
        val.placementIntent === null &&
        val.voiceInVisual === null
      );
    },
    {
      message:
        "When refused=true, all section fields (designDirection, tactileIntent, moodAndTone, compositionApproach, colorTreatment, typographicTreatment, artDirection, referenceAnchors, placementIntent, voiceInVisual) must be null.",
    },
  )
  .refine(
    (val) => {
      // When NOT refused, all required section fields are populated
      if (val.refused) return true;
      return (
        val.designDirection !== null &&
        val.tactileIntent !== null &&
        val.moodAndTone !== null &&
        val.compositionApproach !== null &&
        val.colorTreatment !== null &&
        val.typographicTreatment !== null &&
        val.artDirection !== null &&
        val.referenceAnchors !== null &&
        val.placementIntent !== null &&
        val.voiceInVisual !== null
      );
    },
    {
      message:
        "When refused=false, all 10 required section fields (designDirection, tactileIntent, moodAndTone, compositionApproach, colorTreatment, typographicTreatment, artDirection, referenceAnchors, placementIntent, voiceInVisual) must be populated.",
    },
  );

const outputSchema = briefSectionsSchema;

export type FurnaceOutput = z.infer<typeof outputSchema>;

// ─── System prompt — Tier 1 material vocabulary baked in
//
// The static brand DNA + FURNACE role + Tier 1 material vocabulary lives
// here so it's cache-eligible across every FURNACE call (Anthropic
// ephemeral / Gemini named / OpenAI auto). Tier 2 (MATERIALS.md content)
// + Tier 3 (past briefs) flow in via the per-call user message and are
// NOT cache-eligible (different per call).
//
// Word budget for system prompt: ~3000 tokens. Brand DNA is ~600 tokens,
// FURNACE role + section spec is ~1200 tokens, Tier 1 material vocab is
// ~250 tokens, voice/refusal/format rules are ~600 tokens. Stays under
// the system_brand_signal cache bucket from Phase 8 (3500 tokens).

const SYSTEM_PROMPT = `You are FURNACE — BLIPS's visual design brief generator.

BRAND DNA — the framing that never drifts
BLIPS makes premium philosophical apparel. Every product is a wearable artifact that names something specific about a decade of life. Audience: 28-58 urban English-speaking professionals, primarily Chennai, expandable globally. Voice: observational, calmly confrontational, sharp, editorial. Smirks, doesn't shout.

THE THREE DECADE COHORTS
  RCK — 28-38 ("The Reckoning") — career inflection, ambition vs meaning, urban-professional in early settling phase, biology starts to matter, civic identity being formed.
  RCL — 38-48 ("The Recalibration") — success-fatigue, parenthood-pivot, the legacy question, friendships in WhatsApp groups, peak career + no energy, sandwich generation.
  RCD — 48-58 ("The Reckoned") — what-was-it-for reckoning, mortality-aware, re-listening to own teen-era music, ambition decay, accumulated meaning vs eroded conviction.

THE THREE SEASONAL PALETTES (Ink design system)
  S01 Raw Industrial — signal red, forge, char. The heat decade. Often (but not always) RCK-anchored.
  S02 Cold Cosmic — cool blue-grey, deep slate, ice. The recalibration decade. Often (but not always) RCL-anchored.
  S03 Warm Reckoning — rust, amber, warm earth. The reckoned decade. Often (but not always) RCD-anchored.
Decade ≠ palette is a hard rule. A signal that resonates RCK doesn't auto-default to S01; the palette is a design call you make based on the signal's emotional register.

THE INK TYPE SYSTEM (3 fonts, locked)
  Syne — display / wordmark / section headers / primary sans. Geometric, distinctive.
  Cormorant Garamond — editorial / pull-quotes / taglines. Used SPARINGLY (high-contrast serif, falls apart at body sizes).
  DM Mono — body / labels / UI / system copy. Terminal-prose register.

YOUR JOB
Take ONE STOKER-approved manifestation (per-decade child signal) and answer two questions:

1. BRAND-FIT GATE
Score brand-fit 0-100. Below 50 = refuse with rationale. Refusal IS quality — weak fits become dilutive product. Specific refusal reasons: brand-voice mismatch / cohort wash / culturally opaque / generic-shaped framing / sentimental register / trend-chasing.

Score guidance:
  - 80-100: clear fit. Decade lands sharply, brand voice handles the tension naturally, design surface is generative.
  - 70-79: strong fit but with one note (slight register drift, partial generative surface).
  - 50-69: marginal. Brief is possible but founder review will require editorial work.
  - 30-49: weak. Refuse with specific rationale.
  - 0-29: actively wrong for BLIPS. Refuse forcefully.

2. THE BRIEF (only when fit ≥ 50)
Produce 10 visual-design sections + brand-fit metadata. PURE VISUAL DESIGN — never product specifications (material weight, garment cut, print technique, sizing — all live at ENGINE Step 1).

CRITICAL — premium-design rule
BLIPS is a premium philosophical brand. Every design must be VALUABLE — never "white tee with print." The tactileIntent section is REQUIRED and must describe what the garment should FEEL like + communicate physically (textured fabric, brushed back, garment dye, considered weight). If you cannot articulate a tactile intent that elevates the design beyond a basic graphic tee, you are failing the brand. "Soft cotton" is a failure — be specific.

TIER 1 MATERIAL VOCABULARY (use this for tactileIntent, supplemented by MATERIALS.md in user message)
  - Heavyweight cotton (300-400 GSM): substantial, structural, takes ink with weight. Reads "considered, premium." Anchor for raw industrial register.
  - Mid-weight cotton (220-280 GSM): versatile workhorse. Balanced drape.
  - Slub jersey: irregular yarn texture. "This is not a basic tee" subtle moves.
  - Brushed back fleece: quiet warmth, soft interior, structured exterior. Hoodies, crewnecks. Warm reckoning.
  - Heavyweight raw cotton (untreated): crisp, structural, will soften over wear. Raw industrial.
  - Garment-dyed cotton: color depth + slight character from shrinkage + softer hand. Premium colorways.
  - Corduroy (8-wale fat / 14-wale standard / 21-wale fine pinwale): ribbed pile, vintage character, texture IS the design. Limited drops.
  - French terry / loopback: looped interior, mid-weight casual considered.
  - Cotton/linen blend: textured, breathable. Warmer-weather pieces with character.
  - Anti-patterns (NEVER use for BLIPS): thin cottons (<180 GSM), polyester blends without intent, generic 180 GSM ringspun jersey. These read "white tee with print" — the failure mode.

The user message includes MATERIALS.md content with deeper vocabulary + decade × material affinities + BLIPS-specific direction. Read that as canonical for tactileIntent shaping. If MATERIALS.md is empty (not yet authored), fall back to Tier 1 above.

VOICE RULES
  - Direct. Editorial. No hedge.
  - "the design reads weighted" not "I think this design might feel weighty"
  - Single thought per section, articulated tightly
  - No marketing copy ("amazing" / "stunning" / "premium quality"). No hype.
  - If a section needs caveats, the section is wrong — re-think the call

REFUSAL RULES
  - brandFitScore < 50 → refused=true, all section fields null
  - refusalReason must say WHAT specifically doesn't fit (brand voice mismatch? cultural opacity? cohort wash?)
  - Vague refusals ("doesn't feel right") are themselves refusals of the refusal job. Be specific.
  - Refusal is a sharper output than 11 sections of mediocre brief — the founder may force-advance via ORC if they see something you missed.

WHAT NOT TO INCLUDE (these are ENGINE's territory, not yours)
  - Material spec (e.g. "320 GSM ringspun cotton, 100% organic"). You can REFERENCE weight in tactileIntent context ("around 300-400 GSM heavyweight"), but never as a hard spec.
  - Garment cut (e.g. "boxy oversized fit", "drop-shoulder"). Stay design-intent; ENGINE picks the cut.
  - Print technique (e.g. "screen-printed with discharge ink"). Stay compositional in placementIntent; ENGINE picks the technique.
  - Sizing (XS-XXL etc). Not your call.
  - Vendor-specific instructions. Internal brief, not vendor handoff.

DECADE-SPECIFIC SHARPNESS
The user message includes the manifestation decade's playbook (RCK / RCL / RCD). Read it as canonical cohort psychology. Your brief's editorial sections (designDirection, moodAndTone, voiceInVisual) should sit IN that decade's voice — not above it, not generically.

PAST-BRIEF CONTEXT (Tier 3)
The user message may include up to 3 past briefs for this decade. Read them for VISUAL CONSISTENCY without copying — BLIPS visual language emerges over time. If past briefs all use heavyweight cotton garment-dyed indigo and your brief calls for something completely different, justify the departure clearly. Patterns are signals, not rules.

OUTPUT FORMAT
Valid JSON matching the schema. When refused=true, all section fields null. When refused=false, all 10 required section fields populated within character bounds. Empty addenda array on initial generation.

No commentary before or after the JSON.`;

// ─── Skill registration ─────────────────────────────────────────

const furnaceSkill: Skill<FurnaceInput, FurnaceOutput> = {
  name: "FURNACE",
  description:
    "Visual design brief generator — scores brand-fit and produces 10-section visual brief (no product specs; tactileIntent required) for one approved STOKER manifestation",
  inputSchema,
  outputSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt: (input) => {
    // Knowledge context section — fall through to "(empty)" when not yet
    // authored, so the model knows it's running with system-prompt-only
    // context for that doc.
    const knowledgeSection = (label: string, body: string) => {
      const trimmed = body.trim();
      return `### ${label}\n${trimmed.length > 0 ? trimmed : "(not yet authored — fall back to the brand-DNA + Tier 1 vocabulary in your system prompt)"}\n`;
    };

    // Past briefs section — Tier 3 learning. Up to 3 entries; empty array
    // means cold start (BLIPS hasn't approved any briefs for this decade
    // yet, or this is one of the first).
    const pastBriefsSection =
      input.pastBriefsForDecade.length > 0
        ? `### PAST BRIEFS FOR THIS DECADE (Tier 3 — for visual consistency, NOT to copy)
${input.pastBriefsForDecade
  .map(
    (b) =>
      `- ${b.shortcode} (${b.workingTitle})
    designDirection: ${b.designDirection}
    tactileIntent: ${b.tactileIntent}
    approved: ${b.approvedAt}`,
  )
  .join("\n")}\n`
        : `### PAST BRIEFS FOR THIS DECADE\n(no past briefs yet — this is a cold-start brief for ${input.manifestationDecade}. Set the visual language carefully; future briefs will read patterns from your output.)\n`;

    return `Generate a visual design brief for the following STOKER-approved manifestation.

MANIFESTATION
Shortcode: ${input.shortcode}
Working title: ${input.workingTitle}
Decade: ${input.manifestationDecade}
Parent signal: ${input.parentShortcode}

STOKER FRAMING (the source of design intent — read this carefully)
Framing hook: ${input.manifestation.framingHook}
Tension axis: ${input.manifestation.tensionAxis}
Narrative angle: ${input.manifestation.narrativeAngle}

PER-DIMENSION ALIGNMENT (STOKER's reading across the 7 life dimensions)
Social: ${input.manifestation.dimensionAlignment.social || "(not engaged)"}
Musical: ${input.manifestation.dimensionAlignment.musical || "(not engaged)"}
Cultural: ${input.manifestation.dimensionAlignment.cultural || "(not engaged)"}
Career: ${input.manifestation.dimensionAlignment.career || "(not engaged)"}
Responsibilities: ${input.manifestation.dimensionAlignment.responsibilities || "(not engaged)"}
Expectations: ${input.manifestation.dimensionAlignment.expectations || "(not engaged)"}
Sports: ${input.manifestation.dimensionAlignment.sports || "(not engaged)"}

KNOWLEDGE CONTEXT (founder-authored references — treat as canonical)

${knowledgeSection(`${input.manifestationDecade} DECADE PLAYBOOK`, input.knowledgeContext.decadePlaybook)}
${knowledgeSection("BLIPS BRAND IDENTITY", input.knowledgeContext.brandIdentity)}
${knowledgeSection("MATERIALS PLAYBOOK (Tier 2 — for tactileIntent shaping)", input.knowledgeContext.materialsVocabulary)}

${pastBriefsSection}

INSTRUCTIONS
Score brand-fit 0-100. If < 50, refuse with specific rationale (refused=true, all sections null). If >= 50, produce all 10 visual-design sections + populate addenda as an empty array. tactileIntent is REQUIRED — never default to "white tee with print." Pure visual design, never product specs (material weight, garment cut, print technique, sizing — those are ENGINE's job). Output valid JSON matching the schema.`;
  },
};

registerSkill(furnaceSkill);

export { furnaceSkill };
