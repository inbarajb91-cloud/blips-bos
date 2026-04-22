"use client";

import { useCallback, useEffect, useRef } from "react";
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
 * THROTTLED: a single BUNKER run fires dozens of postgres_changes events
 * within a few seconds (each source fetch → each extracted candidate →
 * each counter update). Refreshing the server component per event stacks
 * loading skeletons visibly for the user. Debouncing to one refresh every
 * ~800ms collapses the burst into a single smooth re-render.
 */
export function BridgeRealtime() {
  const router = useRouter();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (pendingRef.current) return; // already queued; drop this event
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      router.refresh();
    }, 800);
  }, [router]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  useRealtimeChannel("bunker_candidates", schedule);
  useRealtimeChannel("collections", schedule);
  useRealtimeChannel("collection_runs", schedule);
  useRealtimeChannel("signals", schedule);

  return null;
}
