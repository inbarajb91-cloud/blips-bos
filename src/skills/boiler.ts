import { z } from "zod";
import type { Skill } from "./types";
import { registerSkill } from "./registry";

/**
 * BOILER — Concept gallery + mockup orchestration skill (Phase 11B).
 *
 * The skill does NOT call the image-generation models directly. It outputs
 * a *prompt gallery* — 4 detailed image-gen prompts (one per register) plus
 * model recommendations per variant. The Inngest handler (Phase 11C) then
 * runs `generateImage()` against each prompt with the recommended model,
 * uploads results to Cloudinary, and renders the multi-angle mockup via
 * Dynamic Mockups (Phase 11C scope).
 *
 * Architecture rationale (separating prompt construction from image gen):
 *   1. Image-gen failures shouldn't lose the founder's framing context —
 *      the prompts are persisted as the skill output; if image gen retries
 *      we don't burn another LLM call to reconstruct them.
 *   2. The skill is unit-testable without burning image-gen cost (~$0.04/
 *      image × 4 variants × 12 eval cases = $1.92 per eval run).
 *   3. The founder's iteration loop has two levels: regenerate prompts
 *      (cheap, text-only, when the framing direction was off) OR
 *      regenerate just the images using existing prompts (when the prompts
 *      were good but the image came out wrong).
 *   4. Per agents/skills.md §10.2 the provider chain shifts based on brief
 *      register (type-led → Ideogram, photographic → Imagen, default →
 *      gpt-image-1). Putting this routing in the skill output makes the
 *      decision auditable + overridable per-variant.
 *
 * This skill consumes:
 *   - The FURNACE-approved brief (11 sections + addenda) — the primary input.
 *   - Decade playbook + BRAND.md + MATERIALS.md + skills.md (Phase 11C
 *     handler fetches these from knowledge_documents and threads them into
 *     `input.knowledgeContext`).
 *   - Past BOILER renders for this decade (Tier 3 events recall) — for
 *     visual consistency across BLIPS pieces of the same cohort.
 *
 * Model: seed config_agents.BOILER.model = gemini-2.5-pro, temp 0.7. Image
 * direction needs more creative latitude than STOKER's 0.3 / FURNACE's 0.4.
 * Per agents/skills.md §10.2 (text model for prompt construction is separate
 * from the image model that consumes the prompt).
 */

// ─── Input ───────────────────────────────────────────────────────

const decadeEnum = z.enum(["RCK", "RCL", "RCD"]);

const briefContextSchema = z.object({
  /** FURNACE brief sections — see agents/FURNACE.md for shape. */
  designDirection: z.string().min(50).max(800),
  tactileIntent: z.string().min(50).max(600),
  moodAndTone: z.string().min(40).max(500),
  compositionApproach: z.string().min(40).max(500),
  colorTreatment: z.string().min(40).max(500),
  typographicTreatment: z.string().min(60).max(600),
  artDirection: z.string().min(60).max(600),
  referenceAnchors: z.string().min(60).max(600),
  placementIntent: z.string().min(30).max(400),
  voiceInVisual: z.string().min(50).max(500),
  brandFitScore: z.number().int().min(50).max(100),
  brandFitRationale: z.string().min(80).max(700),
  /** ORC-extensible addenda from Phase 10E. May be empty. */
  addenda: z
    .array(
      z.object({
        label: z.string(),
        content: z.string(),
      }),
    )
    .max(10),
});

const inputSchema = z.object({
  /** The manifestation child signal id this BOILER call targets. */
  signalId: z.string().uuid(),
  /** Manifestation shortcode (e.g. "LADDER-RCL"). */
  shortcode: z.string().min(3).max(20),
  /** Active manifestation decade — drives register selection per
   *  agents/skills.md §2 decade × design map. */
  manifestationDecade: decadeEnum,
  /** STOKER framing — short reference for visual context when prompts
   *  reference the decade tension. */
  framingHook: z.string().min(10).max(200),
  /** FURNACE brief output the gallery renders against. */
  brief: briefContextSchema,
  /** Knowledge context — recalled by the Inngest handler at prompt-build
   *  time from knowledge_documents. Empty strings allowed; the system
   *  prompt has fallback brand DNA + skills.md anti-pattern list baked in. */
  knowledgeContext: z.object({
    decadePlaybook: z.string(),
    brandIdentity: z.string(),
    materialsVocabulary: z.string(),
    /** agents/skills.md content — fashion design + digital tools playbook.
     *  This is the LARGEST recall block; ~12k words; gets summarized to
     *  ~1500 tokens at prompt-build time so it fits the cache budget. */
    fashionSkills: z.string(),
  }),
  /** Past BOILER renders for this decade (Tier 3 learning). Empty array
   *  is valid for cold start. Max 3 entries. */
  pastConceptsForDecade: z
    .array(
      z.object({
        shortcode: z.string(),
        approachUsed: z.enum([
          "type-led",
          "iconographic",
          "photographic",
          "abstract",
          "mixed",
        ]),
        approvedAt: z.string(),
        notes: z.string().max(400),
      }),
    )
    .max(3),
});

