/**
 * DB connectivity smoke test.
 * Loads .env.local manually (tsx doesn't auto-load Next.js env files),
 * opens a postgres connection, runs a trivial query, reports result.
 *
 * Usage: npx tsx scripts/db-check.ts
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

// ── Load .env.local ────────────────────────────────────────────────
const envFile = readFileSync(".env.local", "utf-8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = value;
}

// ── Validate DATABASE_URL ─────────────────────────────────────────
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL not set in .env.local");
  process.exit(1);
}
if (url.includes("REPLACE_ME")) {
  console.error("✗ DATABASE_URL still has REPLACE_ME placeholder");
  process.exit(1);
}
if (url.startsWith("DATABASE_URL=")) {
  console.error(
    "✗ DATABASE_URL has duplicated prefix — value starts with 'DATABASE_URL='",
  );
  console.error("  Remove the outer 'DATABASE_URL=' so the value begins 'postgresql://...'");
  process.exit(1);
}
if (url.includes("[") || url.includes("]")) {
  console.error(
    "✗ DATABASE_URL contains square brackets — likely the password is still wrapped in [...]",
  );
  console.error("  Remove the brackets from around the password.");
  process.exit(1);
}

// ── Parse port to verify pooler mode ───────────────────────────────
const portMatch = url.match(/:(\d+)\//);
const port = portMatch?.[1];
if (port && port !== "6543") {
  console.warn(
    `⚠ DATABASE_URL uses port :${port}. Transaction pooler (:6543) is recommended for Vercel serverless.`,
  );
}

// ── Connect + query ────────────────────────────────────────────────
async function main() {
  const sql = postgres(url!, { max: 1, prepare: false });

  try {
    const [row] = await sql<
      { db: string; user: string; version: string; ts: Date }[]
    >`SELECT current_database() as db, current_user as user, version() as version, now() as ts`;
    console.log("✓ Connected to Supabase Postgres");
    console.log(`  database: ${row.db}`);
    console.log(`  user:     ${row.user}`);
    console.log(`  version:  ${row.version.split(",")[0]}`);
    console.log(`  server time: ${row.ts.toISOString()}`);
    console.log(`  port:     :${port}`);
  } catch (e) {
    const err = e as Error;
    console.error("✗ Connection failed");
    console.error(`  ${err.message}`);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
