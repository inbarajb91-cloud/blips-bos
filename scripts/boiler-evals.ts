/**
 * BOILER eval suite — Phase 11G acceptance test.
 *
 * Per agents/BOILER.md: 9 of 12 cases must pass for BOILER to formally
 * ship out of Phase 11.
 *
 * Each case feeds a synthetic FURNACE-approved brief into the BOILER
 * skill (same generateStructured call the Inngest handler uses) and
 * checks the *prompt-generation* output against hard criteria. Image
 * generation is NOT exercised — that would be ~$0.04/image × 4 variants
 * × 12 cases = $1.92 per run, which makes regression iteration painful.
 * The skill's value is the prompt; render-side regressions are caught
 * separately by handler smoke tests.
 *
 * Hard criteria (each scored as a binary pass/fail per case):
 *   - Output validates against the BoilerOutput Zod schema
 *     (discriminated union — refused OR accepted with 4 variants)
 *   - When NOT refused:
 *     * exactly 4 variants
 *     * register diversity — at least 2 distinct register classes
 *       across the 4 variants (catches "all 4 are type-led" failure)
 *     * each variant.imagePrompt has at least 5 of the 11 structured
 *       slots from skills.md §10.3 (PRODUCT / DESIGN / CONTENT /
 *       TYPOGRAPHY / COLOR / COMPOSITION / TACTILE / REFERENCE /
 *       ANTI-REFERENCE / PLACEMENT / RENDER)
 *     * each variant has paletteAnchors.length >= 2 (schema enforces;
 *       belt-and-suspenders)
 *     * each variant has referenceAnchors.length >= 1
 *     * recommendedModel is a known image-model id (matches one of
 *       the wired provider patterns from src/lib/ai/image-providers.ts)
 *     * galleryMood populated (80-200 chars)
 *     * no marketing-copy in any rationale or galleryMood
 *   - When refused:
 *     * variants undefined
 *     * refusalReason populated (120-500 chars)
 *     * no marketing-copy in refusalReason
 *
 * Soft criteria (reported, not blocking):
 *   - All 4 variants from same provider — uniformity warning (skews
 *     to "everything OpenAI" failure)
 *   - referenceAnchors leans default-streetwear — push past Acne /
 *     ALD only
 *
 * Cost: 12 × ~3500 input + ~2500 output Gemini 2.5 Pro calls ≈
 * $0.05 per run.
 *
 * Usage: npx tsx scripts/boiler-evals.ts
 */

