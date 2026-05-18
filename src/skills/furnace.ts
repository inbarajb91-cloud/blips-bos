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
      .max(600)
      .describe(
        "Why this score, in 1-3 sentences (max 600 chars). Be specific about what FITS or what DOESN'T. Vague rationales are themselves refusals of the rationale job.",
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
      .max(700)
      .nullable()
      .describe(
        "HERO. Single tight thesis statement (max 700 chars) of what this design IS. Editorial register, present tense. Reads as a designer's call, not marketing copy.",
      ),
    tactileIntent: z
      .string()
      .min(100)
      .max(500)
      .nullable()
      .describe(
        "REQUIRED — premium-design rule (max 500 chars). What should the garment FEEL like + COMMUNICATE physically? Use specific material vocabulary (heavyweight cotton, brushed back fleece, corduroy, garment-dyed, etc.). 'Soft cotton' is a failure — be specific. NO GSM numbers in any form (no '320 GSM', no '300-400 GSM range') — use weight WORDS only ('heavyweight', 'mid-weight'). ENGINE Step 1 derives the spec.",
      ),
    moodAndTone: z
      .string()
      .min(80)
      .max(400)
      .nullable()
      .describe(
        "Emotional register (max 400 chars) — raw / quiet / sardonic / spectral / weighted / declarative / unsettled. Single-thought, no caveats.",
      ),
    compositionApproach: z
      .string()
      .min(80)
      .max(400)
      .nullable()
      .describe(
        "Composition register (max 400 chars) — Type-led / illustrative / photographic / abstract / mixed / negative-space-heavy / dense / single-statement. The PRIMARY composition register; use mixed only when the design genuinely combines two registers.",
      ),
    colorTreatment: z
      .string()
      .min(80)
      .max(450)
      .nullable()
      .describe(
        "Color choices + how they sit (max 450 chars). Reference S01 Raw Industrial / S02 Cold Cosmic / S03 Warm Reckoning seasonal palettes OR explicitly justify why this design departs. High-contrast / muted monochrome / wash + accent / decade-palette-anchored.",
      ),
    typographicTreatment: z
      .string()
      .min(100)
      .max(500)
      .nullable()
      .describe(
        "Typographic notes (max 500 chars). If type-led: which Ink family (Syne display / Cormorant Garamond editorial / DM Mono) + scale (hero / pull-quote / sub-text) + treatment notes (debossed feel, screen-print texture, hand-drawn substitution, broken setting, set-as-quote, set-as-fragment).",
      ),
    artDirection: z
      .string()
      .min(100)
      .max(500)
      .nullable()
      .describe(
        "Art direction notes (max 500 chars). Illustrative style notes if illustration is involved (drawn / painted / printmaking-influenced / collaged); photo treatment if photo; iconographic system if iconographic. Specific enough that BOILER can render directly.",
      ),
    referenceAnchors: z
      .string()
      .min(100)
      .max(500)
      .nullable()
      .describe(
        "Visual references this is in conversation with (max 500 chars) — designers, art movements, artifacts (Acne posters, Brutalist editorial, early 90s rave flyers, Daniel Eatock's restraint, etc.). Push past streetwear default — Acne / ALD acceptable but not exclusive.",
      ),
    placementIntent: z
      .string()
      .min(60)
      .max(300)
      .nullable()
      .describe(
        "Placement intent (max 300 chars). Front-only / back-panel / sleeve hit / wraparound / hem / all-over / inside-tag. Compositional, not technical. Print technique stays at ENGINE Step 1.",
      ),
    voiceInVisual: z
      .string()
      .min(80)
      .max(400)
      .nullable()
      .describe(
        "Voice in visual (max 400 chars). If text appears in the design itself, how does it read — sharp one-liner / quote / data-as-poem / fragment / unfinished thought? BLIPS voice (observational, calmly confrontational, smirks doesn't shout).",
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

    // ─── DESIGN-STAGE SPECIFICATION (Phase 11D FURNACE schema upgrade)
    //
    // The 6 machine-readable fields below replace the role that prose-only
    // sections used to play in BOILER's gpt-image-1 prompt. The prose
    // sections above are EDITORIAL INTENT (for founder review on the
    // FURNACE tab). These 6 are EXACT SPECIFICATIONS (for BOILER to
    // assemble a deterministic gpt-image-1 prompt).
    //
    // Why split:
    //   - Prose lets the LLM write "if text is present, it could read
    //     LIKE 'UNREAD: 999+' or 'YOUR SECOND JOB.'" as direction.
    //   - When BOILER then dumps that prose into gpt-image-1, the image
    //     model takes the example literally and renders 5 garbled badges.
    //   - exactText separates "render THESE characters" from "the design
    //     READS LIKE a notification".
    //
    // All 6 fields are NULLABLE for backward compatibility with FURNACE
    // briefs generated before this upgrade. BOILER's prompt builder
    // prefers explicit fields when present, falls back to prose otherwise.
    //
    // When refused=true, all 6 are null (mirrors the existing 10 sections).

    exactText: z
      .object({
        front: z.string().max(200).nullable(),
        back: z.string().max(200).nullable(),
        sleeve_left: z.string().max(80).nullable(),
        sleeve_right: z.string().max(80).nullable(),
        hem: z.string().max(80).nullable(),
        inside_print: z.string().max(200).nullable(),
      })
      .nullable()
      .describe(
        "THE LITERAL TEXT TO RENDER per garment surface. Each field is the exact characters BOILER will instruct gpt-image-1 to draw — null on that surface = no text. Do NOT put example/placeholder text here ('UNREAD: 999+' should NOT appear here unless you literally want those characters on the garment). Use voiceInVisual prose for direction. RULE: minimize total text elements per surface — gpt-image-1 cannot render small text reliably. Prefer ONE hero text element per surface over multiple small fragments. Null when refused=true.",
      ),

    colorPalette: z
      .array(
        z.object({
          role: z
            .string()
            .min(3)
            .max(40)
            .describe(
              "Lowercase snake_case role identifier (e.g. 'garment_base', 'ring_outer', 'primary_text', 'accent_dot', 'trail_ghost'). Free-form; not constrained to the 5-role PaletteRoles schema.",
            ),
          name: z
            .string()
            .min(2)
            .max(40)
            .describe(
              "Human label from the BLIPS palette vocabulary (e.g. 'Forge', 'Ash Blush', 'Deep Slate', 'Char', 'Rust Haze').",
            ),
          hex: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/u, "Must be 6-digit hex with leading #")
            .describe("6-digit hex with leading #, e.g. '#5A2020'."),
        }),
      )
      .min(1)
      .max(8)
      .nullable()
      .describe(
        "EVERY color in the design with its role + hex. More expressive than the 5-role PaletteRoles — supports 1-8 colors per design as the composition needs (PAPER-RCK has 5; some designs need 3, some need 7). When set, BOILER uses these instead of the 5-role PaletteRoles fallback. Null when refused=true.",
      ),

    compositionRules: z
      .string()
      .min(300)
      .max(1200)
      .nullable()
      .describe(
        "The conceptual + spatial logic of the composition (300-1200 chars). The 'rings constant, object position is the variable' articulation from PAPER-RCK. Captures WHY the elements are arranged the way they are — the conceptual integrity. The composition's PUNCHLINE: the thing that, if you removed it, the design would become wallpaper. NOT vague layout description ('a balanced composition' is useless to BOILER). Single block of prose. Null when refused=true.",
      ),

    typographySpec: z
      .array(
        z.object({
          surface: z
            .string()
            .min(3)
            .max(40)
            .describe(
              "Where on the garment this text element lives (e.g. 'front_center', 'front_left', 'back_center', 'back_panel', 'sleeve_left', 'hem', 'inside_collar'). Must align with one of the exactText keys.",
            ),
          content: z
            .string()
            .min(1)
            .max(200)
            .describe(
              "The actual text rendered — must MATCH the corresponding exactText entry for the same surface. If the surface has no exactText, this entry should not exist.",
            ),
          font: z
            .enum(["Syne", "Cormorant Garamond", "DM Mono"])
            .describe(
              "One of the 3 BLIPS Ink type-system fonts — Syne (display/wordmark), Cormorant Garamond (editorial/quote — use sparingly), DM Mono (system/label).",
            ),
          weight: z
            .number()
            .int()
            .min(100)
            .max(900)
            .describe(
              "Font weight 100-900. Common: 300 (light), 400 (regular), 600 (semibold), 700 (bold), 800 (heavy), 900 (black). PAPER-RCK uses Syne 800 for the front hero, Syne 300 for the back murmur — the weight contrast is part of the design logic.",
            ),
          tracking: z
            .string()
            .min(1)
            .max(20)
            .describe(
              "Letter-spacing: 'tight' | 'normal' | 'loose' | or a precise CSS-style value like '-2%' / '+5%'.",
            ),
          orientation: z
            .enum(["horizontal", "vertical", "90_CCW", "90_CW"])
            .describe(
              "Text direction. 90_CCW = rotated 90° counter-clockwise (PAPER-RCK's vertical text column). 90_CW = clockwise. vertical = stacked characters (rare).",
            ),
          size_hint: z
            .enum(["hero", "secondary", "annotation", "caption"])
            .describe(
              "Scale hint. hero = dominant element. secondary = supporting headline. annotation = small label (USE SPARINGLY — gpt-image-1 fails on small text). caption = footnote-scale (AVOID — gpt-image-1 cannot render).",
            ),
        }),
      )
      .max(6)
      .nullable()
      .describe(
        "Per-text-element render specification. ONE entry per text element. Max 6 elements total across all surfaces — more than that and gpt-image-1 produces garbage. Empty array (not null) if the design intentionally has no text. Null when refused=true.",
      ),

    printSeparationStrategy: z
      .object({
        technique: z
          .enum([
            "screen",
            "DTG",
            "discharge",
            "embroidery",
            "rubber print",
            "puff print",
            "flock",
          ])
          .describe(
            "Print method decided at FURNACE time, not deferred to ENGINE. Determines what's renderable + what isn't. screen = flat solid inks, no halftones. DTG = full-color photographic. discharge = removes garment dye in the print area for a soft hand-feel. embroidery = stitched, low resolution.",
          ),
        separations: z
          .number()
          .int()
          .min(1)
          .max(6)
          .describe(
            "Number of color screens (meaningful for screen / discharge / rubber techniques only). 1 = single-color print. 2 = PAPER-RCK pattern (front ink + back ink). 4+ = expensive + harder to register.",
          ),
        perSeparation: z
          .array(z.string().min(5).max(120))
          .min(1)
          .max(6)
          .describe(
            "What each separation contains, in order. Example: ['Ash Blush front ink (square + text + crosshair)', 'Signal back ink (square + text + dashed trail)']. Length should match `separations`.",
          ),
        baseColorInteraction: z
          .enum([
            "opaque on base",
            "discharge through base",
            "blend with base",
            "tonal over base",
          ])
          .describe(
            "How the print ink interacts with the garment base color. 'opaque on base' = ink sits on top, full color. 'discharge through base' = removes dye, garment base color comes through softer. 'tonal over base' = same hue family as base, low-contrast tonal print (PAPER-RCK's ring field over Forge base).",
          ),
      })
      .nullable()
      .describe(
        "Print construction strategy. Decided here, not at ENGINE — affects what gpt-image-1 should and shouldn't try to render (no halftones if screen-print + halftones=false). Null when refused=true.",
      ),

    fullGarmentTreatment: z
      .object({
        enabled: z
          .boolean()
          .describe(
            "true = the design intentionally extends beyond the centered print zone (PAPER-RCK pattern: ring field bleeds off all edges). false = centered/anchored composition within standard print box.",
          ),
        bleed_zones: z
          .array(
            z.enum([
              "hem",
              "shoulders",
              "sleeves",
              "back_yoke",
              "collar",
              "side_seams",
            ]),
          )
          .max(6)
          .describe(
            "Which garment edges the design bleeds off. Empty array when enabled=false.",
          ),
      })
      .nullable()
      .describe(
        "Full-garment treatment spec. Drives BOILER to ask gpt-image-1 for a full-canvas composition rather than centered-icon-on-white. Null when refused=true.",
      ),
  });