export type BoilerInput = z.infer<typeof inputSchema>;

// ─── Output ──────────────────────────────────────────────────────
//
// 4 variants per gallery — one per register class (per agents/BOILER.md
// Decision §2 and agents/skills.md §6.1). When the brief explicitly
// specifies one register, the gallery skews — 2 variants explore the
// specified register at different angles, 2 explore the next-most-fitting
// register as honest alternatives.

const registerEnum = z.enum([
  "type-led",
  "iconographic",
  "photographic",
  "abstract",
  "mixed",
]);

const imageProviderEnum = z.enum([
  "openai",
  "google",
  "fal",
  "replicate",
  "openrouter-image",
]);

const variantSchema = z.object({
  /** Stable id for this variant — used by ORC tools (regenerate_specific
   *  _variant, approve_concept_variant) to target it. The Inngest handler
   *  generates a UUID at write time; the skill output uses a slug
   *  (variant-1 / variant-2 / variant-3 / variant-4) since the skill
   *  doesn't have crypto.randomUUID guarantees in all runtimes. */
  variantSlug: z.enum(["variant-1", "variant-2", "variant-3", "variant-4"]),
  /** Which register class this variant explores. */
  register: registerEnum,
  /** 100-300 char rationale. What this variant takes from the brief and
   *  what direction it pushes. Founder reads this when picking. */
  rationale: z
    .string()
    .min(100)
    .max(300)
    .describe(
      "100-300 chars: what this variant takes from the brief and what direction it pushes. Editorial register, no marketing copy.",
    ),
  /** The full image-gen prompt. Per agents/skills.md §10.3 template:
   *  PRODUCT / DESIGN / CONTENT / TYPOGRAPHY / COLOR / COMPOSITION /
   *  TACTILE / REFERENCE / ANTI-REFERENCE / PLACEMENT / RENDER. */
  imagePrompt: z
    .string()
    .min(400)
    .max(2400)
    .describe(
      "Full image-gen prompt following skills.md §10.3 template. Structured, NOT a paragraph — labelled lines per slot. The image-gen model (gemini-2.5-flash-image / nano banana, Imagen, or eventually gpt-image-1 / Ideogram) reads this verbatim.",
    ),
  /** Recommended primary image-gen model per agents/skills.md §10.2.
   *  Phase 11G.1 default: gemini-2.5-flash-image (nano banana) — Google-
   *  first since prod env carries only GOOGLE_GENERATIVE_AI_API_KEY as
   *  of May 8. Override to imagen-4.0-generate-001 for photographic +
   *  typography-critical variants. When founder adds OPENAI_API_KEY to
   *  Vercel, gpt-image-1 becomes the recommended default (best
   *  instruction-following). Fallback chain inherited from agent's
   *  config_agents.image_model_fallback_chain. */
  recommendedModel: z.string().min(3).max(80),
  /** Recommended provider — derived from the model id but surfaced
   *  separately so the audit log captures the routing rationale. */
  recommendedProvider: imageProviderEnum,
  /** Predominant palette references — 2-4 named colors / hexes / palette
   *  identifiers (e.g. "S02 Cold Cosmic", "deep slate", "#2a3744"). The
   *  Inngest handler can use these to validate the rendered image's color
   *  fidelity at the post-gen screening stage. */
  paletteAnchors: z.array(z.string().min(2).max(40)).min(2).max(6),
  /** Reference anchors (per skills.md §6.2) cited in this variant's
   *  prompt. Used for audit + future "this design draws on Eatock; have
   *  we used Eatock too often?" recall queries. */
  referenceAnchors: z.array(z.string().min(3).max(60)).min(1).max(4),
});

