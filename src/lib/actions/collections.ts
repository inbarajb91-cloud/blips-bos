"use server";

import { and, desc, eq, ne } from "drizzle-orm";
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
export type SearchMode = "trend" | "reference";
export type DecadeHint = "any" | "RCK" | "RCL" | "RCD";

export interface CreateCollectionInput {
  name: string;
  outline?: string;
  type: CollectionType;
  targetCount: number;
  cadence?: Cadence;
  cadenceCron?: string;
  /** Phase 6.6 — trend (default) uses standing 5 sources + filter.
   *  reference uses Gemini grounded-search with outline as the query. */
  searchMode?: SearchMode;
  /** Phase 6.6 — optional audience bias on sourcing. Does NOT replace
   *  STOKER's decade-manifestation fan-out downstream. */
  decadeHint?: DecadeHint;
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

  // Phase 6.6 — reference mode requires a meaningful outline as the query
  const searchMode: SearchMode = input.searchMode ?? "trend";
  const decadeHint: DecadeHint = input.decadeHint ?? "any";
  const trimmedOutline = input.outline?.trim() || null;
  if (searchMode === "reference") {
    if (!trimmedOutline || trimmedOutline.length < 10) {
      throw new Error(
        "Reference mode needs an outline of at least 10 characters — it becomes the actual search query.",
      );
    }
  }

  const nextRunAt =
    input.type === "scheduled" ? computeNextRunAt(input.cadence!) : null;

  // Status semantics:
  //   Instant/Batch — created as 'queued' because we immediately fire an
  //     Inngest event; queued means "event sent, awaiting pickup" for a
  //     short window before the runner flips it to 'running'.
  //   Scheduled   — created as 'idle' with a nextRunAt. Queued doesn't fit:
  //     no event is sent on creation. The hourly cron (bunkerScheduledCheck)
  //     filters status='idle' + nextRunAt<=now — so a scheduled collection
  //     must start idle to ever be picked up. Also unblocks the Run Now
  //     button on the spine, which hides while isActive (queued|running).
  const initialStatus: "queued" | "idle" =
    input.type === "scheduled" ? "idle" : "queued";

  const [collection] = await db
    .insert(collections)
    .values({
      orgId: user.orgId,
      name,
      outline: trimmedOutline,
      type: input.type,
      targetCount: input.targetCount,
      cadence: input.cadence ?? null,
      cadenceCron: input.cadenceCron ?? null,
      searchMode,
      decadeHint,
      status: initialStatus,
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
 * Regenerate — fire BUNKER against an existing collection to add more
 * candidates to its triage pool. Works on all types: Instant, Batch, and
 * Scheduled. Direct submissions / Legacy buckets are excluded at the UI
 * layer (they're not BUNKER runs).
 *
 * The count parameter is a per-run override. It does NOT mutate the
 * collection's original `targetCount` — that stays as the original intent
 * of "how many signals this collection was created to hold." Regenerate is
 * ad-hoc: "add N more fresh candidates, same prompt." If omitted, defaults
 * to the collection's own targetCount.
 *
 * Optimistic status flip: we set status='queued' before returning so the
 * Bridge UI hides the Regenerate button immediately and shows the "QUEUED
 * · starting…" label + progress pulse. Without this, there's a 1–3s gap
 * between the server action returning and Inngest picking up the event,
 * during which the button would stay clickable (double-fire risk) and the
 * spine would misleadingly show "idle" while work is actually in flight.
 */
export async function runCollectionNow(
  collectionId: string,
  opts?: { count?: number },
) {
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
  // Catching 'queued' here too prevents double-queueing when a second click
  // slips through before Realtime propagates the first flip to the client,
  // or when the hourly cron fires the same collection at the same moment
  // the user manually hits Regenerate.
  if (c.status === "queued") throw new Error("Collection is already queued.");
  if (c.status === "archived") throw new Error("Collection is archived.");

  // Validate count override when present. 1–100 is the allowed window —
  // matches Batch bounds and keeps the single LLM run predictable.
  let count: number | undefined;
  if (opts?.count !== undefined) {
    const n = Math.floor(opts.count);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      throw new Error("Regenerate count must be between 1 and 100.");
    }
    count = n;
  }

  // Optimistic status flip — button hides + progress pulse appears instantly.
  // Inngest's runner will flip to 'running' when it actually picks up.
  //
  // Compensating revert: if inngest.send fails (network blip, outage, auth
  // drift), we'd leave the collection stranded in 'queued' with no event
  // in flight — the UI hides the Regenerate button on isActive so the user
  // can't retry, and onFailure only runs if a runner actually picks up. We
  // snapshot the prior state, wrap send in try/catch, and revert on error.
  const previousStatus = c.status;
  const previousUpdatedAt = c.updatedAt;

  await db
    .update(collections)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(
        eq(collections.id, collectionId),
        eq(collections.orgId, user.orgId),
      ),
    );

  try {
    await inngest.send({
      name: "bunker.collection.run",
      data: {
        orgId: user.orgId,
        collectionId: c.id,
        ...(count !== undefined ? { count } : {}),
      },
    });
  } catch (sendErr) {
    // Best-effort revert. If this itself fails, log loudly — the collection
    // is still recoverable via manual SQL, and the #2 status gate will at
    // least fail cleanly on next attempt.
    try {
      await db
        .update(collections)
        .set({ status: previousStatus, updatedAt: previousUpdatedAt })
        .where(
          and(
            eq(collections.id, collectionId),
            eq(collections.orgId, user.orgId),
          ),
        );
    } catch (revertErr) {
      console.error(
        "[runCollectionNow] revert after inngest.send failure also failed",
        { collectionId: c.id, sendErr, revertErr },
      );
    }
    console.error("[runCollectionNow] inngest.send failed", {
      collectionId: c.id,
      err: sendErr,
    });
    throw new Error("Could not queue collection run. Please try again.");
  }

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

  return await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.orgId, user.orgId),
        ne(collections.status, "archived"),
      ),
    )
    .orderBy(desc(collections.updatedAt));
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
