"use client";

import { useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

/**
 * Silent client component that keeps Bridge live against Supabase Realtime.
 * Subscribes to:
 *   - bunker_candidates  (new candidates arriving during a run)
 *   - collections        (status flips: queued → running → idle)
 *   - collection_runs    (run progress updates)
 *   - signals            (status transitions as stages advance)
 *
 * Any change → router.refresh() → page re-renders against fresh data.
 * Noop UI — rendered as a zero-height invisible sibling.
 */
export function BridgeRealtime() {
  const router = useRouter();

  useRealtimeChannel("bunker_candidates", () => router.refresh());
  useRealtimeChannel("collections", () => router.refresh());
  useRealtimeChannel("collection_runs", () => router.refresh());
  useRealtimeChannel("signals", () => router.refresh());

  return null;
}