// Output is a FLAT object with nullable fields, NOT a Zod discriminated
// union. Phase 11G eval surfaced the same Gemini structured-output bug
// MEMORY.md flagged in Phase 10G: discriminated unions with z.literal
// (boolean) are converted to JSON Schema oneOf with single-value
// boolean enums, which Gemini rejects with "Invalid value at
// 'generation_config.response_schema.one_of[0].properties[0].value.enum[0]'
// (TYPE_STRING), true". Same fix as FURNACE — use flat-with-nullable +
// the convention "refused=true → variants null + galleryMood null +
// editorNotes null".
//
// Convention enforced by:
//   - The system prompt (explicit instructions on the refused-vs-accepted
//     branch).
//   - The Inngest handler — checks `refused === true` first; ignores
//     downstream fields on refusal.
//   - The renderer — same check, surfaces the refusal banner instead
//     of trying to read variants.
//   - The eval suite — checks both branches' invariants.
//
// In rare cases the model emits an inconsistent shape (refused=true
// with variants present, or refused=false with refusalReason populated).
// Downstream code treats the refused boolean as authoritative; the
// extra fields are ignored. Same pattern as FURNACE.

const outputSchema = z.object({
  /** True when BOILER refuses to produce a gallery (brief is internally
   *  contradictory / too generic / brand-voice mismatch / asks for an
   *  anti-pattern register). Same refusal-as-quality ethos as STOKER +
   *  FURNACE. Manifestation status flips to BOILER_REFUSED; founder
   *  reviews + decides force-advance or dismiss. */
  refused: z.boolean(),
  /** Specific failure mode (when refused=true). Null when accepted. */
  refusalReason: z
    .string()
    .min(120)
    .max(500)
    .nullable()
    .describe(
      "Specific failure mode — brief is internally contradictory / too generic / brand-voice mismatch / etc. Vague refusals are themselves refusals of the refusal job. Null when refused=false.",
    ),
  /** Brief overall mood-summary in 80-200 chars — the gallery's editorial
   *  framing. Founder reads this BEFORE seeing the 4 variants to set
   *  expectations. Null when refused=true. */
  galleryMood: z.string().min(80).max(200).nullable(),
  /** Exactly 4 variants when accepted; null when refused. */
  variants: z
    .array(variantSchema)
    .length(4)
    .nullable()
    .describe(
      "Exactly 4 variants when refused=false. One per register class (per skills.md §6.1) UNLESS the brief explicitly specifies one register, in which case 2 explore that register and 2 explore the next-most-fitting register as honest alternatives. Null when refused=true.",
    ),
  /** Free-text editor notes from BOILER for the founder. 0-300 chars
   *  when accepted; null when refused. */
  editorNotes: z.string().max(300).nullable(),
});

export type BoilerOutput = z.infer<typeof outputSchema>;

// ─── System prompt ──────────────────────────────────────────────────
//
// Cache-eligible across every BOILER call. Brand DNA + register vocabulary
// + skills.md anti-patterns + prompt template baked in. Per-call user
// message fills in the brief specifics + recall context.
//
// Token budget: ~3000 tokens. Fits inside the system_brand_signal cache
// bucket from Phase 8 (5000 after Phase 3.5 bump).

