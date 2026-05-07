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
  const { eq } = await import("drizzle-orm");

  const [parent] = await db.select().from(signals).where(eq(signals.shortcode, "RANSOM")).limit(1);
  console.log("parent:", parent?.shortcode, "status:", parent?.status, "id:", parent?.id);

  if (!parent) { console.log("not found"); process.exit(1); }

  const children = await db.select({
    id: signals.id, shortcode: signals.shortcode, status: signals.status,
    decade: signals.manifestationDecade, workingTitle: signals.workingTitle,
  }).from(signals).where(eq(signals.parentSignalId, parent.id));

  for (const c of children) {
    console.log(`\n--- ${c.shortcode} (${c.decade}) status=${c.status} ---`);
    const outs = await db.select().from(agentOutputs).where(eq(agentOutputs.signalId, c.id));
    for (const o of outs) {
      console.log(`  ${o.agentName} status=${o.status} outputType=${o.outputType}`);
      if (o.agentName === "STOKER") {
        const c2 = o.content as Record<string, unknown>;
        console.log(`    content keys: ${Object.keys(c2 ?? {}).join(", ")}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