// NOTE: schema deliberately does NOT include .refine() chains for the
// refusal invariants (refused iff score<50; sections null iff refused;
// etc.). Phase 10 smoke test (May 3) showed Gemini's structured-output
// mode generates output that Zod's refinements then reject — the AI SDK
// retries, fails again, throws "No object generated". Refinements run
// post-generation; the model doesn't know about them and can't conform.
//
// Two paths considered:
//   (a) Drop refinements + validate semantics at the app layer (the
//       Inngest handler + ORC tools can reject malformed output and
//       re-prompt with feedback). The schema enforces STRUCTURE
//       (character bounds, types, nullable fields); the prompt enforces
//       SEMANTICS (refusal coherence). This is the standard pattern in
//       the AI SDK + Gemini docs.
//   (b) Use a Zod discriminated union (refused-variant vs accepted-variant)
//       — cleaner but Gemini's structured-output also struggles with
//       complex unions, and the prompt instructions to pick the right
//       variant become more brittle.
//
// Picked (a). The system prompt explicitly tells the model:
//   "refused=true → all section fields null; refused=false → all sections
//    populated". When the model gets this wrong (rare, observed <5% in
//    smoke test), the brief still validates structurally and downstream
//    code can flag the inconsistency.
//
// Application-level validators (e.g. validateBriefCoherence) live alongside
// the Inngest handler (Phase 10C) for soft-warning cases. Hard validators
// (e.g. tactileIntent must contain material vocabulary) live in the eval
// suite (Phase 10G) so we measure quality, not crash on it.

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

