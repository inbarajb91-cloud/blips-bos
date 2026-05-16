/**
 * Verify the Phase 11D.2 gpt-image-2 integration end-to-end.
 *
 * Exercises the OpenAI Responses API path through the new BOILER service:
 *   1. OPENAI_API_KEY is set + parses
 *   2. gpt-image-2 model resolves + returns an image at low tier (~$0.006)
 *   3. The response includes a chainable response id
 *   4. Cloudinary upload succeeds + returns optimized URL
 *   5. (Optional) chain a Medium-tier refinement off the Low draft via
 *      previous_response_id — confirms chaining works (~$0.053)
 *
 * Total cost per run: ~$0.06 (one Low + one Medium). Cheap enough to run on
 * every BOILER v2 change without burning the budget.
 *
 * Run:
 *   pnpm tsx --env-file=.env.local scripts/verify-boiler-v2-openai.ts
 *
 * Add --skip-chain to skip the refinement step (saves ~$0.053):
 *   pnpm tsx --env-file=.env.local scripts/verify-boiler-v2-openai.ts --skip-chain
 *
 * Exit codes:
 *   0 — full pipeline works (generate → Cloudinary → optionally chain)
 *   1 — OPENAI_API_KEY missing / placeholder
 *   2 — CLOUDINARY_URL missing
 *   3 — generate-design call failed (live API issue)
 *   4 — chaining failed (previous_response_id flow broken)
 *   5 — script crashed
 *
 * Secret hygiene: never logs the API key. Cost amounts ARE printed (they're
 * not secret) so the founder can see what each verify run cost.
 */

// Load .env.local explicitly — dotenv/config only loads .env by default.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

import { isCloudinaryConfigured } from "@/lib/cloudinary";
import { generateDesign as runGenerateDesign } from "@/lib/boiler/generate-design";
import type { GenerateDesignInput } from "@/lib/boiler/types";

// ─── Fixture: a minimal but realistic BOILER input ──────────────────────
// Anchored on the PAPER-RCK reference design so this verify run produces
// something we can eyeball against the founder's reference image.
const FIXTURE_INPUT: GenerateDesignInput = {
  context: {
    signalId: "00000000-0000-0000-0000-00000000d020",
    shortcode: "VERIFY-RCK",
    manifestationDecade: "RCK",
    season: "S01 Raw Industrial",
    framingHook:
      "Ahead On Paper — successful on paper but feel behind in life",
  },
  furnaceBrief: {
    designDirection:
      "Multi-element radial composition. A ring field bleeds off the hem, shoulders, and sleeves. A small square — the wearer's symbolic 'self' — sits at the ring origin on the front. The back shows the same field but the square has drifted lower-right with a dashed trail back to origin. The square's position is the variable; the field is constant.",
    tactileIntent:
      "Two-separation flat screen print on cotton. Slightly chalky discharge feel. No shine, no gloss, no halftones. Hand should feel like a worn-in tee, not a fresh-from-factory poly blend.",
    moodAndTone:
      "Internal, slightly stoic. Not loud. Not branded. Reads from across a room as 'designed' but not as a logo or a wordmark.",
    compositionApproach:
      "Iconographic + type-led leading. Ring field is the dominant graphic element. Vertical text column anchors the left chest (front) and right side (back). Square is the visual punctuation.",
    colorTreatment:
      "Forge (#5A2020) as the garment base. Char (#2A0F0F) as the outermost ring, near-invisible against the base. Rust Haze (#9E5050) as the inner glow. Ash Blush (#E8D5D2) as the front ink. Signal (#A04040) as the back ink.",
    typographicTreatment:
      "Front: Syne 800, tight tracking (1.0 letter-spacing). Back: Syne 300, looser tracking (2.4 letter-spacing). Both vertical, rotated -90°.",
    artDirection:
      "Concentric rings drawn as line strokes, not filled. Subtle radial fade — outer rings near-invisible (Char on Forge), inner rings progressively brighter through Rust Haze. The ring field IS the design; the square + text + crosshair are the narrative.",
    referenceAnchors:
      "Industrial signal-scope HUD aesthetic. Raw screen-print posters. Cabin pressure displays. NOT cyberpunk, NOT decorative.",
    placementIntent:
      "Full-bleed. The ring field extends beyond the visible print area, bleeding off the hem, shoulders, and (where the silhouette permits) the sleeves. The wearer is INSIDE the rings.",
    voiceInVisual:
      "The design has a punchline that lands on second look. Rings are constant. Square is the variable. Square at origin = in control. Square drifted = something is off. The wearer is the subject of the rings.",
    brandFitScore: 92,
    brandFitRationale:
      "Perfect S01 Raw Industrial fit. RCK decade-resonant (The Reckoning). Conceptual integrity is high — the design is doing the work of the signal, not decorating around it.",
    addenda: [],
  },
  paletteRoles: {
    garment_base: "#5A2020",
    ring_outer: "#2A0F0F",
    ring_inner: "#9E5050",
    front_ink: "#E8D5D2",
    back_ink: "#A04040",
  },
  compositionMeta: {
    exact_text: {
      front: "AHEAD ON PAPER.",
      back: "BEHIND ON SOMETHING.",
    },
    typography: {
      front_weight: 800,
      front_tracking: "tight (1.0)",
      back_weight: 300,
      back_tracking: "looser (2.4)",
    },
    composition_rules: {
      origin_position_front: "62%, 42% (center-right of chest)",
      origin_position_back: "38%, 44% (mirror of front, center-left)",
      square_displacement_back: "lower-right, between ring 3 and ring 4",
      crosshair_through_origin: "1pt, Char, 55% opacity",
      ghost_trail_back: "dashed line, Signal, 55% opacity",
    },
    print_spec: {
      method: "screen",
      separations: 2,
      halftones: false,
      full_bleed: true,
    },
  },
  tier: "low",
};

