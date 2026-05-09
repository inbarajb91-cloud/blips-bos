/**
 * Re-trigger BOILER on a stuck manifestation.
 *
 * Use case: a BOILER run failed (Gemini structured-output flakiness, all
 * 3 chain models returned "response did not match schema"; or some other
 * transient error left the manifestation at IN_BOILER without a gallery
 * row). This script re-fires `furnace.brief.approved` so the production
 * handler runs again.
 *
 * Usage:
 *   npx tsx scripts/retrigger-boiler.ts <manifestation-shortcode>
 *
 * Example:
 *   npx tsx scripts/retrigger-boiler.ts PIVOT-RCL
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
  const shortcode = process.argv[2];
  if (!shortcode) {
    console.error("Usage: npx tsx scripts/retrigger-boiler.ts <SHORTCODE>");
    process.exit(1);
  }

  const { db, signals, agentOutputs } = await import("../src/db");
  const { eq, and, desc } = await import("drizzle-orm");
  const { inngest } = await import("../src/lib/inngest/client");

  const [child] = await db
    .select({
      id: signals.id,
      orgId: signals.orgId,
      shortcode: signals.shortcode,
      status: signals.status,
    })
    .from(signals)
    .where(eq(signals.shortcode, shortcode));

  if (!child) {
    console.error(`✗ Signal ${shortcode} not found.`);
    process.exit(1);
  }

  console.log(
    `[retrigger] Found ${shortcode} → id ${child.id} status=${child.status}`,
  );

  // Find the latest APPROVED FURNACE brief for this manifestation
  const [brief] = await db
    .select({
      id: agentOutputs.id,
      status: agentOutputs.status,
    })
    .from(agentOutputs)
    .where(
      and(
        eq(agentOutputs.signalId, child.id),
        eq(agentOutputs.agentName, "FURNACE"),
      ),
    )
    .orderBy(desc(agentOutputs.createdAt))
    .limit(1);

  if (!brief || brief.status !== "APPROVED") {
    console.error(
      `✗ No APPROVED FURNACE brief found on ${shortcode} (status: ${brief?.status ?? "no row"}).`,
    );
    process.exit(1);
  }
  console.log(`[retrigger] Brief: ${brief.id} (APPROVED)`);

  // Delete any stuck/incomplete BOILER agent_outputs row so the new run
  // doesn't create a duplicate. We delete BOTH PENDING (mid-flight stuck)
  // and any prior REJECTED rows; the orchestrator will write a fresh one.
  const stuck = await db
    .delete(agentOutputs)
    .where(
      and(
        eq(agentOutputs.signalId, child.id),
        eq(agentOutputs.agentName, "BOILER"),
      ),
    )
    .returning({ id: agentOutputs.id, status: agentOutputs.status });
  console.log(
    `[retrigger] Cleared ${stuck.length} prior BOILER row(s): ${stuck.map((r) => `${r.id.slice(0, 8)}/${r.status}`).join(", ") || "(none)"}`,
  );

  console.log("[retrigger] Sending furnace.brief.approved to Inngest...");
  const result = await inngest.send({
    name: "furnace.brief.approved",
    data: {
      orgId: child.orgId,
      manifestationSignalId: child.id,
      briefId: brief.id,
    },
  });
  console.log(`  event ids: ${JSON.stringify(result.ids)}`);
  console.log(
    `[retrigger] BOILER handler should fire in 1-2s. Watch the BOILER tab on ${shortcode}.`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[retrigger] fatal:", err);
  process.exit(1);
});