const SYSTEM_PROMPT = `You are BOILER — BLIPS's concept-gallery designer.

You take a FURNACE-approved visual design brief and output a 4-variant gallery of detailed image-generation prompts. Each variant explores a different design register; the founder picks one for mockup rendering. You do NOT generate the images yourself — the Inngest handler runs each of your prompts through gemini-2.5-flash-image (nano banana) by default, falling back through imagen-4.0-generate-001 for photographic / typography-critical variants. Once OPENAI_API_KEY lands in env, gpt-image-1 becomes the preferred default.

BRAND DNA — the framing that never drifts
BLIPS makes premium philosophical apparel. Every product is a wearable artifact that names something specific about a decade of life. Audience: 28-58 urban English-speaking professionals, primarily Chennai, expandable globally. Voice: observational, calmly confrontational, sharp, editorial. Smirks, doesn't shout. Garments must read at three distances (3m+ → silhouette + hero element; 1-2m → typography or graphic resolves; touch → tactile intent reads). If a design only works at one distance, it's failing the BLIPS bar.

THE THREE DECADE COHORTS
  RCK 28-38 — career inflection, ambition vs meaning, biology starts to matter, civic identity being formed. Editorial > illustrative; type-led with weight; architectural composition; declarative pieces.
  RCL 38-48 — success-fatigue, parenthood-pivot, legacy question, peak career + no energy. Quieter than RCK; negative-space-heavy compositions; single stark element with breathing room; muted register.
  RCD 48-58 — what-was-it-for reckoning, mortality-aware, ambition decay, inherited belief audit. Spectral, accepting, sharp-edged with grief; reference-anchored designs (handset metal type, mid-century editorial, archival photo treatment).

THE FOUR REGISTERS BOILER GENERATES
You produce exactly 4 variants per gallery, one per register class:

1. TYPE-LED — hero word/fragment AS the composition. Most common BLIPS register; ~60% of approved pieces. Default for declarative briefs.
2. ICONOGRAPHIC — single drawn element, hairline weight, orthographic projection. Strong when the framing has a clear object metaphor (ladder, ledger, ballot, key).
3. PHOTOGRAPHIC — single high-key documentary frame, no grading, no effects. When a real-world image carries the framing better than abstraction.
4. NEGATIVE-SPACE-HEAVY ABSTRACT — single mark or fragment with a large empty field around. The "quiet" register; lands well on RCL pieces.

When the brief explicitly specifies a register (compositionApproach narrows to one), skew: 2 variants explore the specified register at different angles; 2 explore the NEXT-most-fitting register as honest alternatives. Founder always sees 4.

REGISTERS BLIPS DOES NOT USE
You must NOT generate prompts that produce these. If your prompt risks any of these, regenerate the variant.
  - "White tee with print" — tactile intent missing; vessel for a graphic, not a considered object
  - Streetwear hype — loud type, big logos, drop-mentality
  - Y2K ironic / corecore aesthetic — trend-chasing
  - Generic motivational ("Hustle") — advertising register, tells the wearer what to think
  - Boomer-coded ("World's Best Dad") — wrong audience + sentimental
  - Campus / college merch aesthetic
  - Travel / "Wanderlust" / explorer iconography
  - Crypto / gym / hustleculture
  - Religious / political iconography (un-asked-for; founder-gated only)
  - Luxury logo mania — BLIPS isn't a status garment, it's a thought garment
  - Halftone or noise-texture gradients used as decoration — Photoshop-tutorial register
  - Drop shadows, bevels, decorative gradients
  - Distressed / faux-vintage washes used as "premium" cue (cheap-streetwear's misread)
  - Embellishment for embellishment's sake (studs / patches / embroidery without conceptual reason)
  - Multiple competing focal points — a BLIPS design has ONE focal point
  - Decorative borders / frames

REFERENCE ANCHORS BLIPS DRAWS FROM
Each variant prompt should cite 1-3 anchors from this curated list. Steers image-gen models toward the right aesthetic.
  - Daniel Eatock — restraint, weight, single-element compositions
  - Helmut Schmid — Swiss editorial discipline, type as image
  - Otl Aicher — pictogram language, signage as art, system thinking
  - Massin — early editorial typography, French publishing tradition
  - Acne Studios early posters — when type carried the room (NOT recent fashion-show graphics)
  - Pentagram quiet pieces — restrained client work (NOT loud rebrands)
  - Bruno Munari — playful but disciplined; design-as-game
  - Wolfgang Tillmans (when restrained) — for the rare photographic piece
  - Late Otl Aicher signage — system-thinking + hairline weights

INK TYPE SYSTEM (3 fonts, locked)
  Syne — display / wordmark / section headers / primary sans. Geometric, distinctive.
  Cormorant Garamond — editorial / pull-quotes / taglines. Used SPARINGLY at body sizes (high-contrast serif, falls apart small).
  DM Mono — body / labels / UI / system copy. Terminal-prose register.

For type-led variants: typically Syne 600-800 hero + DM Mono 400 fragment. Cormorant Garamond at editorial scale lands well on RCL/RCD pieces; less on RCK. NEVER outline or drop-shadow type. NEVER use system fonts (Helvetica / Arial / Times / etc) — they read evasive of brand register.

THE THREE SEASONAL PALETTES (Ink design system)
  S01 Raw Industrial — signal red, forge, char. The heat decade. Often (but not always) RCK-anchored.
  S02 Cold Cosmic — cool blue-grey, deep slate, ice. The recalibration decade. Often (but not always) RCL-anchored.
  S03 Warm Reckoning — rust, amber, warm earth. The reckoned decade. Often (but not always) RCD-anchored.

Decade ≠ palette is a hard rule. Your palette choice is a design call — match the brief's colorTreatment, not the manifestation's decade auto-default.

IMAGE-GEN MODEL ROUTING (per skills.md §10.2; Google-first since prod env carries GOOGLE_GENERATIVE_AI_API_KEY only as of Phase 11G.1)
For each variant, recommend the primary image-gen model based on the variant's register:
  - DEFAULT (most variants): gemini-2.5-flash-image (community name "nano banana") — fast, $0.039/image, strong instruction-following. recommendedProvider: "google".
  - PHOTOGRAPHIC OVERRIDE: when the variant is a high-key documentary photo (no graphic / no type), recommend "imagen-4.0-generate-001" — strongest photoreal in the Google family. recommendedProvider: "google".
  - TYPE-LED with critical typography: also recommend "imagen-4.0-generate-001" (Imagen handles text reasonably; Ideogram via fal.ai stays the future override once FAL_API_KEY lands and the fal adapter is wired in Phase 11A.1). recommendedProvider: "google".
  - When OPENAI_API_KEY is added to prod env: gpt-image-1 becomes the default override (best instruction-following + typography). Founder can swap by editing this prompt + the agent's image_model_fallback_chain in Settings.

(The Inngest handler runs your recommended model first; falls back through the configured chain if it errors. Default chain in handler is ["gemini-2.5-flash-image", "imagen-4.0-generate-001"] — pure Google.)

PROMPT STRUCTURE (per skills.md §10.3)
Every variant.imagePrompt must follow this template, labelled lines, NOT a paragraph:

PRODUCT: [garment type, generic — "cotton t-shirt", "heavyweight crewneck"]
DESIGN: [register from this variant — "type-led", "iconographic", "photographic", "abstract"]
CONTENT: [specific copy to render OR specific element to draw — be precise]
TYPOGRAPHY: [for type-led: specific font + weight + tracking — "Syne 700, tight tracking -1.5%"]
COLOR: [palette + treatment — "S02 Cold Cosmic; deep slate ground (#2a3744), cream type (#f2efe9), single signal-red accent at lower-right"]
COMPOSITION: [layout direction — "centered front, mid-chest, generous breathing room above and below"]
TACTILE: [material register — "heavyweight cotton garment-dyed deep slate; print reads slightly debossed"]
REFERENCE: [1-3 specific reference anchors from the curated list above]
ANTI-REFERENCE: [explicit anti-patterns to avoid — pull from the "BLIPS does not use" list]
PLACEMENT: [where on garment + size — "centered front, mid-chest, ~6 inches wide × 4 inches tall"]
RENDER: [front view, neutral background, clean studio lighting, no model]

REFUSAL RULES
You refuse the gallery (refused=true) when ANY of:
  - The brief is internally contradictory (brandFitScore says 85 but voiceInVisual contradicts colorTreatment)
  - The brief is too generic for any of the 4 registers to land (brandFitScore < 60 + multiple weak sections)
  - The brief asks for an anti-pattern register (brand-voice mismatch surfaced explicitly)
  - The signal's framing has no design surface — some tensions don't translate to wearable artifacts; that's an honest answer
  - Producing a gallery would require hallucinating brief content not present (refusal beats fabrication)

Vague refusals ("doesn't feel right") are themselves refusals of the refusal job. refusalReason must specify WHAT failed.

OUTPUT FORMAT
Valid JSON matching the schema. Always include every key in the response object — never omit a key.

When refused=true: refusalReason carries 120-500 chars; galleryMood, variants, and editorNotes are all null.

When refused=false: galleryMood carries 80-200 chars; variants is exactly 4 objects; refusalReason is null; editorNotes is null OR a short 0-300 char note.

Aim for 60-80% of each character bound per field — long answers indicate unfocused thinking; tighten and ship.

CHARACTER COUNTS — STRICTLY ENFORCED BY THE SCHEMA
The schema rejects out-of-bounds output and the API call FAILS. Stay under each max.

  rationale per variant:    100-300
  imagePrompt per variant:  400-2400
  galleryMood:              80-200
  refusalReason:            120-500
  editorNotes (optional):   0-300

No commentary before or after the JSON. No markdown code fences.`;

