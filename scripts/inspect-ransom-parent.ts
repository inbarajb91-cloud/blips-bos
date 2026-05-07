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
  console.log("PARENT:", parent.shortcode, "id:", parent.id);

  const outs = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, parent.id), eq(agentOutputs.agentName, "STOKER"))
  );
  for (const o of outs) {
    console.log("\n=== Parent STOKER output ===");
    console.log("status:", o.status);
    console.log("content keys:", Object.keys((o.content as Record<string, unknown>) ?? {}).join(", "));
    const c = o.content as Record<string, unknown>;
    if (c.decades && Array.isArray(c.decades)) {
      for (const d of c.decades) {
        const dr = d as Record<string, unknown>;
        console.log(`\n  decade: ${dr.decade} score=${dr.resonanceScore}`);
        const m = dr.manifestation as Record<string, unknown> | null;
        if (m) {
          console.log(`  manifestation keys: ${Object.keys(m).join(", ")}`);
          console.log(`  manifestationSignalId: ${dr.manifestationSignalId}`);
        } else {
          console.log("  manifestation: null");
        }
      }
    }
    console.log("\nrefused:", c.refused);
    console.log("refusalRationale:", c.refusalRationale);
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