Score guidance — be selective. Most BLIPS-grade signals land in the 50-79 range. The 80+ band is reserved for the rare standout that needs no editorial work; the 70-79 band is for clean, decade-anchored signals; the 50-69 band is the common case for marginal signals where the framing is real but the visual surface needs work.
  - 80-100: standout fit. Decade lands sharply on its OWN axis (not borrowing universal nostalgia), brand voice handles the tension naturally, design surface is generatively rich. Use rarely — most signals are not standouts.
  - 70-79: strong fit. Tension is unmistakably decade-specific (you cannot read this framing as belonging to any other cohort), brand voice fits naturally, design surface is at least competent. NEVER pull a signal here just because the narrative angle is well-written — well-written prose around a universal-shaped tension is still a marginal fit.
  - 50-69: marginal — DEFAULT THIS BAND when the framing has ANY of:
      • universal-shaped core (cafe-closing nostalgia, summer mood, generic mid-career malaise, "stuck in a job" — readable in any decade with minor word swaps)
      • decade-anchor is thin (the angle could float to RCK or RCL or RCD with light editing)
      • visual surface tends toward cliche even if you can write past it (medical-pamphlet, sepia-handwriting, generic-careerist, motivational-poster)
      • brief would need editorial heavy-lifting from the founder before going to BOILER
    If your INSTINCT is to score this 70-78 because the prose is sharp but the FRAMING is universal-shaped, that's a 60-69 — sharp prose doesn't unstick a universal framing. The score reads the FRAMING, not the prose around it.
  - 30-49: weak. Refuse with specific rationale.
  - 0-29: actively wrong for BLIPS. Refuse forcefully.

