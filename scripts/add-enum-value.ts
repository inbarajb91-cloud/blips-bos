/**
 * Add 'llm_synthesis' to the signal_source enum.
 * Standalone script because drizzle-kit push has a known bug on some enum alterations.
 * Idempotent — ADD VALUE IF NOT EXISTS.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

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

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql.unsafe(
      "ALTER TYPE signal_source ADD VALUE IF NOT EXISTS 'llm_synthesis'",
    );
    console.log("✓ signal_source enum now includes 'llm_synthesis'");

    const rows = await sql<{ enumlabel: string }[]>`
      SELECT unnest(enum_range(NULL::signal_source))::text AS enumlabel
    `;
    console.log("\nFinal signal_source values:");
    for (const r of rows) console.log(`  - ${r.enumlabel}`);
  } catch (e) {
    console.error("✗ Failed:", (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
main();
