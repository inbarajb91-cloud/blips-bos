/**
 * Ensure pipeline tables are in the `supabase_realtime` publication so
 * `useRealtimeChannel(...)` receives live change events.
 *
 * ALTER PUBLICATION doesn't support IF EXISTS / IF NOT EXISTS, so we
 * inspect `pg_publication_tables` per table and ADD only where missing.
 *
 * Usage: npx tsx scripts/apply-realtime.ts
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

const TARGET_TABLES = [
  "signals",
  "bunker_candidates",
  "agent_outputs",
  "agent_logs",
  "signal_locks",
] as const;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    for (const table of TARGET_TABLES) {
      const [existing] = await sql<{ ok: number }[]>`
        SELECT 1 AS ok
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = ${table}
        LIMIT 1
      `;

      if (existing) {
        console.log(`✓ ${table} — already in supabase_realtime`);
      } else {
        await sql.unsafe(
          `ALTER PUBLICATION supabase_realtime ADD TABLE public.${table}`,
        );
        console.log(`+ ${table} — added to supabase_realtime`);
      }
    }

    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      ORDER BY tablename;
    `;
    console.log(
      `\nPublication membership (${rows.length} tables):`,
    );
    for (const r of rows) console.log(`  - ${r.tablename}`);
  } catch (e) {
    console.error("✗ Realtime apply failed");
    console.error((e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
main();
