/**
 * Inspect the GIGS-RCK FURNACE brief produced by the verification run.
 * One-shot read-only query for the verification report.
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

async function main() {
  const { db } = await import("../src/db");
  const { agentOutputs, signals } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const [row] = await db
    .select({
      id: agentOutputs.id,
      status: agentOutputs.status,
      content: agentOutputs.content,
      sectionApprovals: agentOutputs.sectionApprovals,
      shortcode: signals.shortcode,
      childStatus: signals.status,
      manifestationDecade: signals.manifestationDecade,
    })
    .from(agentOutputs)
    .innerJoin(signals, eq(agentOutputs.signalId, signals.id))
    .where(
      and(
        eq(signals.shortcode, "GIGS-RCK"),
        eq(agentOutputs.agentName, "FURNACE"),
      ),
    )
    .limit(1);

  if (!row) {
    console.log("No FURNACE brief found for GIGS-RCK");
    process.exit(1);
  }

  const c = row.content as Record<string, unknown>;
  console.log(`=== FURNACE Brief: ${row.shortcode} (${row.manifestationDecade}) ===`);
  console.log(`brief_id: ${row.id}`);
  console.log(`brief_status: ${row.status}`);
  console.log(`signal_status: ${row.childStatus}`);
  console.log(`section_approvals: ${JSON.stringify(row.sectionApprovals)}`);
  console.log();
  console.log(`brand_fit_score: ${c.brandFitScore}`);
  console.log(`brand_fit_rationale: ${(c.brandFitRationale as string)?.slice(0, 600)}`);
  console.log();
  console.log(`refused: ${c.refused}`);
  console.log();
  console.log(`--- design direction ---`);
  console.log(c.designDirection);
  console.log();
  console.log(`--- tactile intent ---`);
  console.log(c.tactileIntent);
  console.log();
  console.log(`--- mood + tone ---`);
  console.log(c.moodAndTone);
  console.log();
  console.log(`--- composition approach ---`);
  console.log(c.compositionApproach);
  console.log();
  console.log(`--- color treatment ---`);
  console.log(c.colorTreatment);
  console.log();
  console.log(`--- typographic treatment ---`);
  console.log(c.typographicTreatment);
  console.log();
  console.log(`--- art direction ---`);
  console.log(c.artDirection);
  console.log();
  console.log(`--- reference anchors ---`);
  console.log(c.referenceAnchors);
  console.log();
  console.log(`--- placement intent ---`);
  console.log(c.placementIntent);
  console.log();
  console.log(`--- voice in visual ---`);
  console.log(c.voiceInVisual);

  process.exit(0);
}

main().catch((err) => {
  console.error("[inspect] fatal:", err);
  process.exit(1);
});