async function main(): Promise<void> {
  const skipChain = process.argv.includes("--skip-chain");

  console.log("Phase 11D.2 — BOILER v2 OpenAI + Cloudinary verification");
  console.log("─────────────────────────────────────────────────────────");

  // ─── Step 0: env preflight ──────────────────────────────────────
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("REPLACE_") || key.length < 20) {
    console.error("✗ OPENAI_API_KEY not set (or is a placeholder)");
    process.exit(1);
  }
  console.log(`✓ OPENAI_API_KEY present (length ${key.length})`);

  if (!isCloudinaryConfigured()) {
    console.error("✗ CLOUDINARY_URL not set");
    process.exit(2);
  }
  console.log("✓ CLOUDINARY_URL present");

  // ─── Step 1: generate a Low-tier draft ──────────────────────────
  console.log("\nStep 1 — Low-tier draft (gpt-image-2, transparent PNG)");
  let lowResult;
  try {
    const t0 = Date.now();
    lowResult = await runGenerateDesign(FIXTURE_INPUT);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ generated in ${elapsed}s · cost $${lowResult.costUsd.toFixed(3)}`);
    console.log(`  response id:    ${lowResult.gptImage2ResponseId}`);
    console.log(`  dimensions:     ${lowResult.widthPx}×${lowResult.heightPx}`);
    console.log(`  Cloudinary URL: ${lowResult.flatArtworkUrl}`);
    console.log(`  public id:      ${lowResult.cloudinaryPublicId}`);

    // Print verifier verdict
    if (lowResult.verification) {
      const v = lowResult.verification;
      const verdict = v.passed ? "✓ PASSED" : "✗ FAILED";
      console.log(
        `\n  Verifier (${v.verifier_model}, ${(v.duration_ms / 1000).toFixed(1)}s) — ${verdict} · overall ${v.overall_score}/100`,
      );
      console.log(`    text legibility:  ${v.text_legibility.score}/100`);
      console.log(
        `      detected:       ${v.text_legibility.detected_strings.map((s) => `"${s}"`).join(", ") || "(none)"}`,
      );
      console.log(
        `      found expected: ${v.text_legibility.expected_strings_found.map((s) => `"${s}"`).join(", ") || "(none)"}`,
      );
      if (v.text_legibility.issues) console.log(`      issue: ${v.text_legibility.issues}`);
      console.log(`    palette adherence: ${v.palette_adherence.score}/100`);
      console.log(
        `      dominant: ${v.palette_adherence.dominant_hex_codes.join(", ")}`,
      );
      if (v.palette_adherence.issues) console.log(`      issue: ${v.palette_adherence.issues}`);
      console.log(`    composition:      ${v.composition.score}/100 · ${v.composition.element_count} elements`);
      console.log(`      observed: ${v.composition.elements_observed.join(", ")}`);
      if (v.composition.issues) console.log(`      issue: ${v.composition.issues}`);
      console.log(`    conceptual fit:   ${v.conceptual_fit.score}/100`);
      console.log(`      summary: ${v.conceptual_fit.summary}`);
      if (v.refinement_suggestions.length > 0) {
        console.log(`    refinement suggestions:`);
        for (const s of v.refinement_suggestions) console.log(`      - ${s}`);
      }
    } else {
      console.log(`  Verifier: not run (skipped or fail-soft)`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`✗ generation failed: ${msg}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    process.exit(3);
  }

  // ─── Step 2: chain a Medium-tier refinement (optional) ──────────
  if (!skipChain) {
    console.log("\nStep 2 — Medium-tier refinement (chained via previous_response_id)");
    try {
      const t0 = Date.now();
      const chained = await runGenerateDesign({
        ...FIXTURE_INPUT,
        tier: "medium",
        refinementInstruction:
          "Tighten the front text tracking slightly. Push the square 4–5 units lower so it sits at the visual center of the ring field, not above. Keep all colors and ring count identical.",
        parent: {
          parentVersionId: "00000000-0000-0000-0000-00000000d021", // synthetic — caller (Inngest handler) sets this in production
          parentFlatArtworkUrl: lowResult.flatArtworkUrl,
        },
      });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`✓ refinement in ${elapsed}s · cost $${chained.costUsd.toFixed(3)}`);
      console.log(`  response id:    ${chained.gptImage2ResponseId}`);
      console.log(`  Cloudinary URL: ${chained.flatArtworkUrl}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ refinement chain failed: ${msg}`);
      if (e instanceof Error && e.stack) console.error(e.stack);
      process.exit(4);
    }
  } else {
    console.log("\nStep 2 — refinement chain skipped (--skip-chain)");
  }

  console.log("─────────────────────────────────────────────────────────");
  console.log("✓ Phase 11D.2 verification complete.");
  console.log(
    `  Total approximate cost: $${skipChain ? "0.006" : "0.059"} (one Low${skipChain ? "" : " + one Medium"})`,
  );
  console.log(
    "  Inspect the Cloudinary URLs above to eyeball the designs. If they",
  );
  console.log(
    "  clear the BLIPS bar (multi-element, hex palette correct, transparent",
  );
  console.log(
    "  background, no rendered garment), Phase 11D.2 is ready to ship.",
  );
  process.exit(0);
}

void main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`✗ verify script crashed: ${msg}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(5);
});
