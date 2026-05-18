/**
 * Phase 11D FURNACE schema upgrade verification (May 18, 2026).
 *
 * Targeted test: invoke the upgraded FURNACE skill directly (no Inngest, no DB
 * write) against a real STOKER manifestation context — and assert that the 6
 * new machine-readable spec fields populate as expected.
 *
 * Uses the actual COMP-RCL signal that produced the bad "5 unread badges with
 * garbled $99+" output earlier today, so we're testing on the exact case the
 * upgrade was scoped against.
 *
 * Pass criteria:
 *   1. Output validates against the new FurnaceOutput schema (6 new fields present)
 *   2. exactText is populated (not null) when refused=false
 *   3. colorPalette has 1+ entries with valid hex codes
 *   4. compositionRules is 300+ chars
 *   5. typographySpec has 1+ entries OR is explicitly empty (not undefined)
 *   6. printSeparationStrategy is populated with technique + separations
 *   7. fullGarmentTreatment is populated
 *   8. Anti-pattern: exactText.front does NOT contain "UNREAD: 999+" or
 *      similar example-only strings from the prose
 *   9. typographySpec entry count ≤ 6 (avoid gpt-image-1 small-text failure)
 *
 * Also prints what the new BOILER prompt would look like with this brief, so
 * we can compare against the prior prompt that produced the bad output.
 *
 * Usage: npx tsx scripts/verify-furnace-schema-upgrade.ts
 * Cost: 1× Gemini 2.5 Flash call ≈ $0.001
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

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} ${name} — ${detail}`);
}

// Synthetic STOKER manifestation context that mirrors COMP-RCL's real STOKER output.
// We don't fetch from prod DB so the script is self-contained.
const COMP_RCL_MANIFESTATION = {
  framingHook: "The WhatsApp group that became your second job.",
  tensionAxis:
    "The relentless cognitive load of curated digital performance — staying visible in parent groups while questioning whether any of it matters.",
  narrativeAngle:
    "RCL parents in WhatsApp groups (school, society, family) are doing unpaid emotional labor that resembles a second job. The competitive parenting performance (kids' grades, activities, milestones) feels like a reporting structure they didn't sign up for. Underneath: am I doing this for my kid, or am I scoring points in a game I never agreed to play?",
  dimensionAlignment: {
    social:
      "WhatsApp groups are the dominant social surface for RCL parents — peer pressure, comparison, status signaling.",
    musical: "",
    cultural:
      "Indian middle-class parenting culture intersects with global Instagram-parenting performance.",
    career:
      "The parenting performance feels like a second career running in parallel to the actual job.",
    responsibilities:
      "The unpaid emotional labor of group-chat curation falls disproportionately on one parent.",
    expectations:
      "Expectation that parents perform constant availability + competitive achievement in shared groups.",
    sports: "",
  },
};

const COMP_RCL_INPUT = {
  signalId: "9b5c7fe8-a63a-4b7a-a2fa-62beb4a4c810",
  shortcode: "COMP-RCL",
  workingTitle: "The WhatsApp group that became your second job.",
  concept:
    "RCL parents in WhatsApp groups are doing unpaid emotional labor that resembles a second job.",
  manifestationDecade: "RCL" as const,
  parentSignalId: "ca6a9c33-8ad5-4757-b620-84c4bcb37af9",
  parentShortcode: "COMP",
  manifestation: COMP_RCL_MANIFESTATION,
  knowledgeContext: {
    // Use small stubs — the live handler hydrates from knowledge_documents;
    // this verify just exercises the schema + prompt.
    decadePlaybook:
      "RCL (The Recalibration, 38-48): success-fatigue, parenthood-pivot, WhatsApp-group dynamics, sandwich generation. Palette S02 Cold Cosmic — deep slate, cool blue-grey, pale cosmic. Visual register: muted, reflective, observational, sardonic. The decade asks 'is this what I built?'",
    brandIdentity:
      "BLIPS makes premium philosophical apparel. Audience: 28-58 urban Chennai + global. Voice: observational, calmly confrontational, sharp, editorial. Smirks, doesn't shout. Premium = multi-element designs with conceptual logic, never wordmark-on-tee.",
    materialsVocabulary:
      "Mid-weight garment-dyed cotton: substantial hand with lived-in character. Heavyweight cotton: structural, premium. Slub jersey: irregular texture. Brushed-back fleece: quiet warmth. Anti-pattern: thin generic ringspun.",
  },
  pastBriefsForDecade: [],
};

async function main() {
  console.log("[FURNACE schema upgrade verify] starting\n");

  // ─── Load the upgraded skill ──────────────────────────────────────
  const { furnaceSkill } = await import("../src/skills/furnace");
  console.log("Loaded skill:", furnaceSkill.name);

  // ─── Invoke the skill directly via AI SDK ─────────────────────────
  // Bypass agent-config / probe-then-call plumbing — we just want to validate
  // the schema upgrade against live Gemini. No DB writes, no orchestration.
  const { generateObject } = await import("ai");
  const { google } = await import("@ai-sdk/google");

  const userPrompt = furnaceSkill.buildPrompt(COMP_RCL_INPUT);
  console.log(`\nUser prompt: ${userPrompt.length} chars`);
  console.log(`System prompt: ${furnaceSkill.systemPrompt.length} chars\n`);

  console.log("Calling gemini-2.5-flash directly...");
  const t0 = Date.now();
  const result = await generateObject({
    model: google("gemini-2.5-flash"),
    schema: furnaceSkill.outputSchema,
    system: furnaceSkill.systemPrompt,
    prompt: userPrompt,
    temperature: 0.4,
  });
  const elapsed = Date.now() - t0;
  console.log(`✓ Generation completed in ${elapsed}ms\n`);

  const brief = result.object;

  // ─── Schema sanity ────────────────────────────────────────────────
  console.log("== Schema sanity ==");
  record(
    "brandFitScore in range",
    typeof brief.brandFitScore === "number" &&
      brief.brandFitScore >= 0 &&
      brief.brandFitScore <= 100,
    `${brief.brandFitScore}/100`,
  );
  record(
    "refused matches score",
    brief.refused === brief.brandFitScore < 50,
    `refused=${brief.refused}, score=${brief.brandFitScore}`,
  );

  if (brief.refused) {
    console.log(
      "\n[verify] brief refused — verification of spec fields skipped (all should be null)",
    );
    const allSpecNull =
      brief.exactText === null &&
      brief.colorPalette === null &&
      brief.compositionRules === null &&
      brief.typographySpec === null &&
      brief.printSeparationStrategy === null &&
      brief.fullGarmentTreatment === null;
    record(
      "all 6 spec fields null on refusal",
      allSpecNull,
      allSpecNull ? "OK" : "some spec fields populated despite refused=true",
    );
  } else {
    // ─── 6 new spec fields populated ────────────────────────────────
    console.log("\n== New schema fields (Phase 11D upgrade) ==");
    record(
      "exactText populated",
      brief.exactText !== null && brief.exactText !== undefined,
      brief.exactText
        ? `front="${brief.exactText.front ?? "null"}", back="${brief.exactText.back ?? "null"}"`
        : "MISSING",
    );
    record(
      "colorPalette populated with valid hex codes",
      Array.isArray(brief.colorPalette) &&
        brief.colorPalette.length > 0 &&
        brief.colorPalette.every((c) =>
          /^#[0-9A-Fa-f]{6}$/u.test(c.hex),
        ),
      brief.colorPalette
        ? `${brief.colorPalette.length} colors: ${brief.colorPalette.map((c) => `${c.name}(${c.hex})`).join(", ")}`
        : "MISSING",
    );
    record(
      "compositionRules 300+ chars",
      typeof brief.compositionRules === "string" &&
        brief.compositionRules.length >= 300,
      brief.compositionRules
        ? `${brief.compositionRules.length} chars`
        : "MISSING",
    );
    record(
      "typographySpec populated",
      Array.isArray(brief.typographySpec),
      brief.typographySpec
        ? `${brief.typographySpec.length} entries`
        : "MISSING",
    );
    record(
      "typographySpec ≤ 6 entries (anti-gpt-image-1-text-failure rule)",
      !brief.typographySpec || brief.typographySpec.length <= 6,
      brief.typographySpec
        ? `${brief.typographySpec.length} entries`
        : "(empty)",
    );
    record(
      "printSeparationStrategy populated",
      brief.printSeparationStrategy !== null &&
        brief.printSeparationStrategy !== undefined &&
        typeof brief.printSeparationStrategy.technique === "string",
      brief.printSeparationStrategy
        ? `${brief.printSeparationStrategy.technique}, ${brief.printSeparationStrategy.separations} separations`
        : "MISSING",
    );
    record(
      "fullGarmentTreatment populated",
      brief.fullGarmentTreatment !== null &&
        brief.fullGarmentTreatment !== undefined &&
        typeof brief.fullGarmentTreatment.enabled === "boolean",
      brief.fullGarmentTreatment
        ? `enabled=${brief.fullGarmentTreatment.enabled}, bleed=[${brief.fullGarmentTreatment.bleed_zones.join(",")}]`
        : "MISSING",
    );

    // ─── Anti-pattern checks ─────────────────────────────────────────
    console.log("\n== Anti-pattern checks ==");

    // The original bad output happened because the prose included "UNREAD: 999+"
    // as example text. Check that exactText.front doesn't contain example-like
    // strings that read as placeholder direction rather than real copy.
    const frontText = brief.exactText?.front ?? "";
    const looksLikeExample =
      /UNREAD:?\s*\d/i.test(frontText) ||
      /999\+/.test(frontText) ||
      /\$99\+/.test(frontText) ||
      /placeholder/i.test(frontText);
    record(
      "exactText.front is not example/placeholder text",
      !looksLikeExample,
      looksLikeExample
        ? `LEAKED: "${frontText}"`
        : frontText
          ? `"${frontText}"`
          : "(null — no text on front)",
    );

    // typographySpec content matches exactText
    const typSurfaces = (brief.typographySpec ?? []).map((t) => t.surface);
    const orphanTyp = typSurfaces.filter((s) => {
      // For each typography entry's surface, check exactText has a populated
      // value for that surface root (front/back/sleeve_*/hem/inside_print)
      const root = s.split("_")[0]; // "front_center" → "front"
      const allowedRoots = ["front", "back", "sleeve", "hem", "inside"];
      if (!allowedRoots.includes(root)) return false;
      // Check the corresponding exactText field is non-null
      const exactKey =
        root === "sleeve"
          ? s.startsWith("sleeve_left")
            ? "sleeve_left"
            : "sleeve_right"
          : root === "inside"
            ? "inside_print"
            : root;
      const exactVal = (brief.exactText as Record<string, string | null> | null)?.[
        exactKey
      ];
      return !exactVal;
    });
    record(
      "no orphan typographySpec (each entry has matching exactText)",
      orphanTyp.length === 0,
      orphanTyp.length === 0 ? "OK" : `orphans: ${orphanTyp.join(", ")}`,
    );

    // ─── Show what BOILER's prompt would look like ────────────────────
    console.log("\n== BOILER prompt preview (with upgraded brief) ==");
    const { buildBoilerPrompt } = await import("../src/lib/boiler/build-prompt");
    const previewInput = {
      context: {
        signalId: COMP_RCL_INPUT.signalId,
        shortcode: "COMP-RCL",
        manifestationDecade: "RCL" as const,
        season: "S02 Cold Cosmic",
        framingHook: COMP_RCL_MANIFESTATION.framingHook,
      },
      furnaceBrief: {
        ...brief,
        brandFitScore: brief.brandFitScore,
        brandFitRationale: brief.brandFitRationale,
        designDirection: brief.designDirection ?? "",
        tactileIntent: brief.tactileIntent ?? "",
        moodAndTone: brief.moodAndTone ?? "",
        compositionApproach: brief.compositionApproach ?? "",
        colorTreatment: brief.colorTreatment ?? "",
        typographicTreatment: brief.typographicTreatment ?? "",
        artDirection: brief.artDirection ?? "",
        referenceAnchors: brief.referenceAnchors ?? "",
        placementIntent: brief.placementIntent ?? "",
        voiceInVisual: brief.voiceInVisual ?? "",
        addenda: brief.addenda,
      },
      paletteRoles: {
        garment_base: "#2A3744",
        ring_outer: "#1A2632",
        ring_inner: "#6F7E91",
        front_ink: "#B9C4D2",
        back_ink: "#4A5867",
      },
      compositionMeta: {
        exact_text: { front: COMP_RCL_MANIFESTATION.framingHook },
        print_spec: {
          method: "screen",
          separations: 2,
          halftones: false,
          full_bleed: true,
        },
      },
      tier: "medium" as const,
    };
    const prompt = buildBoilerPrompt(previewInput);
    console.log(`\nBOILER prompt length: ${prompt.length} chars`);
    console.log("─".repeat(80));
    console.log(prompt);
    console.log("─".repeat(80));
  }

  // ─── Summary ──────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(
    `\n[FURNACE schema upgrade verify] ${passed}/${total} checks passed\n`,
  );
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error("\n[verify] crashed:", err);
  process.exit(2);
});
