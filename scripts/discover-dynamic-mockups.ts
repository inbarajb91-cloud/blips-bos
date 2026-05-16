/**
 * Discover Dynamic Mockups templates available on the BLIPS account, pick the
 * best tee template, and optionally seed it into config_engine_room.
 *
 * Phase 11D.5 prep — runs once per silhouette as we add product types. For the
 * initial Phase 11D ship we need ONE tee template (the "tee classic" silhouette
 * from skills.md §9). Other silhouettes (long-sleeve, sweatshirt, hoodie, polo)
 * extend the same config table in later phases.
 *
 * The script:
 *   1. Lists all templates via DM's /mockups endpoint
 *   2. Prints every result with its UUID, name, category, and metadata
 *   3. Filters + scores candidates by tee-flat-lay-with-recolor heuristic
 *   4. Picks the top candidate
 *   5. Fetches its smart_objects detail (the chest/back zones)
 *   6. Prints the chosen template + smart object UUIDs
 *   7. Writes the choice to config_engine_room.boiler_mockup_template
 *      (unless --dry-run is set)
 *
 * Run:
 *   pnpm tsx --env-file=.env.local scripts/discover-dynamic-mockups.ts
 *
 * Flags:
 *   --dry-run      print the picked template but don't write to config
 *   --silhouette=tee-classic   override which silhouette key to seed (default: tee-classic)
 *   --list-only    list everything available, don't pick or seed
 *
 * Exit codes:
 *   0 — discovery + (optional) seed succeeded
 *   1 — DYNAMIC_MOCKUPS_API_KEY missing
 *   2 — no templates found on the account
 *   3 — no template matched the tee-flat-lay filter (manual override needed)
 *   4 — script crashed
 */

// IMPORTANT: this script requires `tsx --env-file=.env.local` for env loading.
// Don't `import "dotenv"` here — dotenv isn't a project dep, and module-import
// hoisting puts the env load after lib imports anyway (cloudinary auto-init
// reads process.env at import time, before any in-source dotenv.config()).
// See MEMORY.md § May 16 "dotenv import-order trap" for the full story.
//
// Run:
//   pnpm tsx --env-file=.env.local scripts/discover-dynamic-mockups.ts [flags]

import { listMockups, getMockup } from "@/lib/dynamic-mockups/client";
import type { MockupTemplate } from "@/lib/dynamic-mockups/types";
import { db } from "@/db/index";
import { configEngineRoom, orgs } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const BLIPS_ORG_SLUG = "blips";

type ViewType = "on_model" | "flat_lay";

interface TemplateChoice {
  template_uuid: string;
  template_name: string;
  template_type: string | null;
  thumbnail_url: string | null;
  smart_objects: Array<{
    uuid: string;
    name: string;
    print_area_presets: Array<{
      uuid: string;
      name: string;
    }>;
  }>;
}

/**
 * The config_engine_room.boiler_mockup_templates shape — one entry per
 * silhouette × view type. Phase 11D ships with one silhouette ("tee-classic")
 * × up to two view types (on_model, flat_lay). More silhouettes (long-sleeve,
 * sweatshirt, hoodie, polo) extend the same shape in later phases.
 *
 * Either view may be absent (e.g. account only has on-model template); the
 * mockup-render side-effect (Phase 11D.5c) gracefully degrades — uses
 * whatever's available, doesn't fail.
 */
interface TemplateConfig {
  silhouettes: {
    [silhouette: string]: {
      on_model?: TemplateChoice;
      flat_lay?: TemplateChoice;
    };
  };
}

/**
 * Score a template for "tee with a print zone" fit. Higher = better.
 *
 * DM's list response is slim — it doesn't tell us category, view, recolor
 * support, etc. directly. What we have to work with:
 *   - top-level name (e.g. "afternoon walk" — describes the photo, not the product)
 *   - smart_objects[].name (e.g. "T-shirt", "Hoodie", "Sweatshirt")
 *   - smart_objects[].print_area_presets[].name (e.g. "Center", "Left Chest")
 *   - type ("classic" for stock mockups)
 *
 * Heuristic:
 *   +50  if any smart_object.name matches /tshirt|t-?shirt|tee|shirt/
 *   +30  if any print_area_preset.name matches the canonical chest zone
 *        (Center, Full Front, Chest, Front)
 *   +15  if at least one smart_object exists
 *   +10  if multiple smart_objects (front + back capability)
 *   −10  if smart_object.name matches /kid|youth|women|crop|baby|toddler/
 *   −5   if no print_area_presets (caller has no zone to target)
 */
