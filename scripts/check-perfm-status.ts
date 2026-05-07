import { existsSync, readFileSync } from "node:fs";
if (existsSync(".env.local")) {
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
}
async function main() {
  const { db } = await import("../src/db");
  const { signals, agentOutputs, agentLogs } = await import("../src/db/schema");
  const { eq, and, desc } = await import("drizzle-orm");

  const [parent] = await db.select().from(signals).where(eq(signals.shortcode, "PERFM")).limit(1);
  if (!parent) { console.log("PERFM not found"); process.exit(1); }
  console.log(`PARENT PERFM: status=${parent.status}\n`);

  const children = await db.select().from(signals).where(eq(signals.parentSignalId, parent.id));
  for (const c of children) {
    console.log(`--- ${c.shortcode} (${c.manifestationDecade}) signal.status=${c.status} ---`);
    const outs = await db
      .select()
      .from(agentOutputs)
      .where(eq(agentOutputs.signalId, c.id))
      .orderBy(desc(agentOutputs.createdAt));
    if (outs.length === 0) {
      console.log("  no agent_outputs");
    } else {
      for (const o of outs) {
        console.log(`  ${o.agentName} status=${o.status} approvedAt=${o.approvedAt?.toISOString() ?? "null"} createdAt=${o.createdAt?.toISOString()}`);
      }
    }
    // Check agent_logs for FURNACE invocations
    const logs = await db
      .select()
      .from(agentLogs)
      .where(and(eq(agentLogs.signalId, c.id), eq(agentLogs.agentName, "FURNACE")))
      .orderBy(desc(agentLogs.createdAt))
      .limit(5);
    if (logs.length > 0) {
      console.log(`  FURNACE agent_logs (${logs.length}):`);
      for (const l of logs) {
        console.log(`    action=${l.action} status=${l.status} model=${l.model ?? "?"} duration=${l.durationMs}ms err=${l.errorMessage?.slice(0, 100) ?? "(none)"}`);
      }
    } else {
      console.log("  NO FURNACE agent_logs — Inngest never fired or never reached the skill");
    }
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
