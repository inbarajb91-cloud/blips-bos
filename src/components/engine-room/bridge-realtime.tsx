"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
