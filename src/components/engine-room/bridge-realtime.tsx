"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshEngineRoom } from "@/app/(app)/engine-room/_actions/refresh";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

interface BridgeRealtimeProps {
  /**
   * Server-side signal that at least one collection is queued or running.
   * When true, we additionally poll every 2s as a belt-and-suspenders
   * fallback against Realtime quirks (cold subscribe race, token drift,
   * RLS mis-fire). When false, Realtime alone handles the occasional
   * create / archive event.
   */
  hasActiveWork: boolean;
}

/**
 * Silent client component that keeps Bridge live.
 *
 * Two paths drive `router.refresh()`:
 *
 * (1) **Supabase Realtime** on 4 tables — primary. Subscribes to
 *     bunker_candidates, collections, collection_runs, signals. Uses the
 *     JWT-attached channel from `useRealtimeChannel` (Phase 6.6 setAuth
 *     fix) so RLS-scoped events actually reach the browser.
 *     Throttled at 800ms so a burst of events (a running collection
 *     fires dozens per second) collapses into one smooth re-render.
 *
 * (2) **Interval poll (2s)** — fallback, only while `hasActiveWork` is
 *     true. Guarantees the UI moves even if Realtime has a bad minute.
 *     Stops when all collections settle (idle/failed/archived).
 *
 * Noop UI — renders nothing.
 */
export function BridgeRealtime({ hasActiveWork }: BridgeRealtimeProps) {
  const router = useRouter();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (pendingRef.current) return; // already queued; drop this event
    pendingRef.current = setTimeout(async () => {
      pendingRef.current = null;
      // Two-step refresh that survives Next.js 16's `router.refresh()`
      // dedup AND the cache-bust nav side-effect of resetting JS state.
      //
      // (1) `refreshEngineRoom()` is a server action that calls
      //     `revalidatePath("/engine-room")`. Server actions bypass the
      //     client router's dedup logic entirely. This invalidates the
      //     server-side data cache for the route.
      // (2) `router.refresh()` after the action settles tells the
      //     client-side router cache to re-fetch + re-render with the
      //     now-fresh server data. Without (1) above, this step alone
      //     was getting deduped; with (1) feeding fresh data in, the
      //     client correctly applies the new payload to the live DOM.
      //
      // Net effect: realtime event → fresh DB query → DOM updates,
      // WITHOUT navigation (URL stays canonical), WITHOUT JS state
      // reset (subscriptions, scroll, transient UI all preserved).
      try {
        await refreshEngineRoom();
      } catch {
        // Server action can fail under transient conditions (network,
        // rate limit). Don't let it crash the realtime loop — the next
        // event will retry. router.refresh() below is still useful as a
        // best-effort fallback even if the action failed.
      }
      router.refresh();
    }, 800);
  }, [router]);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  // Poll fallback — only while there's active work. Routes through the
  // same throttle so poll + realtime can't double-refresh in the same tick.
  useEffect(() => {
    if (!hasActiveWork) return;
    const id = setInterval(() => schedule(), 2000);
    return () => clearInterval(id);
  }, [hasActiveWork, schedule]);

  useRealtimeChannel("bunker_candidates", schedule);
  useRealtimeChannel("collections", schedule);
  useRealtimeChannel("collection_runs", schedule);
  useRealtimeChannel("signals", schedule);

  return null;
}