import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  const envFile = readFileSync(".env.local", "utf-8");
  for (const line of envFile.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

type Decade = "RCK" | "RCL" | "RCD";
type Expectation = "accept" | "refuse";

interface BriefFixture {
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
  addenda?: Array<{ label: string; content: string }>;
}

interface EvalCase {
  id: string;
  description: string;
  input: {
    shortcode: string;
    decade: Decade;
    framingHook: string;
    brief: BriefFixture;
  };
  expected: Expectation;
}

// Synthetic knowledge stubs — sparse on purpose so eval measures BOILER's
// intrinsic reasoning over its ability to parrot detailed knowledge text.
const EVAL_KNOWLEDGE = {
  decadePlaybooks: {
    RCK: `RCK 28-38. Career inflection, ambition vs meaning. Editorial > illustrative; type-led with weight; architectural composition; declarative pieces.`,
    RCL: `RCL 38-48. Success-fatigue + legacy question. Quieter than RCK; negative-space-heavy compositions; single stark element with breathing room; muted register.`,
    RCD: `RCD 48-58. What-was-it-for reckoning. Reference-anchored designs (handset metal type, mid-century editorial, archival photo treatment); spectral, accepting, sharp-edged with grief.`,
  },
  brandIdentity: `BLIPS makes premium philosophical apparel. 28-58 urban professionals, primarily Chennai, expandable globally. Voice: observational, calmly confrontational, sharp, editorial. Smirks, doesn't shout. Reads at 3 distances.`,
  materialsVocabulary: `Anchor materials: heavyweight cotton 300-400 GSM (raw industrial), brushed back fleece (warm reckoning), corduroy (limited drops), garment-dyed cotton (premium colorways), slub jersey, French terry, cotton-linen blend. Anti-pattern: thin polyester, generic 180 GSM ringspun.`,
  fashionSkills: `Reference anchors: Daniel Eatock (deadpan editorial), Schmid (typography), Otl Aicher (1972 Munich pictograms), Acne Studios early collections, Pentagram quiet projects, Bruno Munari (Italian rationalism), Wolfgang Tillmans (documentary photo). Anti-references: faux-vintage washes, tribal/script tattoo fonts, anime/manga quotation, drop-shadow effects, "live laugh love" register, gradient text, photoshop bevels.

The 4 registers BOILER generates:
TYPE-LED — hero word/fragment AS composition. ~60% of approved pieces.
ICONOGRAPHIC — single drawn element, hairline weight, orthographic projection.
PHOTOGRAPHIC — single high-key documentary frame, no grading, no effects.
ABSTRACT — negative-space dominant, single mark or framing line.
MIXED — type + iconographic OR type + photographic; only when the brief explicitly justifies it.`,
};

// ─── Test fixtures (12 cases) ────────────────────────────────────────

const STRONG_BRIEF_BASE: BriefFixture = {
  designDirection:
    "A type-led declarative piece. Single hero phrase set in heavy editorial sans, sized to the chest, no decorative elements. The phrase carries the weight; everything else gets out of its way.",
  tactileIntent:
    "Heavyweight cotton, 320-360 GSM, garment-dyed for premium hand. Ink should sit slightly inset on the cloth — felt before it's read. Avoid plastic-feel screen print; this is closer to a discharge or pigment-dye finish.",
  moodAndTone:
    "Declarative, taut, slightly anxious — RCK voice. The phrase reads like a thought you'd suppress at a family lunch.",
  compositionApproach:
    "Centered chest, type bleeds to within 12% of the side seams. No header / footer ornaments. The garment is the frame.",
  colorTreatment:
    "S01 Raw Industrial palette — base unbleached natural with deep slate ink. Justification: the slate's coldness lets the type carry tension without color noise.",
  typographicTreatment:
    "Syne Bold for the hero phrase, slightly tracked-out. No secondary type. No tagline. The single typeface carries everything.",
  artDirection:
    "Editorial restraint. Reference anchors: Eatock for the deadpan delivery; Pentagram quiet for the spacing economy. Strictly NOT streetwear.",
  referenceAnchors:
    "Daniel Eatock 'I Am An Artist'; Pentagram's quieter editorial work; Schmid's grids without the typography flourish.",
  placementIntent:
    "Centered chest, scaling to fit a 32-44 chest range without deformation.",
  voiceInVisual:
    "The voice in the visual is the voice in the phrase. Confrontation through quietness, not volume.",
  brandFitScore: 84,
  brandFitRationale:
    "Strong fit. The brief leans into BLIPS's editorial register without slipping into streetwear or marketing copy. Tactile intent specifies premium materials with justification. Type-led primary register is decade-appropriate (RCK declarative).",
};

const EVAL_CASES: EvalCase[] = [
  // ─── Strong-fit briefs (4 cases — should accept with 4 diverse variants) ──
  {
    id: "VOTER-RCK",
    description: "Civic identity — first conviction vote at 32",
    input: {
      shortcode: "VOTRCK",
      decade: "RCK",
      framingHook:
        "The first vote you cast that the family won't post about — civic identity stops being inherited at 32.",
      brief: {
        ...STRONG_BRIEF_BASE,
        designDirection:
          "Type-led, declarative. The phrase 'first vote / no post' centered, weight Syne Bold, deeply tracked. No icons. The silence at Sunday lunch IS the design — leave breathing room.",
      },
    },
    expected: "accept",
  },
  {
    id: "LADDER-RCL",
    description: "Iconographic ladder metaphor — RCL career-fatigue",
    input: {
      shortcode: "LADDRCL",
      decade: "RCL",
      framingHook:
        "Climbing a ladder while not knowing what's at the top — RCL success-fatigue, peak career, no energy.",
      brief: {
        designDirection:
          "Icon-led variant register. Single hairline ladder rendered orthographic, scaled to chest, with one rung absent near the top — the visual ambiguity carries the framing. Type plays a supporting role only.",
        tactileIntent:
          "Heavyweight brushed back fleece for an RCL hoodie execution, 380 GSM. Garment-dyed in a muted earth tone. The fleece's warmth offsets the ladder's coldness.",
        moodAndTone:
          "Weighted, dryly observational. RCL voice — weary but not defeated. The visual acknowledges the climb without celebrating it.",
        compositionApproach:
          "Centered, single hairline ladder occupying ~60% of vertical chest. Negative space dominates; the missing rung is the loudest part.",
        colorTreatment:
          "S03 Warm Reckoning — garment in deep moss; ladder in ivory ink. Justification: warmth grounds the metaphor without making it literal.",
        typographicTreatment:
          "Optional small DM Mono caption beneath the ladder, no larger than 9pt. Cormorant Garamond would be too ornate here; mono carries the data-point register.",
        artDirection:
          "Otl Aicher pictograms for the line weight; Schmid for the grid economy. Decisively NOT illustrative.",
        referenceAnchors:
          "Aicher 1972 Munich pictograms for line discipline; Eatock's hairline icon work.",
        placementIntent:
          "Centered chest. Optional small repeat at the back hem (one rung).",
        voiceInVisual:
          "Quiet, weighted. The visual whispers what RCL feels.",
        brandFitScore: 81,
        brandFitRationale:
          "Strong fit. Iconographic register is a deliberate choice for RCL's quieter palette. The missing rung is the editorial idea.",
      },
    },
    expected: "accept",
  },
  {
    id: "HEIRLOOM-RCD",
    description: "Photographic archival — RCD inheritance audit",
    input: {
      shortcode: "HEIRRCD",
      decade: "RCD",
      framingHook:
        "What we inherited that we didn't choose — RCD inherited belief audit, mortality-aware.",
      brief: {
        designDirection:
          "Photographic register. Single high-key documentary frame of a family object (a brass key, an old ledger, a photograph) printed at chest scale, no grading, no effects. The object IS the design.",
        tactileIntent:
          "Premium garment-dyed cotton, 300 GSM, slightly washed for the spectral RCD register. Print as photographic discharge so the image sinks into the cloth. Not glossy.",
        moodAndTone:
          "Spectral, accepting, sharp-edged with grief. RCD voice. The object reads like an archival photograph from the wearer's parents' generation.",
        compositionApproach:
          "Centered, single image scaled to ~40% of chest width. Generous negative space all around. No type.",
        colorTreatment:
          "S02 Cold Cosmic — desaturated print on bone-white garment. Justification: the desaturation carries the archival feel.",
        typographicTreatment:
          "No primary type. Optional inside-neck label in DM Mono with the piece's archival reference (year, decade).",
        artDirection:
          "Wolfgang Tillmans for the documentary clarity; mid-century photo books for the framing economy. Not vintage filters.",
        referenceAnchors:
          "Tillmans documentary frames; Magnum mid-century photo essays; archival photograph treatment.",
        placementIntent:
          "Centered chest. Inside-neck small ref label.",
        voiceInVisual:
          "The voice is in the object's quietness. The viewer's attention does the work.",
        brandFitScore: 79,
        brandFitRationale:
          "Strong fit. Photographic register is decade-appropriate (RCD reference-anchored). Tactile intent specifies discharge print preserving the cloth's feel.",
      },
    },
    expected: "accept",
  },
  {
    id: "PUNCTUATION-RCK",
    description: "Type-led punctuation — RCK ambivalence",
    input: {
      shortcode: "PUNCRCK",
      decade: "RCK",
      framingHook:
        "An ellipsis at the end of every email — RCK passive ambivalence as career posture.",
      brief: {
        ...STRONG_BRIEF_BASE,
        designDirection:
          "Type-led extreme — three dots only, scaled to chest height, evenly spaced. The punctuation IS the design. RCK declarative-by-omission.",
        compositionApproach:
          "Three round dots, equally spaced, centered chest. Each dot ~12% of chest height. Vast negative space around them.",
        typographicTreatment:
          "Custom drawn dots OR Syne Bold ellipsis character scaled massive. Decision: no other type whatsoever.",
        artDirection:
          "Pentagram quiet for the negative-space discipline; Tibor Kalman for the pun-free bluntness.",
        brandFitScore: 86,
      },
    },
    expected: "accept",
  },

  // ─── Partial-fit briefs (4 cases — gallery generates but with concerns) ──
  {
    id: "VAGUE-PALETTE-RCL",
    description: "Vague color treatment — gallery should still generate",
    input: {
      shortcode: "VAGRCL",
      decade: "RCL",
      framingHook:
        "Friendships in WhatsApp groups — RCL connection-as-archive.",
      brief: {
        designDirection:
          "Mix of type + abstract negative-space framing. The phrase 'last seen 2 years ago' anchored small in one corner; the rest is breathing room. RCL quietness through restraint and absence.",
        tactileIntent:
          "Heavyweight cotton, 320 GSM, garment-dyed for premium hand. Print as discharge so the type sinks into the cloth, not sits on top.",
        moodAndTone:
          "Weighted, RCL voice, quiet sadness without melodrama. The visual register matches a WhatsApp 'last seen' line — observational, accepting.",
        compositionApproach:
          "Single small phrase top-left corner, ~8% of chest. Rest of chest is empty. Negative space dominates as the design's loudest element.",
        colorTreatment:
          "Muted palette — earth tones. Specific colors TBD per render. Garment-dyed in a quiet middle-tone that lets the print disappear at distance.",
        typographicTreatment:
          "DM Mono for the phrase, very small (8-10pt). Cormorant Garamond would feel too ornate. Mono carries the data-point register the framing requires.",
        artDirection:
          "Pentagram quiet for the spacing economy; Munari for the negative-space discipline. Decisively NOT illustrative; reads at touch distance only.",
        referenceAnchors:
          "Bruno Munari Italian rationalism; Pentagram editorial restraint; mid-century data-point design from publications like Domus.",
        placementIntent:
          "Top-left chest, very small. Optional small repeat at the back hem in same scale and weight.",
        voiceInVisual:
          "The empty space carries the framing. Volume comes from absence, not from any single design element shouting.",
        brandFitScore: 64,
        brandFitRationale:
          "Partial fit. Premise lands strongly on RCL connection-as-archive but colorTreatment is underspecified — risk of palette drift on regen. Tactile + composition compensate.",
      },
    },
    expected: "accept",
  },
  {
    id: "MIXED-DIRECTION-RCD",
    description: "Mixed register — RCD listening to teen-era music",
    input: {
      shortcode: "TEENRCD",
      decade: "RCD",
      framingHook:
        "Re-listening to your teen-era cassettes at 51 — RCD ambition decay, refinement of remaining drives.",
      brief: {
        designDirection:
          "Mixed register — small photographic frame of a cassette tape upper-left, hand-drawn track-list type running down the right edge in Cormorant Garamond italic.",
        tactileIntent:
          "Garment-dyed cotton 300 GSM, slightly washed for the spectral RCD register. Print as photographic discharge for the cassette image; standard pigment for the track-list type.",
        moodAndTone:
          "Spectral, RCD voice. Specific, archival, slightly humourous about the artefact's wear and age.",
        compositionApproach:
          "Cassette image ~25% upper-left chest; track-list type runs down the right side, italic, varying line lengths matching real cassette liner-note typography.",
        colorTreatment:
          "S02 Cold Cosmic for the cassette image desaturation; warm cream for the type. Garment in bone-white so both elements read against neutral ground.",
        typographicTreatment:
          "Cormorant Garamond italic for the track-list (this is one of the rare BLIPS uses of italic — justified by the mixtape liner-note register, not decorative).",
        artDirection:
          "Wolfgang Tillmans for the documentary cassette frame; Tibor Kalman editorial for the track-list arrangement; archival mixtape liner notes for typography rhythm.",
        referenceAnchors:
          "Wolfgang Tillmans documentary frames; Tibor Kalman editorial; archival mixtape liner notes from late-80s through mid-90s independent labels.",
        placementIntent:
          "Full chest with both elements coexisting. Cassette upper-left, track-list down the right edge.",
        voiceInVisual:
          "The voice is in the specific track-list — names, durations, the tape's wear marks. The cassette is the artefact, the type is the witness.",
        brandFitScore: 72,
        brandFitRationale:
          "Partial-strong fit. Mixed register is risky but this brief justifies it (the mixtape framing requires both photo and type). Cormorant italic exception is intentional.",
      },
    },
    expected: "accept",
  },
  {
    id: "GENERIC-WORD-RCK",
    description: "Generic single word — gallery should accept but warn",
    input: {
      shortcode: "GENWRDRCK",
      decade: "RCK",
      framingHook:
        "The word 'TIRED' as a 32-year-old's status update — RCK exhaustion-as-identity.",
      brief: {
        ...STRONG_BRIEF_BASE,
        designDirection:
          "Type-led. Single word 'TIRED' set massively, centered. The blunt declarative IS the design.",
      },
    },
    expected: "accept",
  },
  {
    id: "OBVIOUS-METAPHOR-RCL",
    description: "Hourglass — common metaphor, BOILER should still generate",
    input: {
      shortcode: "GLASSRCL",
      decade: "RCL",
      framingHook: "Time accelerating in your 40s — RCL temporal compression.",
      brief: {
        designDirection:
          "Iconographic. A single hourglass rendered hairline, orthographic, with the upper bulb empty. The empty upper bulb carries the framing — it's the visual joke RCL knows.",
        tactileIntent:
          "Heavyweight cotton 320 GSM, garment-dyed in muted earth tones for premium hand. Print as discharge so the hairline icon sits inset on the cloth.",
        moodAndTone:
          "Weighted, RCL voice, dryly observational. The visual acknowledges the time-pressure without dramatising it.",
        compositionApproach:
          "Centered chest, single hourglass occupying ~30% of vertical chest. Generous negative space all around — the icon needs breathing room.",
        colorTreatment:
          "S03 Warm Reckoning — sand-coloured icon on charcoal garment. Justification: warmth grounds the metaphor without making it literal.",
        typographicTreatment:
          "No primary type. Optional small DM Mono caption beneath the icon at ~9pt; Cormorant would be too ornate against the hairline weight.",
        artDirection:
          "Otl Aicher 1972 Munich pictograms for the line discipline; Eatock hairline icon work; Schmid grid economy for the negative space.",
        referenceAnchors:
          "Otl Aicher 1972 Munich pictograms; Daniel Eatock hairline icons; Pentagram quiet editorial restraint.",
        placementIntent:
          "Centered chest. Optional small repeat at the back hem in the same hairline weight.",
        voiceInVisual:
          "The empty upper bulb is the loudest detail. Volume comes from the absence of sand at the top, not from any element shouting.",
        brandFitScore: 62,
        brandFitRationale:
          "Partial fit. The hourglass is the obvious metaphor for time — risk of cliche. Treatment specificity (empty upper bulb, hairline weight) helps differentiate.",
      },
    },
    expected: "accept",
  },

  // ─── Refused briefs (4 cases — should refuse with specific reason) ─────
  {
    id: "CONTRADICTORY-PALETTE-RCK",
    description:
      "Brief contradicts itself on palette — should refuse for incoherence",
    input: {
      shortcode: "CTRPLT",
      decade: "RCK",
      framingHook:
        "Career ambition at 32 — the inflection point where every choice closes another door.",
      brief: {
        designDirection:
          "Type-led declarative piece in editorial register, quiet and minimal. RCK declarative voice, single hero phrase carrying the weight.",
        tactileIntent:
          "Heavyweight cotton 320 GSM garment-dyed for premium hand. Print as discharge so the type sinks into the cloth.",
        moodAndTone:
          "Quiet, declarative, RCK voice — but the visual must also feel maximally loud and attention-grabbing. Both at the same time.",
        compositionApproach:
          "Centered chest, single hero phrase, restrained spacing. But also edge-to-edge maximal density with no negative space anywhere on the chest.",
        colorTreatment:
          "Warm earth tones AND high-contrast neon cyan. Both must be primary. The palette must read warm-and-neon simultaneously without compromise.",
        typographicTreatment:
          "Syne Bold for the hero phrase, set quietly with restrained tracking — but ALSO set to scream for attention with shock-value typography effects.",
        artDirection:
          "Editorial restraint following Pentagram quiet and Eatock minimal — but rendered with maximalist neon impact and viral graphic-design energy.",
        referenceAnchors:
          "Pentagram quiet editorial; Daniel Eatock minimal; viral graphic design influencers; maximalist neon poster design from the 90s.",
        placementIntent:
          "Centered chest, scaled to fit a 32-44 chest range without deformation.",
        voiceInVisual:
          "Quiet but loud at the same time. Both registers must coexist within a single garment without compromise to either.",
        brandFitScore: 58,
        brandFitRationale:
          "Partial fit on premise but every section pairs an editorial direction with a maximalist contradiction. Internally inconsistent — not solvable through generation.",
      },
    },
    expected: "refuse",
  },
  {
    id: "CONTRADICTORY-VOICE-RCD",
    description:
      "Brief asks for loud + spectral voices simultaneously — should refuse",
    input: {
      shortcode: "CTRVCE",
      decade: "RCD",
      framingHook:
        "Mortality — RCD reckoning with what was it for, mortality-aware, ambition decay.",
      brief: {
        designDirection:
          "Photographic-register design that screams attention, optimised for shock-value scrolling on social media. Should also feel quiet and editorial.",
        tactileIntent:
          "Cotton or whatever fabric reads premium. Garment-dyed for premium hand. Print method TBD — should feel both archival and freshly-printed.",
        moodAndTone:
          "Spectral, accepting, sharp-edged with grief — but ALSO loud, attention-grabbing, scroll-stopping for social engagement. Both registers must coexist within the same piece.",
        compositionApproach:
          "Maximum visual density. Edge-to-edge composition with no negative space — but ALSO restrained editorial layout with generous breathing room.",
        colorTreatment:
          "Bright, saturated, high-energy palette in the spectral RCD register. Desaturated archival tones with high-contrast neon highlights — both must lead.",
        typographicTreatment:
          "Cormorant Garamond italic at massive size, set against high-contrast scrim, designed to stop the scroll while also reading as quiet editorial restraint.",
        artDirection:
          "Wolfgang Tillmans documentary clarity but with maximalist viral-content energy and shock-value composition. Both registers required at once.",
        referenceAnchors:
          "Wolfgang Tillmans for restraint; viral graphic design influencers for energy; maximalist neon poster design alongside mid-century photo book restraint.",
        placementIntent:
          "All-over print. Also centered chest only. Also back-yoke only. Multiple placements simultaneously.",
        voiceInVisual:
          "Spectral and loud at once. Quiet and shocking at the same time. Both registers in the same garment without compromise to either.",
        brandFitScore: 53,
        brandFitRationale:
          "Partial fit on RCD framing but every section pairs a spectral direction with a maximalist contradiction. Internally contradictory throughout.",
      },
    },
    expected: "refuse",
  },
  {
    id: "ASKS-FAUX-VINTAGE-RCD",
    description: "Brief asks for forbidden faux-vintage register — refuse",
    input: {
      shortcode: "FAUXVTG",
      decade: "RCD",
      framingHook:
        "Nostalgia for a college era — RCD reckoning with what we inherited.",
      brief: {
        designDirection:
          "Distressed faux-vintage tee aesthetic. Heavy washes, fake worn-in look, retro-collegiate type with cracked-paint texture overlays. Aggressive faux-aging effects.",
        tactileIntent:
          "Cotton, distressed garment finish with sandblasted look. Pre-faded dye for that vintage thrift-store feel; surface treatment for fake worn-in patina.",
        moodAndTone:
          "Vintage, lived-in, retro-collegiate register popular on Etsy and Pinterest. The faux-aging carries the entire emotional weight.",
        compositionApproach:
          "Center chest with arched 'BLIPS UNIVERSITY' type and an emblem. Standard collegiate-merchandise crest layout with mascot underneath.",
        colorTreatment:
          "Faded burgundy and cream — the standard faux-vintage college palette. Print colours pre-distressed to look 30 years old straight off the press.",
        typographicTreatment:
          "Bold collegiate serif with cracked-paint texture overlay. Drop shadows and faux-distressed strokes. Multiple weights and decorative flourishes.",
        artDirection:
          "Faux-vintage college merch register, popular on Etsy and Pinterest. Ironic-college aesthetic with deliberate fake-aging treatment throughout.",
        referenceAnchors:
          "Vintage college merchandise from 70s-90s; faux-distressed apparel from streetwear brands chasing retro authenticity; Etsy independent thrift-aesthetic sellers.",
        placementIntent:
          "Front centered chest crest with mascot below. Optional sleeve hits with athletic department type.",
        voiceInVisual:
          "Faux-nostalgic, lived-in, retro-collegiate. The voice mimics decades-old college merchandise without earning that age.",
        brandFitScore: 50,
        brandFitRationale:
          "Borderline. Premise around nostalgia could work but execution direction is a documented BLIPS anti-pattern (faux-vintage washes per skills.md §1.3).",
      },
    },
    expected: "refuse",
  },
  {
    id: "TOO-GENERIC-RCK",
    description:
      "Brief is so generic it has no design surface — should refuse",
    input: {
      shortcode: "GENERIC",
      decade: "RCK",
      framingHook:
        "Being a person at work — generally about workplace identity and the day-to-day grind.",
      brief: {
        designDirection:
          "A nice-looking design about life and work that resonates with people. Should look premium and thoughtful and considered. Should feel high-end without being too much.",
        tactileIntent:
          "Quality fabric with premium feel and soft hand. High-quality construction throughout. Should feel expensive when you touch it but also accessible.",
        moodAndTone:
          "Premium, quality, considered, thoughtful, sophisticated. Should resonate emotionally without being too direct or specific. Universal feeling.",
        compositionApproach:
          "A good composition that works visually. Balanced and thoughtful with strong visual hierarchy. Should look intentional and considered throughout.",
        colorTreatment:
          "Tasteful colours that feel premium and sophisticated. Should work for everyone. Considered palette that complements the garment.",
        typographicTreatment:
          "A good typeface that reads well at multiple sizes. Should feel premium and considered. Modern but not too trendy. Classic but not too dated.",
        artDirection:
          "High-end, premium, thoughtful direction. Should feel like quality apparel without being too obvious about it. Considered execution throughout.",
        referenceAnchors:
          "Premium apparel brands generally; thoughtful design movements; quality-focused fashion houses with considered aesthetics.",
        placementIntent:
          "Where it looks best on the garment. Strategic placement that complements the overall composition.",
        voiceInVisual:
          "Premium and considered. Should feel sophisticated without being pretentious. Universal appeal that resonates broadly.",
        brandFitScore: 52,
        brandFitRationale:
          "Partial fit. The brief uses premium-vocabulary throughout without specifying any concrete framing or specific design surface — borderline marketing-copy register.",
      },
    },
    expected: "refuse",
  },
];

// ─── Validation tokens ────────────────────────────────────────────

// Marketing-copy register — tokens that flag a BLIPS voice slip
const MARKETING_COPY_TOKENS = [
  "stunning",
  "amazing",
  "premium quality",
  "high-quality",
  "elegant design",
  "perfect for",
  "must-have",
  "stylish",
  "trendy",
  "fashionable",
  "eye-catching",
  "show off",
  "wow factor",
];

// Image-gen prompt structured slot tokens — skills.md §10.3 template
const PROMPT_SLOT_TOKENS = [
  "PRODUCT",
  "DESIGN",
  "CONTENT",
  "TYPOGRAPHY",
  "COLOR",
  "COMPOSITION",
  "TACTILE",
  "REFERENCE",
  "ANTI-REFERENCE",
  "PLACEMENT",
  "RENDER",
];

// Known image-model id patterns from src/lib/ai/image-providers.ts
const KNOWN_MODEL_PATTERNS = [
  /^gpt-image-/i,
  /^dall-e-/i,
  /^imagen-/i,
  /^gemini-.*-image/i,
  /^fal\//i,
  /^replicate\//i,
  /^openrouter-image\//i,
  /^openai\//i,
  /^google\//i,
];

const STREETWEAR_DEFAULT_TOKENS = ["acne studios", "ald", "aimé leon dore"];

// ─── Assertion helpers ────────────────────────────────────────────

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

function countSlots(prompt: string): number {
  let n = 0;
  for (const slot of PROMPT_SLOT_TOKENS) {
    // Match "SLOT:" or "SLOT —" or "SLOT -" anchored at line start or whitespace
    const re = new RegExp(`(^|\\n|\\s)${slot}\\s*[:\\-—]`, "i");
    if (re.test(prompt)) n += 1;
  }
  return n;
}

function modelIsKnown(modelId: string): boolean {
  return KNOWN_MODEL_PATTERNS.some((p) => p.test(modelId));
}

function uniqueRegisters(
  variants: Array<{ register: string }>,
): number {
  return new Set(variants.map((v) => v.register)).size;
}

function uniqueProviders(
  variants: Array<{ recommendedProvider: string }>,
): number {
  return new Set(variants.map((v) => v.recommendedProvider)).size;
}

// ─── Per-case run ─────────────────────────────────────────────────

interface CaseResult {
  id: string;
  passed: boolean;
  schemaValid: boolean;
  refused: boolean | null;
  expectedRefused: boolean;
  failures: string[];
  warnings: string[];
  durationMs: number;
  rawError?: string;
}

async function runOneCase(
  c: EvalCase,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runSkill: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signalsTable: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  orgId: string,
): Promise<CaseResult> {
  const start = Date.now();
  const failures: string[] = [];
  const warnings: string[] = [];

  const { eq } = await import("drizzle-orm");
  const { createInitialJourney } = await import("../src/lib/orc/journey");

  // Disposable parent + manifestation child, same pattern as furnace-evals.
  const parentDbShortcode = `EBP${c.id.slice(0, 3)}${Date.now().toString(36).slice(-4)}`;
  const [parent] = await db
    .insert(signalsTable)
    .values({
      orgId,
      shortcode: parentDbShortcode,
      workingTitle: `eval-parent-${c.id}`,
      concept: c.input.framingHook,
      source: "direct",
      status: "IN_STOKER",
    })
    .returning({ id: signalsTable.id, shortcode: signalsTable.shortcode });

  const childDbShortcode = `EBC${c.id.slice(0, 3)}${Date.now().toString(36).slice(-4)}`;
  const [child] = await db
    .insert(signalsTable)
    .values({
      orgId,
      parentSignalId: parent.id,
      manifestationDecade: c.input.decade,
      shortcode: childDbShortcode,
      workingTitle: `eval-${c.id}`,
      concept: c.input.framingHook,
      source: "stoker_manifestation",
      status: "IN_BOILER",
    })
    .returning({ id: signalsTable.id, shortcode: signalsTable.shortcode });

  try {
    await createInitialJourney({ signalId: parent.id, createdBy: null });
    await createInitialJourney({ signalId: child.id, createdBy: null });

    const result = await runSkill({
      agentKey: "BOILER",
      orgId,
      signalId: child.id,
      input: {
        signalId: child.id,
        shortcode: c.input.shortcode,
        manifestationDecade: c.input.decade,
        framingHook: c.input.framingHook,
        brief: {
          ...c.input.brief,
          addenda: c.input.brief.addenda ?? [],
        },
        knowledgeContext: {
          decadePlaybook: EVAL_KNOWLEDGE.decadePlaybooks[c.input.decade],
          brandIdentity: EVAL_KNOWLEDGE.brandIdentity,
          materialsVocabulary: EVAL_KNOWLEDGE.materialsVocabulary,
          fashionSkills: EVAL_KNOWLEDGE.fashionSkills,
        },
        pastConceptsForDecade: [],
      },
    });

    const out = result.output;

    // Discriminated-union check
    if (typeof out.refused !== "boolean") {
      failures.push("output.refused not boolean (schema drift)");
      return {
        id: c.id,
        passed: false,
        schemaValid: false,
        refused: null,
        expectedRefused: c.expected === "refuse",
        failures,
        warnings,
        durationMs: Date.now() - start,
      };
    }

    const expectedRefused = c.expected === "refuse";

    // Refusal-expectation match
    if (out.refused !== expectedRefused) {
      failures.push(
        `expected refused=${expectedRefused}, observed refused=${out.refused}`,
      );
    }

    if (out.refused) {
      // Refused-state checks
      if (
        typeof out.refusalReason !== "string" ||
        out.refusalReason.trim().length < 120 ||
        out.refusalReason.trim().length > 500
      ) {
        failures.push("refusalReason missing or out of bounds (120-500)");
      }
      if (
        typeof out.refusalReason === "string" &&
        containsAny(out.refusalReason, MARKETING_COPY_TOKENS)
      ) {
        failures.push("marketing-copy register in refusalReason");
      }
      if (Array.isArray((out as { variants?: unknown[] }).variants)) {
        failures.push("refused output should not have variants array");
      }
    } else {
      // Accepted-state checks
      const variants = out.variants;
      if (!Array.isArray(variants) || variants.length !== 4) {
        failures.push(
          `expected exactly 4 variants, observed ${Array.isArray(variants) ? variants.length : "non-array"}`,
        );
      } else {
        // Register diversity
        const distinct = uniqueRegisters(variants);
        if (distinct < 2) {
          failures.push(
            `register diversity too low — only ${distinct} distinct register(s) across 4 variants`,
          );
        }

        // Provider uniformity warning
        if (uniqueProviders(variants) === 1) {
          warnings.push(
            `all 4 variants from the same provider (${variants[0]?.recommendedProvider}) — uniformity skew`,
          );
        }

        for (const v of variants) {
          // Slot count
          const slots = countSlots(v.imagePrompt);
          if (slots < 5) {
            failures.push(
              `variant ${v.variantSlug} imagePrompt has only ${slots} structured slots (need 5+ from skills.md §10.3)`,
            );
          }
          // Palette anchors
          if (
            !Array.isArray(v.paletteAnchors) ||
            v.paletteAnchors.length < 2
          ) {
            failures.push(
              `variant ${v.variantSlug} paletteAnchors missing or short (need 2+)`,
            );
          }
          // Reference anchors
          if (
            !Array.isArray(v.referenceAnchors) ||
            v.referenceAnchors.length < 1
          ) {
            failures.push(
              `variant ${v.variantSlug} referenceAnchors missing`,
            );
          }
          // Known model
          if (typeof v.recommendedModel !== "string" || !modelIsKnown(v.recommendedModel)) {
            failures.push(
              `variant ${v.variantSlug} recommendedModel '${v.recommendedModel}' not a known image-model id`,
            );
          }
          // Marketing copy in rationale
          if (
            typeof v.rationale === "string" &&
            containsAny(v.rationale, MARKETING_COPY_TOKENS)
          ) {
            failures.push(
              `variant ${v.variantSlug} rationale slips into marketing-copy register`,
            );
          }
          // Streetwear default warning
          if (
            Array.isArray(v.referenceAnchors) &&
            v.referenceAnchors.every((r: string) =>
              containsAny(r, STREETWEAR_DEFAULT_TOKENS),
            )
          ) {
            warnings.push(
              `variant ${v.variantSlug} referenceAnchors are streetwear-default only`,
            );
          }
        }
      }

      // Gallery mood
      if (
        typeof out.galleryMood !== "string" ||
        out.galleryMood.trim().length < 80 ||
        out.galleryMood.trim().length > 200
      ) {
        failures.push(
          "galleryMood missing or out of bounds (80-200)",
        );
      } else if (containsAny(out.galleryMood, MARKETING_COPY_TOKENS)) {
        failures.push("marketing-copy register in galleryMood");
      }
    }

    return {
      id: c.id,
      passed: failures.length === 0,
      schemaValid: true,
      refused: out.refused,
      expectedRefused,
      failures,
      warnings,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    failures.push(`uncaught: ${err}`);
    return {
      id: c.id,
      passed: false,
      schemaValid: false,
      refused: null,
      expectedRefused: c.expected === "refuse",
      failures,
      warnings,
      rawError: err,
      durationMs: Date.now() - start,
    };
  } finally {
    try {
      await db.delete(signalsTable).where(eq(signalsTable.id, child.id));
      await db.delete(signalsTable).where(eq(signalsTable.id, parent.id));
    } catch (cleanupErr) {
      console.error(
        `[boiler-evals] cleanup failed for ${c.id} (${child?.shortcode}):`,
        cleanupErr,
      );
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("[boiler-evals] Phase 11G — running 12 cases against BOILER...\n");

  const { db } = await import("../src/db");
  const { signals, orgs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { runSkill } = await import("../src/lib/orc/orchestrator");
  await import("../src/skills");

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ BLIPS org not found. Run scripts/seed.ts first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.slug} (${org.id})\n`);

  const results: CaseResult[] = [];
  for (const c of EVAL_CASES) {
    process.stdout.write(
      `[${c.id.padEnd(28)}] ${c.description.slice(0, 48).padEnd(48)} `,
    );
    const r = await runOneCase(c, runSkill, signals, db, org.id);
    results.push(r);
    const pass = r.passed ? "PASS" : "FAIL";
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    const refusedTag =
      r.refused === null ? "no-output" : r.refused ? "refused" : "accepted";
    process.stdout.write(`${pass} (${refusedTag}, ${time})\n`);
    if (r.failures.length > 0) {
      r.failures.forEach((f) => console.log(`     ✗ ${f}`));
    }
    if (r.warnings.length > 0) {
      r.warnings.forEach((w) => console.log(`     ⚠ ${w}`));
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const threshold = 9;

  console.log("\n[boiler-evals] summary");
  console.log(`  passed: ${passed} / ${total}`);
  console.log(`  threshold: ${threshold}`);
  console.log(
    `  result: ${passed >= threshold ? "ACCEPTANCE PASS ✓" : "ACCEPTANCE FAIL ✗"}`,
  );

  // Refusal hit-rate
  const expectRefuse = results.filter((r) => r.expectedRefused);
  const expectAccept = results.filter((r) => !r.expectedRefused);
  const correctRefuse = expectRefuse.filter((r) => r.refused === true).length;
  const correctAccept = expectAccept.filter((r) => r.refused === false).length;
  console.log(
    `  refusal hit-rate: ${correctRefuse}/${expectRefuse.length} expected-refuse, ${correctAccept}/${expectAccept.length} expected-accept`,
  );

  process.exit(passed >= threshold ? 0 : 1);
}

main().catch((err) => {
  console.error("[boiler-evals] fatal:", err);
  process.exit(1);
});