CALIBRATION CHECK before locking your score: if you scored 70+, ask "could this exact framing land in a different decade with a 5-word edit?" If yes → drop to 60-69. If you scored 80+, ask "does this need ANY editorial work from the founder before BOILER?" If yes → drop to 70-79.

2. THE BRIEF (only when fit ≥ 50)
Produce 10 visual-design sections + brand-fit metadata. PURE VISUAL DESIGN — never product specifications (material weight, garment cut, print technique, sizing — all live at ENGINE Step 1).

CRITICAL — premium-design rule
BLIPS is a premium philosophical brand. Every design must be VALUABLE — never "white tee with print." The tactileIntent section is REQUIRED and must describe what the garment should FEEL like + communicate physically (textured fabric, brushed back, garment dye, considered weight). If you cannot articulate a tactile intent that elevates the design beyond a basic graphic tee, you are failing the brand. "Soft cotton" is a failure — be specific.

TIER 1 MATERIAL VOCABULARY (use these names for tactileIntent — supplemented by MATERIALS.md in user message)
  IMPORTANT: weight indications below are for YOUR REFERENCE ONLY. Never write GSM numbers into any section — that's ENGINE Step 1's territory. Use weight WORDS ("heavyweight," "mid-weight," "lightweight") instead.
  - Heavyweight cotton: substantial, structural, takes ink with weight. Reads "considered, premium." Anchor for raw industrial register. (300-400 GSM range — for your reference only, do not write into the brief)
  - Mid-weight cotton: versatile workhorse. Balanced drape. (220-280 GSM range — your reference)
  - Slub jersey: irregular yarn texture. "This is not a basic tee" subtle moves.
  - Brushed back fleece: quiet warmth, soft interior, structured exterior. Hoodies, crewnecks. Warm reckoning.
  - Heavyweight raw cotton (untreated): crisp, structural, will soften over wear. Raw industrial.
  - Garment-dyed cotton: color depth + slight character from shrinkage + softer hand. Premium colorways.
  - Corduroy (8-wale fat / 14-wale standard / 21-wale fine pinwale): ribbed pile, vintage character, texture IS the design. Limited drops.
  - French terry / loopback: looped interior, mid-weight casual considered.
  - Cotton/linen blend: textured, breathable. Warmer-weather pieces with character.
  - Anti-patterns (NEVER use for BLIPS): thin cottons, polyester blends without intent, generic ringspun jersey. These read "white tee with print" — the failure mode.

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
  - GSM numbers in ANY form. Not "320 GSM," not "around 300-400 GSM," not "300-400 GSM range." Use weight WORDS only ("heavyweight cotton", "mid-weight slub jersey") — never the gram-per-square-meter number. ENGINE Step 1 picks the spec.
  - Material composition percentages (e.g. "100% organic cotton", "65/35 cotton-poly"). Material NAME yes; composition spec no.
  - Garment cut (e.g. "boxy oversized fit", "drop-shoulder"). Stay design-intent; ENGINE picks the cut.
  - Print technique (e.g. "screen-printed with discharge ink", "DTG"). Stay compositional in placementIntent; ENGINE picks the technique.
  - Sizing (XS-XXL etc). Not your call.
  - Vendor-specific instructions. Internal brief, not vendor handoff.

