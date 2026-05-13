"use server";

import { revalidatePath } from "next/cache";

/**
 * Server action: force a fresh server render of the Engine Room routes.
 *
 * Called from `BridgeRealtime` / `WorkspaceRealtime` when a Supabase
 * Postgres-changes event arrives. We previously used `router.refresh()`
 * directly, but Next.js 16 silently deduplicates rapid same-URL refresh
 * calls during sustained-write scenarios (e.g. BUNKER worker producing
 * 5 candidates over 60s with multiple status UPDATEs in between). Symptom:
 * realtime events reach the client, BridgeRealtime fires its scheduled
 * callback, but the DOM never updates — only a full nav surfaces the new
 * server state.
 *
 * A `_rt=<timestamp>` cache-bust nav works for the first event but
 * resets the JS context (window state cleared, observer subscriptions
 * torn down), causing subscription churn after that.
 *
 * Server actions don't dedup. `revalidatePath` forces an unambiguous
 * data-cache invalidation. The next render on this route's path returns
 * the latest Drizzle results, and the client merges the new RSC payload
 * into the existing tree — preserving client component state (scroll,
 * realtime subscriptions, transient UI) while updating server data.
 *
 * Why both paths revalidate `/engine-room`: the Signal Workspace pages
 * also write into Bridge's signal/candidate data (approve/dismiss),
 * so Bridge's pending count and pipeline counters need to be fresh too.
 * `revalidatePath` is cheap when nothing's changed (~no-op cost), so
 * over-revalidating is safe.
 */
export async function refreshEngineRoom(): Promise<void> {
  revalidatePath("/engine-room");
  revalidatePath("/engine-room/signals", "layout");
}
