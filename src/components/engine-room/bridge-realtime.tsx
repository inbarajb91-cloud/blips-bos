"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

interface BridgeRealtimeProps {
  /**
   * Server-side signal that at least one collection is queued or running.
   * When true, we additionally poll every 10s as a belt-and-suspenders
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
 *     fix) so RLS-scoped events actually reach the browser. Throttled
 *     at 800ms so a burst of events collapses into one smooth refresh.
 *
 * (2) **Interval poll (10s)** — fallback, only while `hasActiveWork` is
 *     true. Guarantees the UI moves even if Realtime has a bad minute.
 *
 *     Why 10s and not 2s (the original value): the Bridge route renders
 *     via Drizzle against the Supabase Singapore pooler — RSC fetch
 *     end-to-end takes ~2.5–3s under load. With a 2s poll, each new
 *     `router.refresh()` cancels the previous in-flight fetch (Next.js
 *     dedupes by URL via AbortController), so NO refresh ever completes
 *     and the DOM never updates. Vercel runtime logs show this as a
 *     cascade of `GET /engine-room` requests with status `-` (cancelled).
 *
 *     10s gives the fetch ample time to complete before the next poll
 *     fires. Realtime events still fire `schedule()` immediately on
 *     arrival, so the poll is purely a safety net for events Realtime
 *     misses — never the primary update path.
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
  // 10s interval prevents in-flight RSC fetches from being cancelled by
  // subsequent refresh calls (Drizzle queries to Singapore pooler average
  // 2.5–3s; a 2s poll caused every fetch to abort the previous).
  useEffect(() => {
    if (!hasActiveWork) return;
    const id = setInterval(() => schedule(), 10_000);
    return () => clearInterval(id);
  }, [hasActiveWork, schedule]);

  useRealtimeChannel("bunker_candidates", schedule);
  useRealtimeChannel("collections", schedule);
  useRealtimeChannel("collection_runs", schedule);
  useRealtimeChannel("signals", schedule);

  return null;
}