function scoreTeeTemplate(t: MockupTemplate): number {
  let score = 0;
  const sos = t.smart_objects ?? [];

  for (const so of sos) {
    const soName = (so.name ?? "").toLowerCase();
    if (/(tshirt|t-?shirt|\btee\b|shirt)/.test(soName)) score += 50;
    if (/(kid|youth|women|crop|baby|toddler)/.test(soName)) score -= 10;

    const presets = so.print_area_presets ?? [];
    if (presets.length === 0) score -= 5;
    for (const p of presets) {
      const pName = (p.name ?? "").toLowerCase();
      if (/(center|full front|chest|front)/.test(pName)) {
        score += 30;
        break; // one match per smart object is enough
      }
    }
  }

  if (sos.length > 0) score += 15;
  if (sos.length >= 2) score += 10;

  return score;
}

/**
 * Classify a template as on-model or flat-lay. Heuristic on the template name
 * since DM doesn't expose a `view` field directly.
 *
 * Conservative: defaults to "on_model" since DM's catalog skews lifestyle.
 * A template called "afternoon walk" (no flat-lay hint) → on_model.
 * A template called "tshirt flatlay white" → flat_lay.
 *
 * If you add a template via the DM dashboard and want the classifier to
 * pick it up correctly, include a hint in the template name when saving:
 *   "BLIPS flat lay tee" → flat_lay
 *   "BLIPS Indian model tee" → on_model
 */
function classifyTemplate(t: MockupTemplate): ViewType {
  const text = t.name.toLowerCase();
  if (/(flat[\s-]?lay|flatlay|laydown|blank|product shot|studio shot|isolated|cutout)/.test(text)) {
    return "flat_lay";
  }
  if (/(on[\s-]?model|lifestyle|wearing|street|outdoor|portrait|person)/.test(text)) {
    return "on_model";
  }
  // Default — DM's stock catalog is mostly lifestyle, so unclassified → on_model
  return "on_model";
}

/**
 * Build a TemplateChoice from a MockupTemplate. Pure data transformation.
 */