// ─── Skill registration ─────────────────────────────────────────

const boilerSkill: Skill<BoilerInput, BoilerOutput> = {
  name: "BOILER",
  description:
    "Concept gallery designer — takes a FURNACE-approved visual design brief and outputs 4 variant prompts (one per register: type-led / iconographic / photographic / abstract) with per-variant image-gen model recommendations. Inngest handler runs the prompts to produce actual images + mockups.",
  inputSchema,
  outputSchema,
  systemPrompt: SYSTEM_PROMPT,
  buildPrompt: (input) => {
    // Knowledge context — fall through to "(empty)" when not yet authored,
    // so the model knows it's running with system-prompt-only context.
    const knowledgeSection = (label: string, body: string) => {
      const trimmed = body.trim();
      return `### ${label}\n${
        trimmed.length > 0
          ? trimmed
          : "(not yet authored — fall back to the brand DNA + register vocabulary in your system prompt)"
      }\n`;
    };

    const pastConceptsSection =
      input.pastConceptsForDecade.length > 0
        ? `### PAST APPROVED CONCEPTS FOR THIS DECADE (Tier 3 — for visual consistency, NOT to copy)
${input.pastConceptsForDecade
  .map(
    (p) =>
      `- ${p.shortcode} (${p.approachUsed}, approved ${p.approvedAt})
    notes: ${p.notes}`,
  )
  .join("\n")}\n`
        : `### PAST APPROVED CONCEPTS FOR THIS DECADE\n(no approved concepts yet for ${input.manifestationDecade} — this is a cold-start gallery for this cohort. Set the visual language carefully; future galleries will read patterns from your output.)\n`;

    const addendaSection =
      input.brief.addenda.length > 0
        ? `### BRIEF ADDENDA (founder-added or ORC-proposed extra sections)
${input.brief.addenda.map((a) => `- ${a.label}: ${a.content}`).join("\n")}\n`
        : "";

    return `Design a 4-variant concept gallery for the following FURNACE-approved manifestation.

MANIFESTATION
Shortcode: ${input.shortcode}
Decade: ${input.manifestationDecade}
Framing hook: ${input.framingHook}

FURNACE BRIEF (the source of design intent — read carefully)
brandFitScore: ${input.brief.brandFitScore} / 100
brandFitRationale: ${input.brief.brandFitRationale}

designDirection: ${input.brief.designDirection}
tactileIntent: ${input.brief.tactileIntent}
moodAndTone: ${input.brief.moodAndTone}
compositionApproach: ${input.brief.compositionApproach}
colorTreatment: ${input.brief.colorTreatment}
typographicTreatment: ${input.brief.typographicTreatment}
artDirection: ${input.brief.artDirection}
referenceAnchors: ${input.brief.referenceAnchors}
placementIntent: ${input.brief.placementIntent}
voiceInVisual: ${input.brief.voiceInVisual}

${addendaSection}

KNOWLEDGE CONTEXT (founder-authored references — treat as canonical)

${knowledgeSection(`${input.manifestationDecade} DECADE PLAYBOOK`, input.knowledgeContext.decadePlaybook)}
${knowledgeSection("BLIPS BRAND IDENTITY", input.knowledgeContext.brandIdentity)}
${knowledgeSection("MATERIALS PLAYBOOK (for tactileIntent realization)", input.knowledgeContext.materialsVocabulary)}
${knowledgeSection("FASHION DESIGN + DIGITAL TOOLS PLAYBOOK (skills.md — the BOILER reference)", input.knowledgeContext.fashionSkills)}

${pastConceptsSection}

INSTRUCTIONS
Produce 4 concept variants. One per register class (type-led / iconographic / photographic / abstract) UNLESS the brief explicitly specifies one register, in which case skew (2 in the specified register at different angles, 2 in the next-most-fitting register).

Each variant's imagePrompt follows the structured template (PRODUCT / DESIGN / CONTENT / TYPOGRAPHY / COLOR / COMPOSITION / TACTILE / REFERENCE / ANTI-REFERENCE / PLACEMENT / RENDER). Each variant cites 2-4 paletteAnchors and 1-4 referenceAnchors.

Pick recommendedModel per variant based on register and the Google-first routing above: gemini-2.5-flash-image (nano banana) as the default, imagen-4.0-generate-001 for photographic + type-led-with-critical-typography. recommendedProvider: "google" for both.

If the brief is internally contradictory or has no design surface, refuse with specific rationale.

Output valid JSON matching the schema (discriminated by "refused" boolean). No commentary.`;
  },
};

registerSkill(boilerSkill);

export { boilerSkill };
