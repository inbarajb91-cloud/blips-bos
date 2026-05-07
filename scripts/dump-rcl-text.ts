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
  const SHORTCODE = process.argv[2] ?? "DUTY-2";
  const { db } = await import("../src/db");
  const { agentOutputs, signals } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const [parent] = await db.select().from(signals).where(eq(signals.shortcode, SHORTCODE)).limit(1);
  const [parentOut] = await db.select().from(agentOutputs).where(
    and(eq(agentOutputs.signalId, parent.id), eq(agentOutputs.agentName, "STOKER"))
  );
  const c = parentOut.content as Record<string, unknown>;
  const decades = c.decades as Array<Record<string, unknown>>;
  const rcl = decades.find((d) => d.decade === "RCL");
  const m = rcl!.manifestation as Record<string, unknown>;

  // Dump every text field in full
  for (const k of ["framingHook", "tensionAxis", "narrativeAngle"]) {
    const text = m[k] as string;
    console.log(`\n--- ${k} (${text.length} chars) ---`);
    console.log(text);
    // Search for error-like patterns
    const haspatterns = [
      "An error occurred",
      "Server Components",
      "production builds",
      "digest property",
      "leaking sensitive",
    ].filter((p) => text.includes(p));
    if (haspatterns.length > 0) {
      console.log(`  *** CONTAINS ERROR PATTERNS: ${haspatterns.join(", ")} ***`);
    }
  }

  // Also dump dimensionAlignment
  const da = m.dimensionAlignment as Record<string, string>;
  console.log("\n--- dimensionAlignment ---");
  for (const [dim, val] of Object.entries(da)) {
    console.log(`  ${dim}: ${val}`);
    if (val.includes("An error occurred") || val.includes("Server Components")) {
      console.log(`    *** CONTAINS ERROR PATTERNS ***`);
    }
  }

  // Also rationale
  console.log("\n--- rationale ---");
  console.log(rcl!.rationale);

  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
