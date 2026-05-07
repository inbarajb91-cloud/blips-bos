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
  const [parentStoker] = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, parent.id), eq(agentOutputs.agentName, "STOKER"))
  );
  const c = parentStoker.content as Record<string, unknown>;
  const decades = c.decades as Array<Record<string, unknown>>;
  const rcl = decades.find((d) => d.decade === "RCL");
  const m = rcl!.manifestation as Record<string, unknown>;
  console.log("RCL manifestation in PARENT STOKER content:");
  console.log("  framingHook:", JSON.stringify(m.framingHook));
  console.log("  tensionAxis:", JSON.stringify(m.tensionAxis));
  console.log();
  console.log("  narrativeAngle (raw):");
  console.log(JSON.stringify(m.narrativeAngle));
  console.log();
  console.log("  narrativeAngle (length):", (m.narrativeAngle as string).length);
  console.log("  contains apostrophe:", (m.narrativeAngle as string).includes("'"));
  console.log("  contains backtick:", (m.narrativeAngle as string).includes("`"));
  console.log("  contains backslash:", (m.narrativeAngle as string).includes("\\"));
  console.log("  contains curly quote:", (m.narrativeAngle as string).includes("'") || (m.narrativeAngle as string).includes("'"));

  // Test the splitter
  const text = m.narrativeAngle as string;
  const segments = text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 0);
  console.log("\nSplit into", segments.length, "segments");
  for (let i = 0; i < segments.length; i++) {
    console.log(`  [${i}] (${segments[i].length} chars): ${segments[i].slice(0, 100)}...`);
  }

  // Also dump the OVERALL rationale + RCL's rationale
  console.log("\noverallRationale:", JSON.stringify(c.overallRationale));
  console.log("\nRCL rationale:", JSON.stringify(rcl!.rationale));

  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
