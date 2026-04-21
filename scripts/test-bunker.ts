/**
 * End-to-end test for BUNKER extraction (Phase 6).
 *
 * Flow:
 *   1. Look up BLIPS org
 *   2. Fetch mock candidates from the fixture source
 *   3. For each, compute content hash, dedup-check, run BUNKER skill
 *   4. Persist to bunker_candidates with status PENDING_REVIEW
 *   5. Report candidates created + dedup stats
 *
 * Exercises: skill registration, source connector, dedup hash,
 * BUNKER LLM call via orchestrator's generateStructured, DB write.
 *
 * Cost: ~3 Gemini Flash calls × ~200 tokens each = <$0.001 per run.
 *
 * Usage: npx tsx scripts/test-bunker.ts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf-8");
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

async function main() {
  const { eq, and, desc } = await import("drizzle-orm");
  const { db } = await import("../src/db");
  const { orgs, bunkerCandidates } = await import("../src/db/schema");
  const { fetchMockCandidates } = await import("../src/lib/sources/mock");
  const { computeContentHash } = await import("../src/lib/sources/dedup");
  const { generateStructured } = await import("../src/lib/ai/generate");
  // Importing skills/index triggers side-effect registration of BUNKER
  const { loadSkill } = await import("../src/skills");
  const { bunkerSkill } = await import("../src/skills/bunker");

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ No BLIPS org. Run scripts/seed.ts first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.name} (${org.id})`);

  // Sanity check — BUNKER skill must be registered via the auto-import
  const registered = loadSkill("BUNKER");
  console.log(`✓ BUNKER skill registered: "${registered.description}"`);

  const raw = await fetchMockCandidates({ orgId: org.id, limit: 20 });
  console.log(`\n✓ Fetched ${raw.length} mock candidates\n`);

  let extracted = 0;
  let deduped = 0;
  let errors = 0;
  const created: Array<{ shortcode: string; title: string }> = [];

  for (const item of raw) {
    const contentHash = computeContentHash({
      url: item.url,
      title: item.title,
      body: item.body,
    });

    // Dedup check
    const [existing] = await db
      .select({ id: bunkerCandidates.id, shortcode: bunkerCandidates.shortcode })
      .from(bunkerCandidates)
      .where(
        and(
          eq(bunkerCandidates.orgId, org.id),
          eq(bunkerCandidates.contentHash, contentHash),
        ),
      )
      .limit(1);
    if (existing) {
      deduped++;
      console.log(`  · DEDUP "${item.title.slice(0, 60)}" → existing ${existing.shortcode}`);
      continue;
    }

    try {
      const result = await generateStructured({
        agentKey: "BUNKER",
        orgId: org.id,
        system: bunkerSkill.systemPrompt,
        prompt: bunkerSkill.buildPrompt(bunkerSkill.inputSchema.parse(item)),
        schema: bunkerSkill.outputSchema,
      });

      // Persist
      const [row] = await db
        .insert(bunkerCandidates)
        .values({
          orgId: org.id,
          shortcode: result.object.shortcode,
          workingTitle: result.object.working_title,
          concept: result.object.concept,
          source: item.source,
          rawText: item.body.slice(0, 2000),
          rawMetadata: {
            ...item.metadata,
            url: item.url,
            source_context: result.object.source_context,
          },
          contentHash,
          status: "PENDING_REVIEW",
        })
        .returning({
          id: bunkerCandidates.id,
          shortcode: bunkerCandidates.shortcode,
        });

      extracted++;
      created.push({
        shortcode: result.object.shortcode,
        title: result.object.working_title,
      });
      console.log(
        `  + ${row.shortcode.padEnd(8)} ${result.object.working_title}`,
      );
      console.log(`           ↳ ${result.object.concept}`);
    } catch (e) {
      errors++;
      console.error(`  ✗ extract failed for "${item.title.slice(0, 40)}":`, (e as Error).message);
    }
  }

  console.log(`\n━━━ Summary ━━━`);
  console.log(`  Fetched:   ${raw.length}`);
  console.log(`  Deduped:   ${deduped}`);
  console.log(`  Extracted: ${extracted}`);
  console.log(`  Errors:    ${errors}`);

  // Show all PENDING candidates for BLIPS org
  const allPending = await db
    .select({
      shortcode: bunkerCandidates.shortcode,
      workingTitle: bunkerCandidates.workingTitle,
      source: bunkerCandidates.source,
      createdAt: bunkerCandidates.createdAt,
    })
    .from(bunkerCandidates)
    .where(
      and(
        eq(bunkerCandidates.orgId, org.id),
        eq(bunkerCandidates.status, "PENDING_REVIEW"),
      ),
    )
    .orderBy(desc(bunkerCandidates.createdAt));

  console.log(`\n━━━ PENDING_REVIEW candidates (${allPending.length}) ━━━`);
  for (const c of allPending) {
    console.log(
      `  ${c.shortcode.padEnd(8)} ${c.source.padEnd(8)} ${c.workingTitle}`,
    );
  }

  console.log(`\n✓ Phase 6 BUNKER extraction test passed`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Test failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
