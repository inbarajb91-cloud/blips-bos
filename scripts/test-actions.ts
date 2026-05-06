/**
 * Directly invoke acquireSignalLock + getOrCreateOrcConversation against
 * the prod DB, simulating Inba's auth context. This bypasses Next.js
 * server-action wrapping so we see the RAW thrown error.
 *
 * Usage: npx tsx scripts/test-actions.ts <signalShortcode>
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
  const SHORTCODE = process.argv[2] ?? "PERFM";
  const { db } = await import("../src/db");
  const { signals, users, orgs } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  // Resolve Inba's user
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips")).limit(1);
  if (!org) { console.error("BLIPS org not found"); process.exit(1); }
  const [founder] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, org.id), eq(users.role, "FOUNDER")))
    .limit(1);
  if (!founder) { console.error("Founder not found"); process.exit(1); }
  console.log(`Founder: ${founder.email} authId=${founder.id} orgId=${org.id}`);

  // Resolve signal
  const [signal] = await db.select().from(signals).where(eq(signals.shortcode, SHORTCODE)).limit(1);
  if (!signal) { console.error(`Signal ${SHORTCODE} not found`); process.exit(1); }
  console.log(`Signal: ${signal.shortcode} id=${signal.id} status=${signal.status}\n`);

  // Mock the auth context — set the SUPABASE auth so getCurrentUserWithOrg
  // returns our founder. Easier: directly bypass and call internals.
  // Each internal helper that getCurrentUserWithOrg uses needs to be
  // simulated. Since auth flows through Supabase cookies, we can't
  // easily mock that without HTTP. Instead — let's call the internals
  // each action uses directly.

  // === Test 1: acquireSignalLock internals ===
  console.log("=== TEST 1: acquireSignalLock internals ===");
  try {
    const { sql } = await import("drizzle-orm");
    const LOCK_DURATION_MINUTES = 30;
    const rows = await db.execute(sql`
      INSERT INTO signal_locks (signal_id, locked_by, locked_at, expires_at)
      VALUES (
        ${signal.id}::uuid,
        ${founder.id}::uuid,
        NOW(),
        NOW() + INTERVAL '${sql.raw(String(LOCK_DURATION_MINUTES))} minutes'
      )
      ON CONFLICT (signal_id) DO UPDATE
        SET locked_by = EXCLUDED.locked_by,
            locked_at = EXCLUDED.locked_at,
            expires_at = EXCLUDED.expires_at
        WHERE signal_locks.locked_by = EXCLUDED.locked_by
           OR signal_locks.expires_at < NOW()
      RETURNING locked_by, expires_at
    `);
    console.log(`✓ lock query succeeded — ${rows.length} rows returned`);
    if (rows.length > 0) console.log(`  ${JSON.stringify(rows[0])}`);
  } catch (err) {
    const e = err as Error & { code?: string; cause?: unknown };
    console.log(`✗ lock query FAILED:`);
    console.log(`  message: ${e.message}`);
    console.log(`  name: ${e.name}`);
    console.log(`  code: ${e.code ?? "(none)"}`);
    console.log(`  cause: ${JSON.stringify(e.cause)?.slice(0, 500)}`);
    console.log(`  stack: ${e.stack?.slice(0, 600)}`);
  }

  // === Test 2: getActiveJourney internals (used by getOrCreateOrcConversation) ===
  console.log("\n=== TEST 2: getActiveJourney internals ===");
  try {
    const { journeys } = await import("../src/db/schema");
    const [j] = await db
      .select()
      .from(journeys)
      .where(and(eq(journeys.signalId, signal.id), eq(journeys.status, "active")))
      .limit(1);
    if (j) {
      console.log(`✓ active journey: ${j.id}`);
    } else {
      console.log(`⚠ no active journey for ${signal.shortcode}`);
    }
  } catch (err) {
    const e = err as Error;
    console.log(`✗ journey query FAILED: ${e.message}`);
    console.log(`  stack: ${e.stack?.slice(0, 400)}`);
  }

  // === Test 3: agent_conversations select ===
  console.log("\n=== TEST 3: agent_conversations select ===");
  try {
    const { agentConversations, journeys } = await import("../src/db/schema");
    const [j] = await db
      .select()
      .from(journeys)
      .where(and(eq(journeys.signalId, signal.id), eq(journeys.status, "active")))
      .limit(1);
    if (!j) {
      console.log(`⚠ skipping — no active journey`);
    } else {
      const [conv] = await db
        .select()
        .from(agentConversations)
        .where(
          and(
            eq(agentConversations.journeyId, j.id),
            eq(agentConversations.agentName, "ORC"),
          ),
        )
        .limit(1);
      console.log(`✓ conversation query succeeded — found=${!!conv}`);
    }
  } catch (err) {
    const e = err as Error;
    console.log(`✗ conversation query FAILED: ${e.message}`);
    console.log(`  stack: ${e.stack?.slice(0, 400)}`);
  }

  // === Test 4: agent_outputs select (with new sectionApprovals column) ===
  console.log("\n=== TEST 4: agent_outputs SELECT * (verifying sectionApprovals column reads) ===");
  try {
    const { agentOutputs } = await import("../src/db/schema");
    const [out] = await db.select().from(agentOutputs).where(eq(agentOutputs.signalId, signal.id)).limit(1);
    if (out) {
      console.log(`✓ select succeeded`);
      console.log(`  has sectionApprovals: ${"sectionApprovals" in out}`);
      console.log(`  sectionApprovals value: ${JSON.stringify(out.sectionApprovals)}`);
      console.log(`  has revisions: ${"revisions" in out}`);
    } else {
      console.log(`  no output for this signal`);
    }
  } catch (err) {
    const e = err as Error;
    console.log(`✗ agent_outputs query FAILED: ${e.message}`);
    console.log(`  stack: ${e.stack?.slice(0, 400)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
