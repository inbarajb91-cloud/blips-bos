"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  const pathname = usePathname();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (pendingRef.current) return; // already queued; drop this event
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      // Cache-bust navigation: Next.js 16 + React 19 treats same-URL
      // `router.refresh()` / `router.replace(pathname)` as a no-op during
      // sustained-event scenarios (Inngest BUNKER worker producing 5
      // candidates over 60s, with multiple status UPDATEs in between).
      // The dedup logic in the router silently drops repeated identical
      // refresh requests, so the client never receives the fresh RSC
      // payload — even though the server WOULD have rendered it freshly
      // (verified: a full-nav fetch returns the updated state).
      //
      // Fix: each scheduled refresh navigates to the same path but with
      // a unique `_rt=<timestamp>` query param. Different URL → real
      // navigation → fresh RSC fetch → DOM updates. The query param is
      // harmless (page query ignores it), and `scroll: false` keeps the
      // user's position. Reading the current URL preserves any other
      // legitimate search params the user has set.
      const url = new URL(window.location.href);
      url.searchParams.set("_rt", String(Date.now()));
      router.replace(url.pathname + url.search, { scroll: false });
    }, 800);
  }, [router, pathname]);
  void pathname; // kept in deps for future, currently unused in body

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