DECADE-SPECIFIC SHARPNESS
The user message includes the manifestation decade's playbook (RCK / RCL / RCD). Read it as canonical cohort psychology. Your brief's editorial sections (designDirection, moodAndTone, voiceInVisual) should sit IN that decade's voice — not above it, not generically.

PAST-BRIEF CONTEXT (Tier 3)
The user message may include up to 3 past briefs for this decade. Read them for VISUAL CONSISTENCY without copying — BLIPS visual language emerges over time. If past briefs all use heavyweight cotton garment-dyed indigo and your brief calls for something completely different, justify the departure clearly. Patterns are signals, not rules.

DESIGN-STAGE SPECIFICATION (THE 6 MACHINE-READABLE FIELDS)
In addition to the 10 prose sections above, populate these 6 machine-readable fields. These are what BOILER actually consumes to construct the gpt-image-1 prompt — the prose sections are for human review on the FURNACE tab, the spec fields are what the design engine sees.

When refused=true, all 6 are null. When refused=false, all 6 are populated.

1. exactText — THE LITERAL TEXT TO RENDER per garment surface.
   { front, back, sleeve_left, sleeve_right, hem, inside_print }
   Each is a string or null. NULL means no text on that surface.
   THIS IS THE TEXT TO RENDER, not example direction. If you write "UNREAD: 999+" here, BOILER will render those exact characters on the garment. If you want to express "the design READS LIKE a notification badge", write that in voiceInVisual prose — do NOT put fake example text here.
   RULE: keep total text elements per surface MINIMAL. gpt-image-1 cannot render small text reliably. Prefer ONE hero text element per surface over multiple small fragments. A surface with the framing-hook hero line + null for everything else is usually the right call.

