"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

interface BridgeRealtimeProps {
  /**
   * Server-side signal that at least one collection is queued or running.
   * When true, we additionally poll every 3s as a belt-and-suspenders
   * fallback against Realtime quirks (cold subscribe race, token drift,
   * RLS mis-fire). When false, Realtime alone handles the occasional
   * create / archive event.
   */
  hasActiveWork: boolean;
}

/**
 * Silent client component that keeps Bridge live.
 *
 * History (May 13, 2026, after 3 days stuck on this):
 *
 *   We tried four progressively-sophisticated refresh strategies after
 *   migrating to the new Supabase + Vercel infra (May 9):
 *
 *   1. `router.refresh()`              — silently dedup'd by Next.js 16
 *      for rapid same-URL calls during sustained-event scenarios.
 *      Worked on the OLD setup, doesn't work post-migration.
 *   2. `router.replace(pathname)`      — same-URL no-op, also dropped.
 *   3. `router.replace(?_rt=<ts>)`     — works for ONE event, then the
 *      route navigation re-evaluates JS state, killing realtime
 *      subscriptions, so subsequent events arrive on torn-down channels.
 *   4. Server action + `revalidatePath`+ `router.refresh()` — works for
 *      the FIRST event after page load, then UPDATEs (collection
 *      status flips) stop propagating even though events reach the
 *      client (verified via parallel observer subscription).
 *
 *   What we know works without fail: a full page navigation always
 *   returns fresh DB state. That's because navigation forces Next.js to
 *   re-execute the Server Component end-to-end without any client cache
 *   in the path.
 *
 *   We're shipping the bulletproof variant: `window.location.reload()`
 *   on realtime events, rate-limited to once per 2.5 seconds so that
 *   a burst of events (BUNKER firing 5 inserts in 20 seconds, plus
 *   collection_runs UPDATEs, plus collection status UPDATE) collapses
 *   to at most one reload every 2.5s.
 *
 *   Trade-offs:
 *   - User loses scroll position on each reload — Bridge users are
 *     usually watching cards near the top, low impact.
 *   - Open dialogs / form state get reset — Bridge doesn't have
 *     persistent inline forms outside the Collect Now modal.
 *   - Realtime observer state (this component's refs) gets reset —
 *     fine, subscriptions re-establish on mount.
 *
 *   When we eventually move to TanStack Query for Bridge data, this
 *   gets replaced by a `queryClient.invalidateQueries()` call that
 *   refetches just the affected query (no nav, no reload).
 */

// Quiet-window after a fresh page load before any auto-reload may fire.
// Without this gate, the active-work poll fires schedule() ~3s after
// every page load, the rate-limit window has elapsed, and the page
// reloads immediately — producing an infinite reload loop on Bridge
// while any collection is queued/running.
const POST_LOAD_QUIET_MS = 8000;
// Minimum gap between hard reloads on top of the post-load window.
// Coalesces a burst of realtime events into a single reload.
const RELOAD_MIN_INTERVAL_MS = 2500;

export function BridgeRealtime({ hasActiveWork }: BridgeRealtimeProps) {
  const mountTimeRef = useRef<number>(Date.now());
  const lastReloadRef = useRef<number>(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (pendingRef.current) return; // already queued; drop this event
    const now = Date.now();
    const sinceMount = now - mountTimeRef.current;
    const sinceReload = now - lastReloadRef.current;
    // Two gates compose: a fresh-load quiet window (so the active-work
    // poll can't reload us into oblivion after every reload), and a
    // rate-limit window between reloads.
    const quietDelay = Math.max(0, POST_LOAD_QUIET_MS - sinceMount);
    const rateDelay = Math.max(0, RELOAD_MIN_INTERVAL_MS - sinceReload);
    const delay = Math.max(quietDelay, rateDelay);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      lastReloadRef.current = Date.now();
      // `replace()` instead of `reload()` so the browser doesn't append
      // to history. Functionally identical to F5 / Cmd-R.
      window.location.replace(window.location.href);
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  // Poll fallback — only while there's active work. Realtime sometimes
  // takes 30+ seconds to deliver an event on this Supabase project;
  // polling catches anything Realtime misses. The POST_LOAD_QUIET_MS
  // gate above prevents the poll from triggering a reload loop on
  // fresh page load.
  useEffect(() => {
    if (!hasActiveWork) return;
    const id = setInterval(() => schedule(), 3000);
    return () => clearInterval(id);
  }, [hasActiveWork, schedule]);

  useRealtimeChannel("bunker_candidates", schedule);
  useRealtimeChannel("collections", schedule);
  useRealtimeChannel("collection_runs", schedule);
  useRealtimeChannel("signals", schedule);

  return null;
}