function templateToChoice(t: MockupTemplate): TemplateChoice {
  return {
    template_uuid: t.uuid,
    template_name: t.name,
    template_type: t.type ?? null,
    thumbnail_url: t.thumbnail ?? null,
    smart_objects: (t.smart_objects ?? []).map((so) => ({
      uuid: so.uuid,
      name: so.name ?? "(unnamed)",
      print_area_presets: (so.print_area_presets ?? []).map((p) => ({
        uuid: p.uuid,
        name: p.name ?? "(unnamed)",
      })),
    })),
  };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const listOnly = args.has("--list-only");
  const silhouetteArg = process.argv.find((a) => a.startsWith("--silhouette="));
  const silhouette = silhouetteArg
    ? silhouetteArg.split("=")[1]
    : "tee-classic";

  console.log("Phase 11D.5 — Dynamic Mockups template discovery");
  console.log("─────────────────────────────────────────────────");

  // ─── Preflight ───────────────────────────────────────────────────
  const key = process.env.DYNAMIC_MOCKUPS_API_KEY;
  if (!key || key.startsWith("REPLACE_") || key.length < 10) {
    console.error("✗ DYNAMIC_MOCKUPS_API_KEY not set");
    process.exit(1);
  }
  console.log(`✓ DYNAMIC_MOCKUPS_API_KEY present (length ${key.length})`);

  // ─── Step 1: list catalog ────────────────────────────────────────
  console.log("\nListing templates from Dynamic Mockups…");
  let templates: MockupTemplate[];
  try {
    templates = await listMockups();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`✗ list call failed: ${msg}`);
    process.exit(4);
  }

  if (templates.length === 0) {
    console.error("✗ No templates returned from /mockups. Either:");
    console.error(
      "  - The account has no templates (unlikely — DM seeds new accounts)",
    );
    console.error(
      "  - The /mockups endpoint response shape changed (check client.ts)",
    );
    console.error(
      "  - The API key has the wrong scope (DM has per-key scopes)",
    );
    process.exit(2);
  }
  console.log(`✓ ${templates.length} templates found.`);

  // ─── Step 2: print everything ────────────────────────────────────
  console.log("\nCatalog overview:");
  for (const t of templates) {
    const sos = t.smart_objects ?? [];
    const soSummary = sos
      .map((so) => {
        const presetNames = (so.print_area_presets ?? [])
          .map((p) => p.name ?? "?")
          .join("/");
        return `${so.name ?? "?"}${presetNames ? ` [${presetNames}]` : ""}`;
      })
      .join(", ");
    console.log(
      `  ${t.uuid.slice(0, 8)}…  ${t.name}` +
        (t.type ? ` · type: ${t.type}` : "") +
        (soSummary ? ` · ${soSummary}` : ""),
    );
    if (t.thumbnail) {
      console.log(`     thumb: ${t.thumbnail}`);
    }
  }

  if (listOnly) {
    console.log("\n--list-only — exiting without picking or seeding.");
    process.exit(0);
  }

  // ─── Step 3: score + classify + pick best per view type ─────────
  console.log("\nScoring candidates + classifying view type…");
  const scored = templates
    .map((t) => ({
      template: t,
      score: scoreTeeTemplate(t),
      view: classifyTemplate(t),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    console.error(
      "✗ No template matched the tee filter. Inspect the catalog above; add",
    );
    console.error(
      "  tee templates via the DM dashboard so the heuristic catches them next run.",
    );
    process.exit(3);
  }

  // Group by classification
  const onModelCandidates = scored.filter((s) => s.view === "on_model");
  const flatLayCandidates = scored.filter((s) => s.view === "flat_lay");

  console.log(`\nClassified:`);
  console.log(`  on-model: ${onModelCandidates.length} candidates`);
  for (const s of onModelCandidates.slice(0, 3)) {
    console.log(
      `    score ${s.score.toString().padStart(3)} · ${s.template.uuid.slice(0, 8)}…  ${s.template.name}`,
    );
  }
  console.log(`  flat-lay: ${flatLayCandidates.length} candidates`);
  for (const s of flatLayCandidates.slice(0, 3)) {
    console.log(
      `    score ${s.score.toString().padStart(3)} · ${s.template.uuid.slice(0, 8)}…  ${s.template.name}`,
    );
  }

  // Pick top per view type. Either may be undefined if the account has
  // no template of that type yet — the seed handles partial coverage.
  const pickedOnModel = onModelCandidates[0]?.template;
  const pickedFlatLay = flatLayCandidates[0]?.template;

  if (pickedOnModel) {
    console.log(`\n✓ on-model pick: ${pickedOnModel.name} (${pickedOnModel.uuid.slice(0, 8)}…)`);
    console.log(`  thumbnail: ${pickedOnModel.thumbnail ?? "(none)"}`);
  } else {
    console.log("\n⚠ No on-model template found. Add one via DM dashboard for Phase 11D.5c rendering.");
  }
  if (pickedFlatLay) {
    console.log(`\n✓ flat-lay pick: ${pickedFlatLay.name} (${pickedFlatLay.uuid.slice(0, 8)}…)`);
    console.log(`  thumbnail: ${pickedFlatLay.thumbnail ?? "(none)"}`);
  } else {
    console.log("\n⚠ No flat-lay template found. Add one via DM dashboard — flat-lay is required for design QA in the workspace Mockup view.");
  }

  // ─── Step 4: build config payload ────────────────────────────────
  const config: TemplateConfig = {
    silhouettes: {
      [silhouette]: {
        ...(pickedOnModel && { on_model: templateToChoice(pickedOnModel) }),
        ...(pickedFlatLay && { flat_lay: templateToChoice(pickedFlatLay) }),
      },
    },
  };

  if (dryRun) {
    console.log("\n--dry-run — not writing to config_engine_room.");
    console.log("Would write key: boiler_mockup_templates");
    console.log("Would write value:");
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log("\nSeeding config_engine_room.boiler_mockup_templates…");
    try {
      // Look up the BLIPS org first — config rows are per-org. Only one org
      // today (BLIPS) but the pattern is correct if more get added later.
      const blipsOrg = await db
        .select({ id: orgs.id })
        .from(orgs)
        .where(eq(orgs.slug, BLIPS_ORG_SLUG))
        .limit(1);
      if (blipsOrg.length === 0) {
        console.error(
          `✗ No org found with slug "${BLIPS_ORG_SLUG}". Run scripts/seed.ts first.`,
        );
        process.exit(4);
      }
      const orgId = blipsOrg[0].id;

      // Idempotent upsert — if the (org_id, key) pair exists, overwrite value.
      await db
        .insert(configEngineRoom)
        .values({
          orgId,
          key: "boiler_mockup_templates",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value: config as any,
        })
        .onConflictDoUpdate({
          target: [configEngineRoom.orgId, configEngineRoom.key],
          set: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value: config as any,
            updatedAt: sql`NOW()`,
          },
        });
      console.log(`✓ config seeded for org ${orgId}.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ config upsert failed: ${msg}`);
      process.exit(4);
    }
  }

  console.log("─────────────────────────────────────────────────");
  console.log("Discovery complete. Next steps:");
  console.log("  1. Eyeball the thumbnail URL above — make sure it matches the BLIPS aesthetic");
  console.log(
    "  2. If a smart object name is unclear, log into the DM dashboard and confirm zone naming",
  );
  console.log(
    "  3. Phase 11D.5 build (Inngest mockup side-effect) reads this config to render composites",
  );
  console.log(
    "  4. To switch templates later: re-run this script (idempotent upsert) or edit config directly",
  );
  process.exit(0);
}

void main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`✗ script crashed: ${msg}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(4);
});
