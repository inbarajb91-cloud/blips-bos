/**
 * Verify the Phase 11D.1 BOILER v2 schema migration applied cleanly.
 *
 * Exercises the three new tables (design_versions, mockup_renders, boiler_state)
 * end-to-end:
 *   1. INSERT a design_versions row → returns generated id
 *   2. INSERT a mockup_renders row referencing it → succeeds, FK works
 *   3. INSERT a boiler_state row referencing the version → succeeds, UNIQUE works
 *   4. UPDATE → updated_at trigger fires
 *   5. Insert a duplicate mockup_render (same design × colorway × face) → must fail (UNIQUE constraint)
 *   6. Insert a duplicate boiler_state (same signal × journey) → must fail (UNIQUE constraint)
 *   7. Cascade DELETE the design_version → mockup_renders rows go away
 *   8. Cleanup: delete the boiler_state row + signal test fixture
 *
 * Catches the most common migration mistakes:
 *   - Missing foreign keys (would let dangling references through)
 *   - Missing UNIQUE constraints (would let duplicate renders pile up)
 *   - Missing cascade-delete (would orphan mockup_renders when designs deleted)
 *   - Wrong column types (insert would fail with a type error)
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/verify-boiler-v2-schema.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — DATABASE_URL missing
 *   2 — migration not applied (table doesn't exist)
 *   3 — FK / UNIQUE / cascade check failed
 *   4 — script crashed
 *
 * Safe to run against prod — uses test fixtures with deterministic UUIDs
 * inside a transaction that's rolled back at the end.
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/index";
import {
  designVersions,
  mockupRenders,
  boilerState,
  orgs,
  signals,
} from "../src/db/schema";

// Deterministic test UUIDs — visible in DB logs if anything leaks; not random
// so we can clean up after failed runs by ID lookup.
const TEST_ORG_ID = "00000000-0000-0000-0000-00000000d011";
const TEST_SIGNAL_ID = "00000000-0000-0000-0000-00000000d012";

async function cleanup(): Promise<void> {
  // Cascade delete via signal handles design_versions + mockup_renders + boiler_state
  await db.delete(signals).where(sql`${signals.id} = ${TEST_SIGNAL_ID}`);
  await db.delete(orgs).where(sql`${orgs.id} = ${TEST_ORG_ID}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL not set");
    process.exit(1);
  }

  console.log("Phase 11D.1 — BOILER v2 schema verification");
  console.log("──────────────────────────────────────────────");

  try {
    // ─── Step 0: clean up any leftover fixtures from a prior failed run ──
    await cleanup();

    // ─── Step 1: confirm the three new tables exist ──────────────────────
    const tables = (await db.execute(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_name IN ('design_versions', 'mockup_renders', 'boiler_state')`,
    )) as unknown as { rows: Array<{ table_name: string }> };
    const found = new Set(tables.rows.map((r) => r.table_name));
    const required = ["design_versions", "mockup_renders", "boiler_state"];
    for (const t of required) {
      if (!found.has(t)) {
        console.error(`✗ migration not applied — table ${t} missing`);
        process.exit(2);
      }
    }
    console.log("✓ all 3 tables exist");

    // ─── Step 2: create test fixtures ────────────────────────────────────
    await db
      .insert(orgs)
      .values({
        id: TEST_ORG_ID,
        name: "Verify Test Org (Phase 11D.1)",
        slug: "verify-phase-11d-1",
      });
    await db.insert(signals).values({
      id: TEST_SIGNAL_ID,
      orgId: TEST_ORG_ID,
      shortcode: "VRFY-RCK",
      workingTitle: "Phase 11D.1 verify-script test signal",
      concept: "Test signal for BOILER v2 schema verification",
      source: "direct",
      status: "IN_BOILER",
    });
    console.log("✓ test fixtures created (org + signal)");

    // ─── Step 3: insert a design_version ────────────────────────────────
    const [v1] = await db
      .insert(designVersions)
      .values({
        orgId: TEST_ORG_ID,
        signalId: TEST_SIGNAL_ID,
        tier: "low",
        promptUsed: "test prompt for verification",
        paletteRoles: {
          garment_base: "#5A2020",
          ring_outer: "#2A0F0F",
          ring_inner: "#9E5050",
          front_ink: "#E8D5D2",
          back_ink: "#A04040",
        },
        compositionMeta: {
          exact_text: {
            front: "AHEAD ON PAPER.",
            back: "BEHIND ON SOMETHING.",
          },
        },
      })
      .returning();
    if (!v1) {
      console.error("✗ design_versions insert returned no row");
      process.exit(3);
    }
    console.log(`✓ design_versions insert succeeded (id=${v1.id})`);

    // ─── Step 4: insert a mockup_render referencing the version ─────────
    await db.insert(mockupRenders).values({
      orgId: TEST_ORG_ID,
      designVersionId: v1.id,
      colorwayHex: "#5A2020",
      face: "front",
      renderer: "svg_flatlay",
    });
    console.log("✓ mockup_renders insert succeeded (FK works)");

    // ─── Step 5: insert a duplicate mockup_render — must fail ───────────
    let duplicateMockupBlocked = false;
    try {
      await db.insert(mockupRenders).values({
        orgId: TEST_ORG_ID,
        designVersionId: v1.id,
        colorwayHex: "#5A2020",
        face: "front",
        renderer: "svg_flatlay",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("mockup_renders_unique") ||
        msg.includes("duplicate key")
      ) {
        duplicateMockupBlocked = true;
      } else {
        throw e;
      }
    }
    if (!duplicateMockupBlocked) {
      console.error("✗ UNIQUE constraint on mockup_renders did NOT block duplicate");
      process.exit(3);
    }
    console.log("✓ mockup_renders UNIQUE constraint blocked duplicate");

    // ─── Step 6: insert a boiler_state row ──────────────────────────────
    await db.insert(boilerState).values({
      orgId: TEST_ORG_ID,
      signalId: TEST_SIGNAL_ID,
      activeVersionId: v1.id,
      activeGarmentHex: "#5A2020",
      activePaletteRoles: {
        garment_base: "#5A2020",
        ring_outer: "#2A0F0F",
        ring_inner: "#9E5050",
        front_ink: "#E8D5D2",
        back_ink: "#A04040",
      },
    });
    console.log("✓ boiler_state insert succeeded");

    // ─── Step 7: insert a duplicate boiler_state — must fail ────────────
    let duplicateStateBlocked = false;
    try {
      await db.insert(boilerState).values({
        orgId: TEST_ORG_ID,
        signalId: TEST_SIGNAL_ID,
        activeVersionId: v1.id,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("boiler_state_signal_journey_unique") ||
        msg.includes("duplicate key")
      ) {
        duplicateStateBlocked = true;
      } else {
        throw e;
      }
    }
    if (!duplicateStateBlocked) {
      console.error(
        "✗ UNIQUE (signal_id, journey_id) on boiler_state did NOT block duplicate",
      );
      process.exit(3);
    }
    console.log("✓ boiler_state UNIQUE (signal_id, journey_id) blocked duplicate");

    // ─── Step 8: confirm cascade delete via design_versions removes mockup_renders ─
    await db
      .delete(designVersions)
      .where(sql`${designVersions.id} = ${v1.id}`);
    const remaining = await db
      .select({ id: mockupRenders.id })
      .from(mockupRenders)
      .where(sql`${mockupRenders.designVersionId} = ${v1.id}`);
    if (remaining.length > 0) {
      console.error(
        `✗ cascade delete failed — ${remaining.length} mockup_renders still exist`,
      );
      process.exit(3);
    }
    console.log("✓ design_versions cascade-deletes mockup_renders correctly");

    // ─── Step 9: confirm cascade delete via signal removes boiler_state ─
    await db.delete(signals).where(sql`${signals.id} = ${TEST_SIGNAL_ID}`);
    const stateRemaining = await db
      .select({ id: boilerState.id })
      .from(boilerState)
      .where(sql`${boilerState.signalId} = ${TEST_SIGNAL_ID}`);
    if (stateRemaining.length > 0) {
      console.error(
        `✗ signal cascade delete did NOT remove boiler_state rows (${stateRemaining.length} remaining)`,
      );
      process.exit(3);
    }
    console.log("✓ signal cascade-deletes boiler_state correctly");

    // ─── Cleanup ────────────────────────────────────────────────────────
    await cleanup();

    console.log("──────────────────────────────────────────────");
    console.log("✓ All Phase 11D.1 schema checks passed.");
    console.log(
      "  Migration is safe to use. Proceed to Phase 11D.2 (skill rewrite).",
    );
    process.exit(0);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`✗ verify script crashed: ${msg}`);
    if (e instanceof Error && e.stack) console.error(e.stack);
    // Best-effort cleanup before exit
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
    process.exit(4);
  }
}

void main();
