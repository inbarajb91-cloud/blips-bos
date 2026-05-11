/**
 * Compare schema between OLD Supabase project (via Supabase MCP — done out-of-band)
 * and NEW project (via DATABASE_URL). Reports diffs in tables, columns, enums,
 * indexes, RLS policies, realtime publication, config_agents rows.
 *
 * Used to validate the migration was complete after Inba's account move.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const envFile = readFileSync(
  "/Users/inbaraj/blips-bos/.env.local",
  "utf-8",
);
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

interface SchemaSnapshot {
  tables: string[];
  columns: Record<string, string[]>;
  enums: Record<string, string[]>;
  indexes: Record<string, string[]>;
  policies: Record<string, string[]>;
  realtimePub: string[];
  configAgents: Record<string, string[]>;
  helperFunctions: string[];
}

async function snapshot(connectionUrl: string): Promise<SchemaSnapshot> {
  const sql = postgres(connectionUrl, { max: 1, prepare: false });
  try {
    const tables =
      (await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`) as Array<{
        tablename: string;
      }>;

    const columns: Record<string, string[]> = {};
    for (const t of tables) {
      const cols =
        (await sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t.tablename} ORDER BY ordinal_position`) as Array<{
          column_name: string;
        }>;
      columns[t.tablename] = cols.map((c) => c.column_name);
    }

    const enumRows =
      (await sql`SELECT t.typname, e.enumlabel
                 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 ORDER BY t.typname, e.enumsortorder`) as Array<{
        typname: string;
        enumlabel: string;
      }>;
    const enums: Record<string, string[]> = {};
    for (const r of enumRows) {
      (enums[r.typname] ??= []).push(r.enumlabel);
    }

    const idxRows =
      (await sql`SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`) as Array<{
        tablename: string;
        indexname: string;
      }>;
    const indexes: Record<string, string[]> = {};
    for (const r of idxRows) {
      (indexes[r.tablename] ??= []).push(r.indexname);
    }

    const polRows =
      (await sql`SELECT schemaname || '.' || tablename AS table_name, policyname FROM pg_policies WHERE schemaname IN ('public') ORDER BY tablename, policyname`) as Array<{
        table_name: string;
        policyname: string;
      }>;
    const policies: Record<string, string[]> = {};
    for (const r of polRows) {
      (policies[r.table_name] ??= []).push(r.policyname);
    }

    const realtimePub =
      ((await sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename`) as Array<{
        tablename: string;
      }>).map((r) => r.tablename);

    const configAgents: Record<string, string[]> = {};
    try {
      const agentRows =
        (await sql`SELECT agent_name, key FROM config_agents ORDER BY agent_name, key`) as Array<{
          agent_name: string;
          key: string;
        }>;
      for (const r of agentRows) {
        (configAgents[r.agent_name] ??= []).push(r.key);
      }
    } catch {
      // table may not exist on the OLD project view; we already know it does
    }

    const helperRows =
      (await sql`SELECT proname FROM pg_proc WHERE proname IN ('current_org_id') ORDER BY proname`) as Array<{
        proname: string;
      }>;

    return {
      tables: tables.map((t) => t.tablename),
      columns,
      enums,
      indexes,
      policies,
      realtimePub,
      configAgents,
      helperFunctions: helperRows.map((r) => r.proname),
    };
  } finally {
    await sql.end();
  }
}

function diff<T>(label: string, oldArr: T[], newArr: T[]): boolean {
  const onlyInOld = oldArr.filter((x) => !newArr.includes(x));
  const onlyInNew = newArr.filter((x) => !oldArr.includes(x));
  if (onlyInOld.length === 0 && onlyInNew.length === 0) {
    console.log(`  ✓ ${label}: ${oldArr.length} === ${newArr.length}`);
    return true;
  }
  console.log(
    `  ✗ ${label}: old=${oldArr.length}, new=${newArr.length}`,
  );
  if (onlyInOld.length) console.log(`     only in OLD:`, onlyInOld);
  if (onlyInNew.length) console.log(`     only in NEW:`, onlyInNew);
  return false;
}

function diffMap(
  label: string,
  oldMap: Record<string, string[]>,
  newMap: Record<string, string[]>,
): boolean {
  const allKeys = Array.from(
    new Set([...Object.keys(oldMap), ...Object.keys(newMap)]),
  ).sort();
  let allMatch = true;
  for (const k of allKeys) {
    const oa = oldMap[k] ?? [];
    const na = newMap[k] ?? [];
    const onlyInOld = oa.filter((x) => !na.includes(x));
    const onlyInNew = na.filter((x) => !oa.includes(x));
    if (onlyInOld.length === 0 && onlyInNew.length === 0) continue;
    if (allMatch) {
      console.log(`  ✗ ${label}:`);
      allMatch = false;
    }
    console.log(`     ${k}:`);
    if (onlyInOld.length)
      console.log(`       only in OLD:`, onlyInOld);
    if (onlyInNew.length)
      console.log(`       only in NEW:`, onlyInNew);
  }
  if (allMatch) console.log(`  ✓ ${label}: identical across keys`);
  return allMatch;
}

async function main() {
  const newUrl = process.env.DATABASE_URL!;
  // OLD project URL — temporarily reconstruct from the OLD snapshot we have
  // via the Supabase MCP. Since we can't connect to OLD via DATABASE_URL
  // anymore (.env.local was updated), we'll fetch the OLD via MCP-style
  // queries, but that requires being run separately. For now, we snapshot
  // NEW and dump it; the OLD snapshot was captured in chat earlier.

  console.log("Snapshotting NEW project...");
  const newSnap = await snapshot(newUrl);

  console.log("\n═══════════════════════════════════════════");
  console.log("NEW PROJECT SNAPSHOT");
  console.log("═══════════════════════════════════════════");
  console.log(
    `\nTables (${newSnap.tables.length}): ${newSnap.tables.join(", ")}`,
  );
  console.log(`\nEnums (${Object.keys(newSnap.enums).length}):`);
  for (const [name, vals] of Object.entries(newSnap.enums).sort()) {
    console.log(`  ${name} (${vals.length}): ${vals.join(", ")}`);
  }
  console.log(
    `\nRealtime pub tables (${newSnap.realtimePub.length}): ${newSnap.realtimePub.join(", ")}`,
  );
  console.log(`\nRLS policies:`);
  for (const [t, pols] of Object.entries(newSnap.policies).sort()) {
    console.log(`  ${t} (${pols.length}): ${pols.join(", ")}`);
  }
  console.log(`\nconfig_agents:`);
  for (const [a, keys] of Object.entries(newSnap.configAgents).sort()) {
    console.log(`  ${a} (${keys.length}): ${keys.join(", ")}`);
  }
  console.log(`\nHelper functions: ${newSnap.helperFunctions.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
