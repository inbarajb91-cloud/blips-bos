/**
 * Manually fire the stoker.manifestation.approved event for one of the
 * approved PERFM children. Tests if Inngest Cloud receives the event +
 * if the FURNACE function is registered.
 *
 * Usage: npx tsx scripts/fire-furnace-event.ts PERFM-RCL
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
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  const SHORTCODE = process.argv[2] ?? "PERFM-RCL";
  const { db } = await import("../src/db");
  const { signals } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const [child] = await db.select().from(signals).where(eq(signals.shortcode, SHORTCODE)).limit(1);
  if (!child) { console.error(`${SHORTCODE} not found`); process.exit(1); }
  console.log(`Manifestation: ${child.shortcode} id=${child.id} orgId=${child.orgId}`);

  const { inngest } = await import("../src/lib/inngest/client");
  console.log("Firing stoker.manifestation.approved...");
  try {
    const result = await inngest.send({
      name: "stoker.manifestation.approved",
      data: {
        orgId: child.orgId,
        manifestationSignalId: child.id,
      },
    });
    console.log(`✓ Event sent. ids=${JSON.stringify(result.ids)}`);
  } catch (err) {
    console.error("✗ Send failed:", err);
    process.exit(1);
  }

  console.log("\n⏳ Wait ~30s, then re-run check-perfm-status.ts to see if FURNACE picked it up.");
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
