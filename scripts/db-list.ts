/**
 * List all tables in the public schema with their RLS state.
 * Throwaway verification script.
 *
 * Usage: npx tsx scripts/db-list.ts
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
  const rows = await sql<{ table_name: string; rls: string }[]>`
    SELECT
      c.relname AS table_name,
      CASE WHEN c.relrowsecurity THEN 'ON' ELSE 'OFF' END AS rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname;
  `;
  console.log(`${rows.length} tables in public schema:\n`);
  for (const r of rows) {
    console.log(`  ${r.table_name.padEnd(28)} RLS: ${r.rls}`);
  }
  await sql.end();
}
main();