2. colorPalette — every color in the design with its role + hex.
   Array<{ role, name, hex }>
     role: lowercase_snake_case (e.g. "garment_base", "ring_outer", "primary_text", "accent_dot")
     name: human label from the BLIPS palette vocabulary ("Forge", "Ash Blush", "Deep Slate")
     hex: 6-digit hex with # ("#5A2020")
   You can specify 1-8 colors as the design needs. PAPER-RCK has 5.

3. compositionRules — the conceptual + spatial logic (300-1200 chars).
   The PUNCHLINE of the composition — the thing that, if removed, makes the design wallpaper. PAPER-RCK's was: "Rings constant, object position is the variable. Front: square at origin = in control. Back: square drifted = something is off. The field doesn't care. The field is always there. Wearer is the subject of the rings."
   NOT vague layout description ("a balanced composition" is useless to BOILER).
   Single block of prose.

4. typographySpec — per-text-element render specification.
   Array<{ surface, content, font, weight, tracking, orientation, size_hint }>
     surface: "front_center" | "front_left" | "back_center" | "back_panel" | "sleeve_left" | "hem" | etc. — must align with exactText keys
     content: the actual text — must MATCH the exactText entry for the same surface
     font: "Syne" | "Cormorant Garamond" | "DM Mono"
     weight: 100-900 (PAPER-RCK uses Syne 800 front, Syne 300 back — weight contrast is part of the design logic)
     tracking: "tight" | "normal" | "loose" | precise like "-2%" / "+5%"
     orientation: "horizontal" | "vertical" | "90_CCW" | "90_CW"
     size_hint: "hero" | "secondary" | "annotation" | "caption" (USE 'annotation'/'caption' SPARINGLY — gpt-image-1 fails on small text)
   Max 6 entries total. Empty array if the design intentionally has no text.

5. printSeparationStrategy — how the print is constructed.
   { technique, separations, perSeparation, baseColorInteraction }
     technique: "screen" | "DTG" | "discharge" | "embroidery" | "rubber print" | "puff print" | "flock"
     separations: 1-6 (number of color screens)
     perSeparation: array of strings, what each separation contains
     baseColorInteraction: "opaque on base" | "discharge through base" | "blend with base" | "tonal over base"
   Decided here, not at ENGINE. Affects what gpt-image-1 should and shouldn't try to render.

6. fullGarmentTreatment — when the design extends beyond the centered print zone.
   { enabled: boolean, bleed_zones: ["hem"|"shoulders"|"sleeves"|"back_yoke"|"collar"|"side_seams"] }
   When enabled=true, the design intentionally extends off the edges (PAPER-RCK pattern). Drives BOILER to ask gpt-image-1 for full-canvas composition rather than centered-icon-on-white. bleed_zones=[] when enabled=false.

