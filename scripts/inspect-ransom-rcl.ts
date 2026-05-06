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

  const [rcl] = await db.select().from(signals).where(eq(signals.shortcode, "RANSOM-RCL")).limit(1);
  console.log("RCL signal:", JSON.stringify({
    id: rcl.id, shortcode: rcl.shortcode, status: rcl.status,
    parentSignalId: rcl.parentSignalId, manifestationDecade: rcl.manifestationDecade,
    workingTitle: rcl.workingTitle?.slice(0, 80),
    concept: rcl.concept?.slice(0, 80),
  }, null, 2));

  const outs = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, rcl.id), eq(agentOutputs.agentName, "STOKER"))
  );
  for (const o of outs) {
    console.log("\nSTOKER output id:", o.id);
    console.log("status:", o.status);
    console.log("section_approvals:", JSON.stringify(o.sectionApprovals));
    console.log("revisions count:", Array.isArray(o.revisions) ? o.revisions.length : "not-array");
    const c = o.content as Record<string, unknown>;
    console.log("content:", JSON.stringify(c, null, 2));
  }

  // Also check for FURNACE outputs (should be none, but let's verify)
  const furnaceOuts = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, rcl.id), eq(agentOutputs.agentName, "FURNACE"))
  );
  console.log("\nFURNACE outputs count:", furnaceOuts.length);

  // Compare to RCK
  const [rck] = await db.select().from(signals).where(eq(signals.shortcode, "RANSOM-RCK")).limit(1);
  const rckOuts = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, rck.id), eq(agentOutputs.agentName, "STOKER"))
  );
  console.log("\n=== RCK content for comparison ===");
  for (const o of rckOuts) {
    const c = o.content as Record<string, unknown>;
    console.log("RCK content:", JSON.stringify(c, null, 2));
  }

  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
