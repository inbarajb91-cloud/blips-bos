/**
 * Seed initial data for BLIPS BOS.
 *
 * Creates:
 *   1. `BLIPS` org (slug: "blips")
 *   2. `public.users` row linked to the existing Supabase auth user (Inba)
 *   3. Default config rows for human gates, stage rules, model routing
 *
 * Idempotent — safe to re-run; uses ON CONFLICT DO NOTHING / UPDATE.
 *
 * Usage: npx tsx scripts/seed.ts
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

const ORG_SLUG = "blips";
const ORG_NAME = "BLIPS";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    // ── Step 1 — ensure BLIPS org exists ────────────────────────
    const [org] = await sql<{ id: string; name: string }[]>`
      INSERT INTO orgs (name, slug)
      VALUES (${ORG_NAME}, ${ORG_SLUG})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name;
    `;
    console.log(`✓ Org: ${org.name} (${org.id})`);

    // ── Step 2 — link all auth.users to the org in public.users ─
    // Any user in auth.users that isn't in public.users gets linked to BLIPS as FOUNDER
    const linkedUsers = await sql<{ id: string; email: string }[]>`
      INSERT INTO users (id, org_id, email, role)
      SELECT
        au.id,
        ${org.id}::uuid,
        au.email,
        'FOUNDER'::user_role
      FROM auth.users au
      WHERE au.email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id)
      RETURNING id, email;
    `;
    if (linkedUsers.length > 0) {
      console.log(`✓ Linked ${linkedUsers.length} auth user(s) to BLIPS org:`);
      for (const u of linkedUsers) console.log(`    - ${u.email}`);
    } else {
      console.log(`✓ All auth users already linked to public.users`);
    }

    // ── Step 3 — seed default config_bos ────────────────────────
    await sql`
      INSERT INTO config_bos (org_id, key, value)
      VALUES
        (${org.id}::uuid, 'platform_version', '"0.1"'::jsonb),
        (${org.id}::uuid, 'notifications_enabled', 'true'::jsonb),
        (${org.id}::uuid, 'default_llm_provider', '"gemini"'::jsonb)
      ON CONFLICT (org_id, key) DO NOTHING;
    `;
    console.log(`✓ config_bos seeded (3 keys)`);

    // ── Step 4 — seed default config_engine_room ────────────────
    await sql`
      INSERT INTO config_engine_room (org_id, key, value)
      VALUES
        (${org.id}::uuid, 'human_gates', '{"BUNKER":true,"STOKER":true,"FURNACE":true,"BOILER":true,"ENGINE":true,"PROPELLER":true}'::jsonb),
        (${org.id}::uuid, 'stale_thresholds_days', '{"BUNKER":3,"STOKER":2,"FURNACE":3,"BOILER":5,"ENGINE":7,"PROPELLER":14}'::jsonb),
        (${org.id}::uuid, 'pipeline_active', 'true'::jsonb),
        (${org.id}::uuid, 'batch_defaults', '{"auto_assign_to_active":false}'::jsonb)
      ON CONFLICT (org_id, key) DO NOTHING;
    `;
    console.log(`✓ config_engine_room seeded (human gates = ALL stages require approval)`);

    // ── Step 5 — seed default config_agents ─────────────────────
    // Defaults during build phase (April-May 2026): Gemini per architecture doc
    // Flip via config update once 22k INR credits expire ~May 20
    await sql`
      INSERT INTO config_agents (org_id, agent_name, key, value)
      VALUES
        -- ORC — orchestrator reasoning
        (${org.id}::uuid, 'ORC'::agent_name, 'model', '"gemini-2.5-pro"'::jsonb),
        (${org.id}::uuid, 'ORC'::agent_name, 'temperature', '0.3'::jsonb),
        -- BUNKER — extraction (simple, fast)
        (${org.id}::uuid, 'BUNKER'::agent_name, 'model', '"gemini-2.5-flash"'::jsonb),
        (${org.id}::uuid, 'BUNKER'::agent_name, 'temperature', '0.2'::jsonb),
        (${org.id}::uuid, 'BUNKER'::agent_name, 'sources_enabled', '{"direct":true,"reddit":true,"rss":true,"trends":true,"newsapi":true}'::jsonb),
        -- STOKER — season + decade tagging
        (${org.id}::uuid, 'STOKER'::agent_name, 'model', '"gemini-2.5-flash"'::jsonb),
        (${org.id}::uuid, 'STOKER'::agent_name, 'temperature', '0.3'::jsonb),
        -- FURNACE — brand fit + brief
        (${org.id}::uuid, 'FURNACE'::agent_name, 'model', '"gemini-2.5-pro"'::jsonb),
        (${org.id}::uuid, 'FURNACE'::agent_name, 'temperature', '0.5'::jsonb),
        -- BOILER — concept + mockup
        (${org.id}::uuid, 'BOILER'::agent_name, 'model', '"gemini-2.5-pro"'::jsonb),
        (${org.id}::uuid, 'BOILER'::agent_name, 'temperature', '0.7'::jsonb),
        -- ENGINE — tech pack
        (${org.id}::uuid, 'ENGINE'::agent_name, 'model', '"gemini-2.5-pro"'::jsonb),
        (${org.id}::uuid, 'ENGINE'::agent_name, 'temperature', '0.2'::jsonb),
        -- PROPELLER — vendor bundle
        (${org.id}::uuid, 'PROPELLER'::agent_name, 'model', '"gemini-2.5-flash"'::jsonb),
        (${org.id}::uuid, 'PROPELLER'::agent_name, 'temperature', '0.2'::jsonb)
      ON CONFLICT (org_id, agent_name, key) DO NOTHING;
    `;
    console.log(`✓ config_agents seeded (Gemini defaults for all 7 agents)`);

    // ── Summary ─────────────────────────────────────────────────
    const [counts] = await sql<
      {
        orgs: number;
        users: number;
        cfg_bos: number;
        cfg_er: number;
        cfg_agents: number;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM orgs)::int              AS orgs,
        (SELECT count(*) FROM public.users)::int      AS users,
        (SELECT count(*) FROM config_bos)::int        AS cfg_bos,
        (SELECT count(*) FROM config_engine_room)::int AS cfg_er,
        (SELECT count(*) FROM config_agents)::int     AS cfg_agents;
    `;
    console.log("\nFinal state:");
    console.log(`  orgs:               ${counts.orgs}`);
    console.log(`  users:              ${counts.users}`);
    console.log(`  config_bos:         ${counts.cfg_bos}`);
    console.log(`  config_engine_room: ${counts.cfg_er}`);
    console.log(`  config_agents:      ${counts.cfg_agents}`);
  } catch (e) {
    console.error("✗ Seed failed");
    console.error((e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}
main();