ANTI-PATTERNS — never populate these fields with:
  ❌ Example placeholder text in exactText. If voiceInVisual says "the visual COULD read 'UNREAD: 999+'", do NOT put that string in exactText.front. Use exactText for what you actually want rendered.
  ❌ More than 2 small text elements per surface. gpt-image-1's known failure mode is repeated small text labels — it produces "unreadi $99+" instead of "UNREAD 999+".
  ❌ Decorative text repetition (5 unread badges, scrolling marquee, scrolling stock-ticker, etc.).
  ❌ Vague compositionRules ("a balanced layout with multiple elements" — useless to BOILER).
  ❌ typographySpec entries that don't have a matching exactText entry (orphan typography).
  ❌ More than 6 total typographySpec entries.

THE BLIPS DESIGN BAR — the calibration anchor
Every brief you produce must give BOILER enough specificity to land at the BLIPS bar. The reference design (PAPER-RCK / "AHEAD ON PAPER / BEHIND ON SOMETHING") had 5 specific hex codes with roles, exact text per face, exact font weights + tracking, 2 print separations with what's on each, full-garment bleed. That's the level of specificity to aim for. A brief that says "data dashboard with notification fragments in DM Mono" gives BOILER nothing it can render cleanly. A brief that says exactText.front = "The WhatsApp group that became your second job.", typographySpec = [{surface: "front_center", content: "The WhatsApp group that became your second job.", font: "Syne", weight: 700, tracking: "tight", orientation: "horizontal", size_hint: "hero"}] gives BOILER exactly what it needs to render one clean hero design.

OUTPUT FORMAT
Valid JSON matching the schema. When refused=true, all section fields null INCLUDING the 6 spec fields. When refused=false, all 10 prose section fields populated within character bounds AND all 6 spec fields populated. Empty addenda array on initial generation.

CHARACTER COUNTS — STRICTLY ENFORCED BY THE SCHEMA
The schema rejects any section over its max character bound and the API call FAILS. Stay under each max — concision is part of the editorial discipline. Long answers indicate unfocused thinking; tighten and ship.

  Section maxima (chars):
    brandFitRationale: 600   (refusalReason: same range when refused)
    designDirection:   700   (the hero — most generous bound)
    tactileIntent:     500
    typographicTreatment: 500
    artDirection:      500
    referenceAnchors:  500
    colorTreatment:    450
    moodAndTone:       400
    compositionApproach: 400
    voiceInVisual:     400
    placementIntent:   300
    compositionRules:  1200 (max, prose block of the conceptual logic)

Aim for 60-80% of max per section. If you find yourself over the max, you're trying to say two things in one section — pick the sharper one.

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
Score brand-fit 0-100. If < 50, refuse with specific rationale (refused=true, all sections AND all 6 design-stage spec fields null). If >= 50, produce all 10 visual-design prose sections + populate addenda as an empty array + populate ALL 6 design-stage spec fields (exactText, colorPalette, compositionRules, typographySpec, printSeparationStrategy, fullGarmentTreatment).

CRITICAL — the spec fields are what BOILER actually renders from. The prose sections are for the founder's editorial review on the FURNACE tab. If your spec fields and prose sections say different things, BOILER will render what the SPEC FIELDS say. Do not put example/placeholder text in exactText (e.g. do not write "UNREAD: 999+" in exactText.front unless you literally want those characters on the front of the tee). Use voiceInVisual prose for direction; use exactText for the exact characters to render.

tactileIntent is REQUIRED — never default to "white tee with print." Pure visual design, never product specs (material weight numbers, garment cut, print technique at the GSM level, sizing — those are ENGINE's job; printSeparationStrategy.technique here is DESIGN-stage method, not vendor selection).

Output valid JSON matching the schema.`;
  },
};

registerSkill(furnaceSkill);

export { furnaceSkill };
