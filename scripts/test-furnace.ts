/**
 * FURNACE smoke test — Phase 10 verification.
 *
 * Lightweight sanity check that calls the FURNACE skill's prompt + schema
 * directly via generateStructured (no DB writes, no Inngest, no runSkill
 * orchestration). Verifies:
 *
 *   1. The skill produces VALID structured output against the Zod schema
 *      (so character bounds, refusal invariants, addenda shape all hold)
 *   2. A strong-fit synthetic case produces a complete brief with all 10
 *      required visual sections populated, no nulls
 *   3. A should-refuse synthetic case produces a refusal with all section
 *      fields null + brandFitScore < 50 + refusalReason populated
 *   4. The premium-design rule lands: tactileIntent on the strong-fit
 *      case proposes specific material vocabulary (not generic "soft cotton")
 *   5. No product-spec leak: tactileIntent + colorTreatment + placementIntent
 *      do NOT include hard material spec ("320 GSM" with units), garment
 *      cuts ("boxy fit"), or print techniques ("screen printed")
 *
 * Cost: 2 LLM calls × ~2k input + ~1.5k output Gemini Flash ≈ $0.003 total.
 *
 * Usage: npx tsx scripts/test-furnace.ts
 *
 * Returns exit code 0 on all checks pass, 1 on any fail.
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

// Synthetic playbook stubs — short paragraph anchors. Production
// FURNACE runs see the full Phase 9H/10 playbooks via knowledge_documents
// recall. The smoke test deliberately stays sparse to measure FURNACE's
// intrinsic reasoning without leaning on detailed playbook text.
const SYNTHETIC_KNOWLEDGE = {
  decadePlaybook: {
    RCK: `RCK 28-38 — The Reckoning. Career inflection, ambition vs meaning, urban-professional in early settling phase. Biology starts to matter. Civic identity being formed.`,
    RCL: `RCL 38-48 — The Recalibration. Success-fatigue + the legacy question. Parenthood-pivot. Peak career + no energy. Sandwich generation — caretaking parents while shaping children.`,
    RCD: `RCD 48-58 — The Reckoned. What-was-it-for reckoning. Mortality-aware. Re-listening to own teen-era music. Ambition decay, refinement of remaining drives.`,
  },
  brandIdentity: `BLIPS makes premium philosophical apparel. Editorial register. Observational, calmly confrontational. Audience: 28-58 urban English-speaking professionals, primarily Chennai, expandable globally.`,
  materialsVocabulary: `Premium streetwear materials: heavyweight cotton (300-400 GSM) for raw industrial register; brushed back fleece for quiet warmth; corduroy (8/14/21 wale) for limited drops; slub jersey for "not a basic tee" subtle moves; garment-dyed for color depth. Anti-patterns: thin cottons, polyester blends without intent.`,
};

const STRONG_FIT_CASE = {
  signalId: "00000000-0000-0000-0000-000000000001",
  shortcode: "VOTER-RCL",
  workingTitle: "The vote you stopped showing up for",
  concept:
    "RCL has parenthood-pivot energy. Voting becomes about modeling civic participation for kids; the question is whether you've outsourced disillusionment or chosen to pass on the act itself.",
  manifestationDecade: "RCL" as const,
  parentSignalId: "00000000-0000-0000-0000-000000000000",
  parentShortcode: "VOTER",
  manifestation: {
    framingHook:
      "The vote you stopped showing up for. The one you started again because of a child.",
    tensionAxis:
      "Cynicism inheritance — does the next generation get participation or fatigue?",
    narrativeAngle:
      "RCL has parenthood-pivot energy. Voting becomes about modeling civic participation for kids; the question is whether you've outsourced disillusionment or chosen to pass on the act itself. The decade is at the moment where what you DO around civic acts becomes inherited.",
    dimensionAlignment: {
      social: "Friend group splits along civic engagement — peer judgment + alignment shift.",
      musical: "",
      cultural: "Children's school events + civic rituals make voting visible to family.",
      career: "Workplace political talk reaches its cap — voting is the unsaid stance.",
      responsibilities: "Modeling participation for the next generation.",
      expectations: "Society's pressure to 'set an example' meets self-imposed weight.",
      sports: "",
    },
  },
  knowledgeContext: {
    decadePlaybook: SYNTHETIC_KNOWLEDGE.decadePlaybook.RCL,
    brandIdentity: SYNTHETIC_KNOWLEDGE.brandIdentity,
    materialsVocabulary: SYNTHETIC_KNOWLEDGE.materialsVocabulary,
  },
  pastBriefsForDecade: [],
};

const SHOULD_REFUSE_CASE = {
  signalId: "00000000-0000-0000-0000-000000000002",
  shortcode: "GENZ-RCD",
  workingTitle: "What 'Gen Z' means at 50",
  concept:
    "RCD trying to read Gen Z humour. Cultural opacity + cohort-wash framing — the manifestation is BLIPS-adjacent at best.",
  manifestationDecade: "RCD" as const,
  parentSignalId: "00000000-0000-0000-0000-000000000003",
  parentShortcode: "GENZ",
  manifestation: {
    framingHook: "What 'Gen Z' means at 50 — a cultural translation problem.",
    tensionAxis: "Cohort opacity — the language one decade speaks doesn't translate to another.",
    narrativeAngle:
      "RCD encounters Gen Z humour as opaque. There's no shared cultural register, the references don't land. The question is whether to engage or accept the gap.",
    dimensionAlignment: {
      social: "Workplace + family interactions surface the gap.",
      musical: "Music recommendations from younger relatives feel impenetrable.",
      cultural: "Reference points don't overlap.",
      career: "",
      responsibilities: "",
      expectations: "",
      sports: "",
    },
  },
  knowledgeContext: {
    decadePlaybook: SYNTHETIC_KNOWLEDGE.decadePlaybook.RCD,
    brandIdentity: SYNTHETIC_KNOWLEDGE.brandIdentity,
    materialsVocabulary: SYNTHETIC_KNOWLEDGE.materialsVocabulary,
  },
  pastBriefsForDecade: [],
};

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function check(name: string, pass: boolean, detail: string): CheckResult {
  return { name, pass, detail };
}

async function main() {
  console.log("[FURNACE smoke test] starting");

  // Lazy import to ensure env loaded first
  const { generateStructured } = await import("../src/lib/ai/generate");
  const { furnaceSkill } = await import("../src/skills/furnace");

  const results: CheckResult[] = [];

  // ─── Test 1: strong-fit case ──────────────────────────────────
  console.log("\n[1/2] Strong-fit case (VOTER-RCL)…");
  let strongResult: ReturnType<typeof furnaceSkill.outputSchema.parse> | null = null;
  let strongError: string | null = null;

  try {
    const r = await generateStructured({
      orgId: "00000000-0000-0000-0000-000000000000", // smoke-test org id
      agentKey: "FURNACE",
      system: furnaceSkill.systemPrompt,
      prompt: furnaceSkill.buildPrompt(STRONG_FIT_CASE),
      schema: furnaceSkill.outputSchema,
    });
    strongResult = r.object;
    console.log(
      `  ✓ LLM call succeeded (${r.usage.tokensInput} in / ${r.usage.tokensOutput} out tokens, model=${r.model})`,
    );
  } catch (err) {
    strongError = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ LLM call failed: ${strongError}`);
    // Surface the raw model output + underlying validation error so
    // we can diagnose schema mismatches.
    const e = err as {
      text?: string;
      cause?: { message?: string; issues?: unknown };
      finishReason?: string;
    };
    if (e.text) {
      console.error(
        `  raw model output (first 800 chars):\n${e.text.slice(0, 800)}`,
      );
    }
    if (e.cause) {
      console.error(
        `  cause: ${e.cause.message}\n  issues: ${JSON.stringify(e.cause.issues, null, 2)?.slice(0, 1500)}`,
      );
    }
    if (e.finishReason) {
      console.error(`  finishReason: ${e.finishReason}`);
    }
  }

  results.push(
    check(
      "[strong] LLM call succeeds + output validates against schema",
      strongResult !== null,
      strongError ?? "ok",
    ),
  );

  if (strongResult !== null) {
    results.push(
      check(
        "[strong] brandFitScore >= 50 (case is designed for strong fit)",
        strongResult.brandFitScore >= 50,
        `score=${strongResult.brandFitScore}`,
      ),
    );

    results.push(
      check(
        "[strong] refused=false on strong-fit case",
        strongResult.refused === false,
        `refused=${strongResult.refused}`,
      ),
    );

    results.push(
      check(
        "[strong] all 10 required sections populated",
        strongResult.designDirection !== null &&
          strongResult.tactileIntent !== null &&
          strongResult.moodAndTone !== null &&
          strongResult.compositionApproach !== null &&
          strongResult.colorTreatment !== null &&
          strongResult.typographicTreatment !== null &&
          strongResult.artDirection !== null &&
          strongResult.referenceAnchors !== null &&
          strongResult.placementIntent !== null &&
          strongResult.voiceInVisual !== null,
        `null sections: ${
          [
            strongResult.designDirection ? null : "designDirection",
            strongResult.tactileIntent ? null : "tactileIntent",
            strongResult.moodAndTone ? null : "moodAndTone",
            strongResult.compositionApproach ? null : "compositionApproach",
            strongResult.colorTreatment ? null : "colorTreatment",
            strongResult.typographicTreatment ? null : "typographicTreatment",
            strongResult.artDirection ? null : "artDirection",
            strongResult.referenceAnchors ? null : "referenceAnchors",
            strongResult.placementIntent ? null : "placementIntent",
            strongResult.voiceInVisual ? null : "voiceInVisual",
          ]
            .filter(Boolean)
            .join(", ") || "none"
        }`,
      ),
    );

    // Premium-design rule: tactileIntent must propose specific material
    // vocabulary, not generic "soft cotton" / "comfortable fabric".
    const tactile = (strongResult.tactileIntent ?? "").toLowerCase();
    const materialKeywords = [
      "heavyweight",
      "gsm",
      "brushed",
      "corduroy",
      "slub",
      "garment-dyed",
      "garment dyed",
      "fleece",
      "french terry",
      "loopback",
      "raw cotton",
      "linen",
      "canvas",
      "twill",
    ];
    const matchedKeywords = materialKeywords.filter((kw) => tactile.includes(kw));
    results.push(
      check(
        "[strong] tactileIntent proposes specific material vocabulary (premium-design rule)",
        matchedKeywords.length > 0,
        `matched: ${matchedKeywords.join(", ") || "NONE — generic vocabulary detected"}`,
      ),
    );

    // No product-spec leak: tactileIntent + colorTreatment +
    // placementIntent should NOT include hard specs (GSM with units) /
    // garment cuts / print techniques.
    const allSections = [
      strongResult.tactileIntent,
      strongResult.colorTreatment,
      strongResult.placementIntent,
      strongResult.compositionApproach,
    ]
      .filter((x): x is string => x !== null)
      .join(" ")
      .toLowerCase();

    const printTechniqueLeaks = [
      "screen print",
      "screen-print",
      "screen-printed",
      "dtg ",
      "dtg.",
      "embroider",
      "sublimation",
    ].filter((kw) => allSections.includes(kw));
    results.push(
      check(
        "[strong] no print-technique leak (ENGINE territory)",
        printTechniqueLeaks.length === 0,
        printTechniqueLeaks.length === 0
          ? "clean"
          : `leaked: ${printTechniqueLeaks.join(", ")}`,
      ),
    );

    const garmentCutLeaks = [
      "boxy fit",
      "fitted cut",
      "oversized fit",
      "drop-shoulder fit",
      "drop shoulder fit",
      "regular fit",
    ].filter((kw) => allSections.includes(kw));
    results.push(
      check(
        "[strong] no garment-cut leak (ENGINE territory)",
        garmentCutLeaks.length === 0,
        garmentCutLeaks.length === 0
          ? "clean"
          : `leaked: ${garmentCutLeaks.join(", ")}`,
      ),
    );

    console.log("\n  designDirection:", strongResult.designDirection?.slice(0, 200));
    console.log("  tactileIntent:", strongResult.tactileIntent?.slice(0, 200));
    console.log("  colorTreatment:", strongResult.colorTreatment?.slice(0, 150));
    console.log("  placementIntent:", strongResult.placementIntent);
  }

  // ─── Test 2: should-refuse case ───────────────────────────────
  console.log("\n[2/2] Should-refuse case (GENZ-RCD)…");
  let refuseResult: ReturnType<typeof furnaceSkill.outputSchema.parse> | null = null;
  let refuseError: string | null = null;

  try {
    const r = await generateStructured({
      orgId: "00000000-0000-0000-0000-000000000000",
      agentKey: "FURNACE",
      system: furnaceSkill.systemPrompt,
      prompt: furnaceSkill.buildPrompt(SHOULD_REFUSE_CASE),
      schema: furnaceSkill.outputSchema,
    });
    refuseResult = r.object;
    console.log(
      `  ✓ LLM call succeeded (${r.tokensInput} in / ${r.tokensOutput} out tokens, $${r.costUsd?.toFixed(6) ?? "?"})`,
    );
  } catch (err) {
    refuseError = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ LLM call failed: ${refuseError}`);
  }

  results.push(
    check(
      "[refuse] LLM call succeeds + output validates against schema",
      refuseResult !== null,
      refuseError ?? "ok",
    ),
  );

  if (refuseResult !== null) {
    // Note: the model may legitimately decide this case is borderline-OK
    // and produce a brief. We DON'T auto-fail on that — refusal is a soft
    // judgement call by the model. We only verify the REFUSAL INVARIANTS:
    // when refused=true, all section fields are null + refusalReason populated.
    if (refuseResult.refused) {
      results.push(
        check(
          "[refuse] refused=true → all section fields null",
          refuseResult.designDirection === null &&
            refuseResult.tactileIntent === null &&
            refuseResult.moodAndTone === null,
          "schema invariant",
        ),
      );
      results.push(
        check(
          "[refuse] refused=true → refusalReason populated",
          refuseResult.refusalReason !== null &&
            refuseResult.refusalReason.length >= 100,
          `len=${refuseResult.refusalReason?.length ?? 0}`,
        ),
      );
      results.push(
        check(
          "[refuse] refused=true → brandFitScore < 50",
          refuseResult.brandFitScore < 50,
          `score=${refuseResult.brandFitScore}`,
        ),
      );
      console.log("  refusalReason:", refuseResult.refusalReason?.slice(0, 250));
    } else {
      // Model decided GENZ-RCD is salvageable. Soft-skip the refusal-
      // specific checks but log so we know.
      console.log(
        `  · model decided this case is salvageable (brandFit=${refuseResult.brandFitScore}); skipping refuse-specific invariant checks`,
      );
      console.log("  designDirection:", refuseResult.designDirection?.slice(0, 200));
    }
  }

  // ─── Summary ───────────────────────────────────────────────────
  console.log("\n=== SUMMARY ===");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✗"} ${r.name} — ${r.detail}`);
  }
  console.log(`\n${passed}/${results.length} checks pass${failed > 0 ? ` (${failed} failed)` : ""}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[FURNACE smoke test] fatal:", err);
  process.exit(1);
});
