/**
 * Read-only — list manifestations with FURNACE briefs (PENDING) for
 * Inba's manual UI test. The renderer renders the brief approval flow
 * for any manifestation at IN_FURNACE with a FURNACE agent_outputs row.
 *
 * Usage: npx tsx scripts/list-furnace-test-targets.ts
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

  const briefs = await db
    .select({
      childShortcode: signals.shortcode,
      parentSignalId: signals.parentSignalId,
      decade: signals.manifestationDecade,
      childStatus: signals.status,
      briefStatus: agentOutputs.status,
      briefId: agentOutputs.id,
    })
    .from(agentOutputs)
    .innerJoin(signals, eq(agentOutputs.signalId, signals.id))
    .where(eq(agentOutputs.agentName, "FURNACE"));

  if (briefs.length === 0) {
    console.log("No FURNACE briefs in DB yet.");
    process.exit(0);
  }

  // Look up each parent shortcode to construct the workspace URL
  console.log("=== FURNACE briefs ready for UI review ===\n");
  for (const b of briefs) {
    const [parent] = await db
      .select({ shortcode: signals.shortcode })
      .from(signals)
      .where(eq(signals.id, b.parentSignalId!))
      .limit(1);
    const parentShortcode = parent?.shortcode ?? "?";
    console.log(`  ${b.childShortcode} (${b.decade}) · brief=${b.briefStatus} · child=${b.childStatus}`);
    console.log(`    Parent workspace URL: http://localhost:3000/engine-room/signals/${parentShortcode}?m=${b.decade}#FURNACE`);
    console.log(`    (Click the FURNACE tab once on the workspace.)`);
    console.log();
  }

  // Also list a few IN_FURNACE manifestations WITHOUT briefs (so Inba
  // can see the "FURNACE Processing" empty state in the renderer if he
  // wants — those won't auto-trigger because Inngest isn't wired in dev
  // unless the dev tunnel is up).
  const noBrief = await db
    .select({
      shortcode: signals.shortcode,
      parentSignalId: signals.parentSignalId,
      decade: signals.manifestationDecade,
    })
    .from(signals)
    .where(
      and(
        eq(signals.status, "IN_FURNACE"),
      ),
    )
    .limit(5);

  const briefedSignalIds = new Set(briefs.map((b) => b.childShortcode));
  const empties = noBrief.filter((m) => !briefedSignalIds.has(m.shortcode));
  if (empties.length > 0) {
    console.log("=== Manifestations at IN_FURNACE WITHOUT a brief (will show 'Processing' empty state) ===\n");
    for (const m of empties.slice(0, 3)) {
      const [parent] = await db
        .select({ shortcode: signals.shortcode })
        .from(signals)
        .where(eq(signals.id, m.parentSignalId!))
        .limit(1);
      console.log(
        `  ${m.shortcode} (${m.decade}) → http://localhost:3000/engine-room/signals/${parent?.shortcode}?m=${m.decade}#FURNACE`,
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[list] fatal:", err);
  process.exit(1);
});
