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

  const [parent] = await db.select().from(signals).where(eq(signals.shortcode, "DUTY-2")).limit(1);
  if (!parent) { console.log("DUTY-2 not found"); process.exit(1); }
  console.log("PARENT:", parent.shortcode, "status:", parent.status);

  const [parentOut] = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, parent.id), eq(agentOutputs.agentName, "STOKER"))
  );
  const c = parentOut.content as Record<string, unknown>;
  const decades = c.decades as Array<Record<string, unknown>>;

  for (const d of decades) {
    const m = d.manifestation as Record<string, unknown> | null;
    console.log(`\n=== ${d.decade} score=${d.resonanceScore} ===`);
    if (!m) {
      console.log("  manifestation: null");
      continue;
    }
    console.log("  framingHook:", JSON.stringify(m.framingHook));
    console.log("  tensionAxis:", JSON.stringify(m.tensionAxis));
    console.log("  narrativeAngle (full):");
    console.log("  ", JSON.stringify(m.narrativeAngle));
    const text = m.narrativeAngle as string;
    console.log("  length:", text.length);
    // Check for any unusual chars
    const codes = [];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 || (code > 126 && code < 160) || code > 8217) {
        codes.push(`pos=${i} code=${code} char='${text[i]}'`);
      }
    }
    console.log("  unusual chars:", codes.length > 0 ? codes.slice(0, 10).join("; ") : "none");
    // Test split
    const segs = text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(s => s.trim()).filter(s => s.length > 0);
    console.log("  splits into:", segs.length, "segments");
    segs.forEach((s, i) => console.log(`    [${i}] ${s.length} chars`));
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
