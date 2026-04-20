/**
 * Apply RLS policies from drizzle/rls.sql.
 * Idempotent — safe to re-run whenever policies change.
 *
 * Usage: npx tsx scripts/apply-rls.ts
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
  const sqlText = readFileSync("drizzle/rls.sql", "utf-8");
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    // postgres driver can execute a multi-statement string via .unsafe()
    await sql.unsafe(sqlText);
    console.log("✓ RLS policies applied");

    // Verify: list policies per table
    const rows = await sql<{ tablename: string; policyname: string }[]>`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname;
    `;
    console.log(`\n${rows.length} policies now active:`);
    let currentTable = "";
    for (const r of rows) {
      if (r.tablename !== currentTable) {
        currentTable = r.tablename;
        console.log(`\n  ${currentTable}`);
      }
      console.log(`    - ${r.policyname}`);
    }
  } catch (e) {
    const err = e as Error;
    console.error("✗ RLS apply failed");
    console.error(`  ${err.message}`);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
main();
