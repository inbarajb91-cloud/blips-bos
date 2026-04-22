"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, collections, collectionRuns, bunkerCandidates, signals } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { inngest } from "@/lib/inngest/client";

/**
 * Phase 6.5 — Collection lifecycle actions.
 *
 * Collections are the container for a BUNKER run's whole journey:
 * candidates (triage) → signals (pipeline through all 6 stages).
 *
 * Three types:
 *   - instant    : fixed 5 signals, one-shot, fires immediately
 *   - batch      : 6-100 signals, one-shot, fires immediately
 *   - scheduled  : 1-100 per run, recurring via cadence; cron checker fires
 */

export type CollectionType = "instant" | "batch" | "scheduled";
export type Cadence = "daily" | "weekly" | "monthly" | "custom";

export interface CreateCollectionInput {
  name: string;
  outline?: string;
  type: CollectionType;
  targetCount: number;
  cadence?: Cadence;
  cadenceCron?: string;
}

/**
 * Create a collection + (if Instant/Batch) fire it immediately.
 * Scheduled collections wait for the cron checker at next_run_at.
 */
export async function createCollection(input: CreateCollectionInput) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Validate
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Collection needs a name.");
  if (name.length > 120) throw new Error("Name is too long (max 120 chars).");

  if (input.type === "instant" && input.targetCount !== 5) {
    throw new Error("Instant collections are locked at 5 signals.");
  }
  if (input.type === "batch" && (input.targetCount < 6 || input.targetCount > 100)) {
    throw new Error("Batch size must be 6–100 signals.");
  }
  if (input.type === "scheduled") {
    if (input.targetCount < 1 || input.targetCount > 100) {
      throw new Error("Scheduled per-run count must be 1–100.");
    }
    if (!input.cadence) {
      throw new Error("Scheduled collections require a cadence.");
    }
    if (input.cadence === "custom" && !input.cadenceCron) {
      throw new Error("Custom cadence requires a cron expression.");
    }
  }

  const nextRunAt =
    input.type === "scheduled" ? computeNextRunAt(input.cadence!) : null;

  const [collection] = await db
    .insert(collections)
    .values({
      orgId: user.orgId,
      name,
      outline: input.outline?.trim() || null,
      type: input.type,
      targetCount: input.targetCount,
      cadence: input.cadence ?? null,
      cadenceCron: input.cadenceCron ?? null,
      status: "queued",
      createdBy: user.authId,
      nextRunAt,
    })
    .returning();

  // Instant + Batch: fire immediately. Scheduled: waits for cron.
  if (input.type === "instant" || input.type === "batch") {
    await inngest.send({
      name: "bunker.collection.run",
      data: { orgId: user.orgId, collectionId: collection.id },
    });
  }

  revalidatePath("/engine-room");
  return collection;
}

/**
 * Archive a collection — hides it from default Bridge view.
 * Doesn't delete; candidates/signals stay attached so history is preserved.
 */
export async function archiveCollection(collectionId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  await db
    .update(collections)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(
        eq(collections.id, collectionId),
        eq(collections.orgId, user.orgId),
      ),
    );

  revalidatePath("/engine-room");
}

/**
 * Re-fire a Batch or Scheduled collection immediately — useful for "run now"
 * button on the collection spine. Instant collections can't re-run (they're
 * one-shot by definition).
 */
export async function runCollectionNow(collectionId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const [c] = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.id, collectionId),
        eq(collections.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!c) throw new Error("Collection not found.");
  if (c.status === "running") throw new Error("Collection is already running.");
  if (c.type === "instant") {
    throw new Error("Instant collections can't re-run. Create a new one.");
  }

  await inngest.send({
    name: "bunker.collection.run",
    data: { orgId: user.orgId, collectionId: c.id },
  });

  revalidatePath("/engine-room");
}

/**
 * List collections for Bridge. Returns non-archived, newest first.
 * Candidate + signal counts are the per-collection aggregates (kept in sync
 * by the Inngest runner + approveCandidate).
 */
export async function listCollections() {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const rows = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.orgId, user.orgId),
        // Show everything except archived (including running, idle, failed)
      ),
    )
    .orderBy(desc(collections.updatedAt));

  // Filter archived client-side for now (can push to query later if needed)
  return rows.filter((r) => r.status !== "archived");
}

/**
 * Fetch one collection + its candidates (triage) + signals (pipeline).
 * Used by the Bridge to render a collection's body when expanded.
 */
export async function getCollectionWithRows(collectionId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const [collection] = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.id, collectionId),
        eq(collections.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!collection) return null;

  const pendingCandidates = await db
    .select()
    .from(bunkerCandidates)
    .where(
      and(
        eq(bunkerCandidates.collectionId, collectionId),
        eq(bunkerCandidates.status, "PENDING_REVIEW"),
      ),
    )
    .orderBy(desc(bunkerCandidates.createdAt));

  const pipelineSignals = await db
    .select()
    .from(signals)
    .where(eq(signals.collectionId, collectionId))
    .orderBy(desc(signals.updatedAt));

  return {
    collection,
    pendingCandidates,
    pipelineSignals,
  };
}

/**
 * Most recent run for a collection — for showing live progress or last-run
 * stats on the spine.
 */
export async function getLatestRun(collectionId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const [run] = await db
    .select()
    .from(collectionRuns)
    .where(
      and(
        eq(collectionRuns.collectionId, collectionId),
        eq(collectionRuns.orgId, user.orgId),
      ),
    )
    .orderBy(desc(collectionRuns.createdAt))
    .limit(1);

  return run ?? null;
}

// ─── Helpers ────────────────────────────────────────────────────────

function computeNextRunAt(cadence: Cadence): Date {
  const now = new Date();
  const next = new Date(now);
  switch (cadence) {
    case "daily":
      next.setDate(now.getDate() + 1);
      next.setHours(6, 0, 0, 0); // 6am local next day
      break;
    case "weekly":
      next.setDate(now.getDate() + 7);
      next.setHours(6, 0, 0, 0);
      break;
    case "monthly":
      next.setMonth(now.getMonth() + 1);
      next.setHours(6, 0, 0, 0);
      break;
    case "custom":
      // Custom cron is parsed by the cron-checker, not here. Set a
      // near-future placeholder so the checker picks it up on next tick.
      next.setMinutes(now.getMinutes() + 5);
      break;
  }
  return next;
}
