/**
 * FURNACE eval suite — Phase 10G acceptance test.
 *
 * Per agents/FURNACE.md: 10 of 12 cases must pass for FURNACE to formally
 * ship out of Phase 10.
 *
 * Each case feeds a synthetic STOKER manifestation context into the
 * FURNACE skill (same generateStructured call the Inngest handler uses)
 * and checks the output against hard criteria.
 *
 * Hard criteria (each scored as a binary pass/fail per case):
 *   - Output validates against the FurnaceOutput Zod schema
 *     (character bounds, types, nullable rules)
 *   - brandFitScore matches expected band:
 *       strong  → ≥ 70
 *       partial → 50-69
 *       refuse  → < 50
 *   - When NOT refused: tactileIntent populated and contains at least
 *     one Tier-1 material vocabulary token (premium-design rule)
 *   - When NOT refused: no GSM hard-spec leakage (e.g. "320 GSM"),
 *     no print-technique words (screen print / DTG / sublimation),
 *     no silhouette words (boxy / drop-shoulder / oversized / fitted)
 *     anywhere in any section — ENGINE's territory
 *   - When NOT refused: colorTreatment references a seasonal palette
 *     (S01/S02/S03) OR contains an explicit justification token
 *   - When NOT refused: typographicTreatment references at least one
 *     Ink type family (Syne / Cormorant / DM Mono)
 *   - When refused: all 10 design sections null
 *
 * Soft criteria (reported, not blocking):
 *   - referenceAnchors goes past streetwear default (presence of
 *     non-streetwear anchors — Acne / ALD acceptable but not exclusive)
 *   - voiceInVisual doesn't read like marketing copy (no "amazing",
 *     "stunning", "premium quality", etc.)
 *
 * Synthetic playbook stubs are short, decade-flavoured paragraphs.
 * Production FURNACE runs see the full MATERIALS.md + decade playbooks
 * + BRAND.md via knowledge_documents recall — these stubs deliberately
 * stay sparse so we measure FURNACE's intrinsic reasoning, not its
 * ability to parrot detailed knowledge text.
 *
 * Cost: 12 × ~3k input + ~2.5k output Gemini 2.5 Flash calls ≈ $0.020-
 * 0.030 per run.
 *
 * Usage: npx tsx scripts/furnace-evals.ts
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
type FitBand = "strong" | "partial" | "refuse";

interface ManifestationFixture {
  framingHook: string;
  tensionAxis: string;
  narrativeAngle: string;
  dimensionAlignment: {
    social: string;
    musical: string;
    cultural: string;
    career: string;
    responsibilities: string;
    expectations: string;
    sports: string;
  };
}

interface EvalCase {
  id: string;
  description: string;
  input: {
    shortcode: string;
    workingTitle: string;
    concept: string;
    decade: Decade;
    manifestation: ManifestationFixture;
  };
  expected: {
    band: FitBand;
  };
}

// Synthetic knowledge stubs — production reads full markdown from
// knowledge_documents. Eval stubs are sparse on purpose.
const EVAL_KNOWLEDGE = {
  decadePlaybooks: {
    RCK: `RCK 28-38 — The Reckoning. Career inflection, ambition vs meaning, urban-professional in early settling phase. Biology starts to matter. Civic identity being formed. The decade where every choice closes another door. Voice register: declarative, taut, slightly anxious about the doors closing.`,
    RCL: `RCL 38-48 — The Recalibration. Success-fatigue with the legacy question opening underneath. Parenthood-pivot. Peak career + no energy. Friendships in WhatsApp groups. Sandwich generation — caretaking parents while shaping children. Voice register: weighted, dryly observational, weary but not defeated.`,
    RCD: `RCD 48-58 — The Reckoned. What-was-it-for reckoning. Mortality-aware. Re-listening to own teen-era music. Ambition decay, refinement of remaining drives. Inherited belief audit. Generativity vs irrelevance. Voice register: spectral, accepting, sharp-edged with grief.`,
  },
  brandIdentity: `BLIPS makes premium philosophical apparel. 28-58 urban professionals, primarily Chennai, expandable globally. Voice: observational, calmly confrontational, sharp, editorial. Smirks doesn't shout. Every product is a wearable artifact that names something specific about a decade of life. The bar is editorial — weak fits become dilutive product.`,
  materialsVocabulary: `MATERIALS PLAYBOOK (Tier 2). Anchor materials: heavyweight cotton (300-400 GSM, raw industrial register), brushed back fleece (warm reckoning, hoodies), corduroy (limited drops, vintage character), garment-dyed cotton (premium colorways), slub jersey (subtle "not a basic tee"), French terry (mid-weight casual considered), cotton-linen blend (warmer-weather pieces). Anti-pattern: thin polyester blends, generic 180 GSM ringspun jersey ("white tee with print" failure mode).`,
};

const EVAL_CASES: EvalCase[] = [
  // ─── Strong-fit cases (4) ──────────────────────────────────────────
  {
    id: "VOTER-RCK",
    description: "Civic identity formation — first-time conviction vote at 32",
    input: {
      shortcode: "VOTRCK",
      workingTitle: "The first vote you cast that the family won't post about",
      concept:
        "A 32-year-old casts a ballot for a different party than the one their parents have voted since 1991. The vote isn't dramatic; the silence at Sunday lunch the next week is. The decade where political identity stops being inherited.",
      decade: "RCK",
      manifestation: {
        framingHook:
          "The first ballot you cast that the family won't post about",
        tensionAxis:
          "Inherited political identity colliding with the first vote that's actually yours — the silence at Sunday lunch is the real cost",
        narrativeAngle:
          "RCK voters are negotiating a new civic identity that doesn't fit the family WhatsApp group's map. The decade isn't about radical politics; it's about the first vote that wasn't auto-checked. The design surface is the quiet dissent — a ballot, a thumbprint, a name written in ink.",
        dimensionAlignment: {
          social: "Voter-shaped friend groups starting to fracture",
          musical: "(not engaged)",
          cultural: "Civic media consumed differently than parents",
          career: "(not engaged)",
          responsibilities: "Civic responsibility newly internalised",
          expectations:
            "Family expecting the inherited vote; the voter delivering otherwise",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "strong" },
  },
  {
    id: "VOTER-RCL",
    description: "Modeling civic conviction for one's child — RCL parental",
    input: {
      shortcode: "VOTRCL",
      workingTitle: "Taking your kid to the polling booth so they see what conviction looks like",
      concept:
        "A 42-year-old takes their 11-year-old to the polling booth — not because the kid can vote, but because the parent realised at 11 they didn't know what voting was, and that's the inheritance they're trying to break.",
      decade: "RCL",
      manifestation: {
        framingHook:
          "Taking your kid to the polling booth so they see what conviction looks like",
        tensionAxis:
          "Civic-inheritance question — what gets passed down vs. what gets explicitly chosen, with a kid watching",
        narrativeAngle:
          "RCL voters are now civic-modelling for their children. The decade has the legacy question opened underneath — the kid is watching, and the parent is suddenly aware of every silence about politics they grew up with. The design surface is the booth, the line, the thumbprint, the kid's hand in the parent's.",
        dimensionAlignment: {
          social: "(not engaged)",
          musical: "(not engaged)",
          cultural: "Civic mediation across two generations",
          career: "(not engaged)",
          responsibilities: "Generational responsibility newly explicit",
          expectations: "Kid expecting an answer the parent didn't get at 11",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "strong" },
  },
  {
    id: "DEBT-RCD",
    description: "Final reckoning of household financial choices — RCD",
    input: {
      shortcode: "DEBTRD",
      workingTitle: "The home loan you'll close before your last working year",
      concept:
        "A 54-year-old looks at their final home-loan EMIs and realises the EMI calendar will outlast their current job. The decade of finishing the math on financial commitments made at 30.",
      decade: "RCD",
      manifestation: {
        framingHook:
          "The home loan you'll close before your last working year",
        tensionAxis:
          "Promises made by a 30-year-old being honoured — or revised — by a 54-year-old who knows what they actually meant",
        narrativeAngle:
          "RCD voters are auditing what the financial commitments at 30 actually bought. Not regret — reckoning. The math has an end date now. The design surface is the EMI sheet, the calendar, the slow tally.",
        dimensionAlignment: {
          social: "(not engaged)",
          musical: "(not engaged)",
          cultural: "Financial maturity as cultural signal",
          career: "Career runway shorter than the loan",
          responsibilities: "Long-term promises being audited",
          expectations: "Self-expectations revised down to size",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "strong" },
  },
  {
    id: "ROOTS-RCK",
    description: "Golden-handcuff promotion — pure RCK career inflection",
    input: {
      shortcode: "ROOTSK",
      workingTitle: "The promotion that locks more than it opens",
      concept:
        "A 33-year-old engineer accepts a Director title and realises the new responsibilities consume the bandwidth they'd been saving to pivot. The validation arrives at the same moment as the trap.",
      decade: "RCK",
      manifestation: {
        framingHook:
          "The promotion that locks more than it opens",
        tensionAxis:
          "External validation arriving at the same moment as the realisation that this title forecloses three other futures",
        narrativeAngle:
          "RCK careerists are negotiating a contract they thought they'd signed at 22. The promotion isn't bad; it's load-bearing. The decade is the audit — what were you optimising for, and is this it? The design surface is the title card, the locked door, the contract clause.",
        dimensionAlignment: {
          social: "(not engaged)",
          musical: "(not engaged)",
          cultural: "Career-as-identity meeting career-as-trap",
          career:
            "Promotion arriving with weight — not just status, but bandwidth confiscation",
          responsibilities:
            "New responsibilities replacing the bandwidth saved for the pivot",
          expectations:
            "Family / friends celebrating; you doing arithmetic instead",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "strong" },
  },

  // ─── Partial-fit cases (4) ─────────────────────────────────────────
  {
    id: "COFFEE-RCK",
    description: "Coffee-shop closing nostalgia — partial RCK fit (universal-ish)",
    input: {
      shortcode: "COFFRK",
      workingTitle: "The coffee shop where you used to write closing on a Tuesday",
      concept:
        "A 32-year-old's regular cafe announces closure. They wrote their first product spec there. The cafe is universal nostalgia — but at 32, the decade-tax is starting to matter.",
      decade: "RCK",
      manifestation: {
        framingHook:
          "The coffee shop where you used to write closing on a Tuesday",
        tensionAxis:
          "A universal nostalgia framing trying to find decade-specific weight",
        narrativeAngle:
          "The cafe-closing framing is generic, but at 32, the timestamps start to matter — the cafe was an anchor for an older self that's becoming unrecognisable. The decade-specific edge is thin; the brand-fit will live or die on whether the design can find an anchor that isn't 'cafe culture'.",
        dimensionAlignment: {
          social: "Third-place rituals in transit",
          musical: "(not engaged)",
          cultural: "Nostalgia as decade-marker",
          career: "Career memories anchored to a place now closing",
          responsibilities: "(not engaged)",
          expectations: "(not engaged)",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "partial" },
  },
  {
    id: "BIOCAR-RCL",
    description: "Mid-career biology-clock framing — RCL marginal",
    input: {
      shortcode: "BIORCL",
      workingTitle: "Negotiating fertility windows with your performance review calendar",
      concept:
        "A 41-year-old re-reads a fertility chart against an internal promotion calendar and realises the math doesn't work. The decade where biology stops being a future variable.",
      decade: "RCL",
      manifestation: {
        framingHook:
          "Negotiating fertility windows with your performance review calendar",
        tensionAxis:
          "Career calendar vs biology calendar — both sharp, neither flexible",
        narrativeAngle:
          "RCL professionals are caught between two finite calendars. The framing is real but the visual surface is hard — biology framings often slip into either medicalised or cliched territory. Brand-fit is partial: the tension is RCL-specific but the visual register needs careful editorial hand to avoid medical-pamphlet or motivational-poster failure modes.",
        dimensionAlignment: {
          social: "Friend groups split between kid-having and not",
          musical: "(not engaged)",
          cultural: "Biology as cultural reckoning",
          career: "Performance review timing at odds with body timing",
          responsibilities: "Choices being made finite",
          expectations: "Family / partner expectations layering",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "partial" },
  },
  {
    id: "LEDGR-RCD",
    description: "Bookkeeping nostalgia — RCD marginal",
    input: {
      shortcode: "LDGRRD",
      workingTitle: "The handwritten ledger your father kept — the math wasn't the point",
      concept:
        "A 53-year-old finds their father's hand-kept ledger. The math is wrong in places. The point was the ritual, not the accounting. The decade where you start understanding your parents' rituals.",
      decade: "RCD",
      manifestation: {
        framingHook:
          "The handwritten ledger your father kept — the math wasn't the point",
        tensionAxis:
          "Rituals inherited that were never about their stated purpose",
        narrativeAngle:
          "RCD reckoners are decoding parental rituals that didn't make sense at 30. The framing is RCD-specific but visual surface is narrow — handwritten / archival / sepia is the easy default that may slip into greeting-card register. Editorial hand needed.",
        dimensionAlignment: {
          social: "(not engaged)",
          musical: "(not engaged)",
          cultural: "Inherited rituals being audited",
          career: "(not engaged)",
          responsibilities:
            "Parent's responsibilities now legible, decades late",
          expectations: "Self-expectations softened by the audit",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "partial" },
  },
  {
    id: "NOSIG-RCL",
    description: "Job dissatisfaction without a clear pivot — RCL partial",
    input: {
      shortcode: "NOSGRL",
      workingTitle: "The job you can't quit and can't keep at 44",
      concept:
        "A 44-year-old VP looks at the next quarter and feels nothing. Not burnout, not boredom — just absence of signal. The decade where dissatisfaction stops being a directional clue.",
      decade: "RCL",
      manifestation: {
        framingHook: "The job you can't quit and can't keep at 44",
        tensionAxis:
          "Dissatisfaction without direction — RCL's particular stuckness",
        narrativeAngle:
          "RCL professionals know the dissatisfaction but the next-step compass is broken. Framing is RCL-specific but the visual surface tends toward generic 'career malaise' if not handled carefully. Brand-fit partial — needs sharper editorial than the framing alone provides.",
        dimensionAlignment: {
          social: "(not engaged)",
          musical: "(not engaged)",
          cultural: "Mid-career stagnation as cultural moment",
          career: "Senior title, no signal",
          responsibilities: "Mortgage / school fees keeping the seat warm",
          expectations:
            "Self-expectations revised but still not aligned with the chair",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "partial" },
  },

  // ─── Should-refuse cases (4) ────────────────────────────────────────
  {
    id: "GENZ-RCD",
    description: "GenZ humor coded RCD — cohort wash, FURNACE should refuse",
    input: {
      shortcode: "GENZRD",
      workingTitle: "The 'no thoughts head empty' meme as a Slack reaction",
      concept:
        "A reflection on Gen Z absurdist humor and how it lands in mixed-cohort workplaces.",
      decade: "RCD",
      manifestation: {
        framingHook:
          "The 'no thoughts head empty' meme as a Slack reaction at 51",
        tensionAxis:
          "GenZ register being decoded by an older cohort — observational",
        narrativeAngle:
          "An RCD-aged manager noticing GenZ Slack culture. The framing is observational but cohort-washed — the decade tension is thin, and the cultural moment belongs to a younger cohort. Brand voice would dilute trying to occupy this space.",
        dimensionAlignment: {
          social: "Cross-generational workplace dynamics",
          musical: "(not engaged)",
          cultural: "GenZ humor as cultural moment",
          career: "(not engaged)",
          responsibilities: "(not engaged)",
          expectations: "(not engaged)",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "refuse" },
  },
  {
    id: "CRYPTO-RCD",
    description: "Crypto-bro reckoning at 50 — fundamentally not BLIPS",
    input: {
      shortcode: "CRYPRD",
      workingTitle: "The crypto bag you're still down 60% on at 51",
      concept:
        "A reckoning about a 2021 crypto buy still underwater in 2026.",
      decade: "RCD",
      manifestation: {
        framingHook: "The crypto bag you're still down 60% on at 51",
        tensionAxis:
          "Speculation reckoning — gambling losses being processed as life-stage event",
        narrativeAngle:
          "An RCD-aged investor sitting with a 60% drawdown on a 2021 buy. The decade-anchoring is thin; this reads more as personal-finance-bro content than BLIPS philosophical apparel. Voice register would have to chase the moment rather than name it.",
        dimensionAlignment: {
          social: "(not engaged)",
          musical: "(not engaged)",
          cultural: "Speculation culture",
          career: "(not engaged)",
          responsibilities: "(not engaged)",
          expectations: "Bag bag bag",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "refuse" },
  },
  {
    id: "SUMMER-RCK",
    description: "Seasonal advertising framing — brand-voice mismatch",
    input: {
      shortcode: "SMRRCK",
      workingTitle: "Summer hits different at 32",
      concept:
        "A reflection on how summer feels different in your 30s — beach trips, sunscreen, etc.",
      decade: "RCK",
      manifestation: {
        framingHook: "Summer hits different at 32",
        tensionAxis: "Seasonal nostalgia softening at 32",
        narrativeAngle:
          "The framing reads as a seasonal advertising hook, not a philosophical observation. RCK has summer-coded entries (beach-trip math, sunscreen budgets) but this framing has no specific tension — it's wash. Brand-voice mismatch: BLIPS doesn't write about seasonal moods.",
        dimensionAlignment: {
          social: "Beach trips with friends",
          musical: "Summer playlists",
          cultural: "Summer as cultural moment",
          career: "(not engaged)",
          responsibilities: "(not engaged)",
          expectations: "(not engaged)",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "refuse" },
  },
  {
    id: "TRENDS-RCL",
    description: "Trend-chasing framing — anti-brand, FURNACE should refuse",
    input: {
      shortcode: "TRNDRL",
      workingTitle: "Adding ✨ to your Slack messages at 42",
      concept:
        "Trend adoption tax — using emoji norms in mid-career.",
      decade: "RCL",
      manifestation: {
        framingHook: "Adding ✨ to your Slack messages at 42",
        tensionAxis: "Trend-adoption tax in mid-career chat norms",
        narrativeAngle:
          "An observation about emoji etiquette adoption in mid-career. The framing is genuinely RCL-coded but trend-chasing in nature — chases a moment rather than naming a tension. Brand voice doesn't run after micro-trends; this is anti-brand by construction.",
        dimensionAlignment: {
          social: "Emoji etiquette in workplace chat",
          musical: "(not engaged)",
          cultural: "Trend adoption as cultural marker",
          career: "Workplace communication norms",
          responsibilities: "(not engaged)",
          expectations: "(not engaged)",
          sports: "(not engaged)",
        },
      },
    },
    expected: { band: "refuse" },
  },
];

// ─── Hard-criteria checks ─────────────────────────────────────────

// Tier-1 material vocabulary tokens (case-insensitive substring match).
const MATERIAL_TOKENS = [
  "heavyweight cotton",
  "mid-weight cotton",
  "midweight cotton",
  "slub jersey",
  "brushed back",
  "fleece",
  "garment-dyed",
  "garment dyed",
  "corduroy",
  "french terry",
  "loopback",
  "linen blend",
  "cotton/linen",
  "raw cotton",
  "ringspun",
];

// Anti-pattern tokens — should NEVER appear in any FURNACE section.
// GSM detection is regex-based (e.g. "320 GSM", "320GSM", "320-grams").
const PRINT_TECHNIQUE_TOKENS = [
  "screen print",
  "screen-print",
  "screenprint",
  "dtg",
  "direct-to-garment",
  "direct to garment",
  "sublimation",
  "discharge ink",
  "puff print",
  "embroidery",
  "puff ink",
  "plastisol",
];

const SILHOUETTE_TOKENS = [
  "boxy fit",
  "boxy cut",
  "drop-shoulder",
  "drop shoulder",
  "oversized fit",
  "oversize fit",
  "fitted cut",
  "slim cut",
  "relaxed fit",
  "regular fit",
];

const SEASONAL_PALETTE_TOKENS = ["S01", "S02", "S03", "Raw Industrial", "Cold Cosmic", "Warm Reckoning"];

// Justification tokens — used when colorTreatment doesn't reference a
// seasonal palette but explicitly justifies the departure.
const JUSTIFICATION_TOKENS = [
  "depart",
  "outside",
  "rather than",
  "instead of",
  "not anchored",
  "not from",
  "not seasonal",
  "non-seasonal",
];

const INK_TYPE_TOKENS = ["Syne", "Cormorant", "DM Mono"];

const MARKETING_COPY_TOKENS = [
  "amazing",
  "stunning",
  "premium quality",
  "world-class",
  "best-in-class",
  "elevate your",
  "must-have",
  "iconic",
];

const STREETWEAR_DEFAULT_TOKENS = [
  "streetwear",
  "supreme",
  "kith",
  "fear of god",
];

function bandForScore(score: number): FitBand {
  if (score >= 70) return "strong";
  if (score >= 50) return "partial";
  return "refuse";
}

function bandMatches(observed: FitBand, expected: FitBand): boolean {
  return observed === expected;
}

function containsAny(text: string | null | undefined, tokens: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return tokens.some((tok) => lower.includes(tok.toLowerCase()));
}

function gsmRegex(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\b\d{2,4}\s*-?\s*(gsm|grams\/sq|grams per)/i.test(text);
}

interface CaseResult {
  id: string;
  passed: boolean;
  schemaValid: boolean;
  bandObserved: FitBand | null;
  bandExpected: FitBand;
  bandMatch: boolean;
  observedScore: number | null;
  failures: string[];
  warnings: string[];
  rawError?: string;
  durationMs: number;
}

async function runOneCase(
  c: EvalCase,
  runSkill: typeof import("../src/lib/orc/orchestrator").runSkill,
  signalsTable: typeof import("../src/db/schema").signals,
  db: typeof import("../src/db").db,
  orgId: string,
): Promise<CaseResult> {
  const start = Date.now();
  const failures: string[] = [];
  const warnings: string[] = [];

  const { eq } = await import("drizzle-orm");
  const { createInitialJourney } = await import("../src/lib/orc/journey");

  // Disposable parent signal — IN_STOKER, no parentSignalId. The child
  // signal references this parent's UUID. Both are deleted in finally.
  const parentDbShortcode = `EFP${c.id.slice(0, 4)}${Date.now().toString(36).slice(-4)}`;
  const [parent] = await db
    .insert(signalsTable)
    .values({
      orgId,
      shortcode: parentDbShortcode,
      workingTitle: `eval-parent-${c.id}`,
      concept: c.input.concept,
      source: "direct",
      status: "IN_STOKER",
    })
    .returning({ id: signalsTable.id, shortcode: signalsTable.shortcode });

  // Disposable child manifestation signal — IN_FURNACE, parent = parent.id,
  // decade set, source = stoker_manifestation (per the schema check
  // requiring source==='stoker_manifestation' iff decade is set).
  const childDbShortcode = `EFC${c.id.slice(0, 4)}${Date.now().toString(36).slice(-4)}`;
  const [child] = await db
    .insert(signalsTable)
    .values({
      orgId,
      parentSignalId: parent.id,
      manifestationDecade: c.input.decade,
      shortcode: childDbShortcode,
      workingTitle: c.input.workingTitle,
      concept: c.input.concept,
      source: "stoker_manifestation",
      status: "IN_FURNACE",
    })
    .returning({ id: signalsTable.id, shortcode: signalsTable.shortcode });

  let createdParentJourney = false;
  let createdChildJourney = false;
  try {
    // Both rows need an active journey for runSkill's getActiveJourney
    // to succeed. createInitialJourney is idempotent enough for evals.
    await createInitialJourney({ signalId: parent.id, createdBy: null });
    createdParentJourney = true;
    await createInitialJourney({ signalId: child.id, createdBy: null });
    createdChildJourney = true;

    const result = await runSkill<
      import("../src/skills/furnace").FurnaceInput,
      import("../src/skills/furnace").FurnaceOutput
    >({
      agentKey: "FURNACE",
      orgId,
      signalId: child.id,
      input: {
        signalId: child.id,
        shortcode: c.input.shortcode,
        workingTitle: c.input.workingTitle,
        concept: c.input.concept,
        manifestationDecade: c.input.decade,
        parentSignalId: parent.id,
        parentShortcode: parentDbShortcode.slice(0, 10),
        manifestation: c.input.manifestation,
        knowledgeContext: {
          decadePlaybook: EVAL_KNOWLEDGE.decadePlaybooks[c.input.decade],
          brandIdentity: EVAL_KNOWLEDGE.brandIdentity,
          materialsVocabulary: EVAL_KNOWLEDGE.materialsVocabulary,
        },
        pastBriefsForDecade: [],
      },
    });

    const out = result.output;
    const observedScore = out.brandFitScore;
    const bandObserved = bandForScore(observedScore);
    const bandMatch = bandMatches(bandObserved, c.expected.band);
    if (!bandMatch) {
      failures.push(
        `band expected ${c.expected.band}, observed ${bandObserved} (score ${observedScore})`,
      );
    }

    if (out.refused) {
      // Refused-state checks: all 10 design sections must be null.
      const sectionsThatShouldBeNull: Array<keyof typeof out> = [
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
      ];
      for (const k of sectionsThatShouldBeNull) {
        if (out[k] !== null) {
          failures.push(`refused but ${String(k)} not null`);
        }
      }
      if (!out.refusalReason) {
        failures.push("refused but refusalReason empty");
      }
    } else {
      // Non-refused: all 10 sections populated + invariants.
      const requiredText = {
        designDirection: out.designDirection,
        tactileIntent: out.tactileIntent,
        moodAndTone: out.moodAndTone,
        compositionApproach: out.compositionApproach,
        colorTreatment: out.colorTreatment,
        typographicTreatment: out.typographicTreatment,
        artDirection: out.artDirection,
        referenceAnchors: out.referenceAnchors,
        placementIntent: out.placementIntent,
        voiceInVisual: out.voiceInVisual,
      };
      for (const [k, v] of Object.entries(requiredText)) {
        if (typeof v !== "string" || v.trim().length === 0) {
          failures.push(`section ${k} empty when not refused`);
        }
      }

      // Premium-design rule — tactileIntent must reference Tier-1 material
      // vocabulary (or MATERIALS.md vocabulary, but eval stubs only seed
      // Tier-1).
      if (!containsAny(out.tactileIntent, MATERIAL_TOKENS)) {
        failures.push(
          "tactileIntent missing material vocabulary (premium-design rule)",
        );
      }

      // Anti-pattern: no GSM hard-spec leakage in any section.
      const allSectionsText = Object.values(requiredText).filter(
        (v): v is string => typeof v === "string",
      );
      const concatenated = allSectionsText.join("\n");
      if (gsmRegex(concatenated)) {
        failures.push("GSM hard-spec leakage detected (ENGINE territory)");
      }

      // Anti-pattern: no print-technique words.
      if (containsAny(concatenated, PRINT_TECHNIQUE_TOKENS)) {
        failures.push("print-technique leakage detected (ENGINE territory)");
      }

      // Anti-pattern: no silhouette words.
      if (containsAny(concatenated, SILHOUETTE_TOKENS)) {
        failures.push("silhouette/cut leakage detected (ENGINE territory)");
      }

      // colorTreatment must reference a seasonal palette OR explicitly
      // justify the departure.
      const colorOk =
        containsAny(out.colorTreatment, SEASONAL_PALETTE_TOKENS) ||
        containsAny(out.colorTreatment, JUSTIFICATION_TOKENS);
      if (!colorOk) {
        failures.push(
          "colorTreatment doesn't reference S01/S02/S03 OR justify departure",
        );
      }

      // typographicTreatment must reference at least one Ink family.
      if (!containsAny(out.typographicTreatment, INK_TYPE_TOKENS)) {
        failures.push("typographicTreatment missing Ink family reference");
      }

      // ─── Soft criteria (warnings, non-blocking) ───────────────
      if (containsAny(concatenated, MARKETING_COPY_TOKENS)) {
        warnings.push("marketing-copy register detected (BLIPS voice slip)");
      }
      if (
        containsAny(out.referenceAnchors, STREETWEAR_DEFAULT_TOKENS) &&
        !out.referenceAnchors?.match(/[,;]/)
      ) {
        // Warning: streetwear defaults present without a comma/semicolon
        // (suggesting NO additional non-streetwear anchors layered).
        warnings.push(
          "referenceAnchors leans streetwear-only (push past streetwear default)",
        );
      }
    }

    const passed = failures.length === 0;
    return {
      id: c.id,
      passed,
      schemaValid: true,
      bandObserved,
      bandExpected: c.expected.band,
      bandMatch,
      observedScore,
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
      bandObserved: null,
      bandExpected: c.expected.band,
      bandMatch: false,
      observedScore: null,
      failures,
      warnings,
      rawError: err,
      durationMs: Date.now() - start,
    };
  } finally {
    try {
      // Cascade-deletes the agent_outputs / journeys / etc. via FK chain.
      await db.delete(signalsTable).where(eq(signalsTable.id, child.id));
      await db.delete(signalsTable).where(eq(signalsTable.id, parent.id));
    } catch (cleanupErr) {
      console.error(
        `[furnace-evals] cleanup failed for ${c.id} (${child?.shortcode}):`,
        cleanupErr,
      );
    }
    void createdParentJourney;
    void createdChildJourney;
  }
}

async function main() {
  console.log("[furnace-evals] Phase 10G — running 12 cases against FURNACE...\n");

  const { db } = await import("../src/db");
  const { signals, orgs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { runSkill } = await import("../src/lib/orc/orchestrator");
  // Ensure skill registry is populated
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
      `[${c.id.padEnd(11)}] ${c.description.slice(0, 56).padEnd(56)} `,
    );
    const r = await runOneCase(c, runSkill, signals, db, org.id);
    results.push(r);
    const pass = r.passed ? "PASS" : "FAIL";
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    if (r.observedScore !== null) {
      process.stdout.write(
        `${pass} (band=${r.bandObserved} score=${r.observedScore}, ${time})\n`,
      );
    } else {
      process.stdout.write(`${pass} (no output, ${time})\n`);
    }
    if (r.failures.length > 0) {
      r.failures.forEach((f) => console.log(`     ✗ ${f}`));
    }
    if (r.warnings.length > 0) {
      r.warnings.forEach((w) => console.log(`     ⚠ ${w}`));
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const threshold = 10;

  console.log("\n[furnace-evals] summary");
  console.log(`  passed: ${passed} / ${total}`);
  console.log(`  threshold: ${threshold}`);
  console.log(
    `  result: ${passed >= threshold ? "ACCEPTANCE PASS ✓" : "ACCEPTANCE FAIL ✗"}`,
  );

  // Distribution by band
  const byBand: Record<FitBand, { hit: number; total: number }> = {
    strong: { hit: 0, total: 0 },
    partial: { hit: 0, total: 0 },
    refuse: { hit: 0, total: 0 },
  };
  results.forEach((r) => {
    byBand[r.bandExpected].total += 1;
    if (r.bandMatch) byBand[r.bandExpected].hit += 1;
  });
  console.log(
    `  band hit-rate: strong ${byBand.strong.hit}/${byBand.strong.total}, partial ${byBand.partial.hit}/${byBand.partial.total}, refuse ${byBand.refuse.hit}/${byBand.refuse.total}`,
  );

  // Average score on cases that did produce a brief
  const scored = results.filter((r): r is CaseResult & { observedScore: number } => typeof r.observedScore === "number");
  if (scored.length > 0) {
    const avg = (
      scored.reduce((sum, r) => sum + r.observedScore, 0) / scored.length
    ).toFixed(1);
    console.log(`  avg brand-fit score across all cases: ${avg}`);
  }

  process.exit(passed >= threshold ? 0 : 1);
}

main().catch((err) => {
  console.error("[furnace-evals] fatal:", err);
  process.exit(1);
});
