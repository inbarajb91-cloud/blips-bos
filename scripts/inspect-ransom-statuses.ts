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
  const { agentOutputs, signals } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const [parent] = await db.select().from(signals).where(eq(signals.shortcode, "RANSOM")).limit(1);
  const children = await db.select().from(signals).where(eq(signals.parentSignalId, parent.id));

  for (const c of children) {
    const outs = await db.select().from(agentOutputs).where(
      and(eq(agentOutputs.signalId, c.id))
    );
    console.log(`${c.shortcode} (${c.manifestationDecade}) signal.status=${c.status}`);
    for (const o of outs) {
      console.log(`  ${o.agentName}: status=${o.status} outputType=${o.outputType} sectionApprovals=${JSON.stringify(o.sectionApprovals)} approvedAt=${o.approvedAt?.toISOString() ?? "null"}`);
    }
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
