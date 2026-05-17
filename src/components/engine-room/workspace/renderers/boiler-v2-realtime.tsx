"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

/**
 * BoilerV2Realtime — Phase 11D.4e.
 *
 * Silent companion that keeps the BoilerV2 renderer live: subscribes to
 * Postgres changes on `design_versions`, `boiler_state`, `mockup_renders`
 * and invalidates the `["boiler-v2-state", signalId]` TanStack Query
 * whenever any of those tables change. The dispatcher's useQuery
 * refetches `loadBoilerV2State`, the renderer re-renders with fresh
 * data — version strip grows, palette updates, mockup renders appear.
 *
 * Without this, the founder fires `boiler_v2_generate`, the Inngest
 * handler writes a `design_versions` row 15–60s later, and the workspace
 * sits on empty state until the user hard-refreshes. Mirrors the existing
 * `WorkspaceRealtime` pattern but with a TanStack Query invalidation
 * target (the v2 renderer state lives in client cache, not in the
 * server-rendered tree).
 *
 * Plus a poll fallback: while we know a generation is in flight (caller
 * passes `pendingGeneration=true`), we re-fetch every 6s. This belt-and-
 * suspenders the realtime channel against subscription-establish-vs-event-
 * fire races on the very first generation — the most user-visible miss.
 *
 * `useRealtimeChannel` subscribes to whole-table changes; the callback
 * fires on every row anywhere. We don't filter by signalId because the
 * subscription doesn't support it (would need a server-side trigger or
 * a manual JS filter on the payload). The throttled invalidate is cheap
 * enough that other signals' writes triggering a refetch here is fine.
 */
interface BoilerV2RealtimeProps {
  /** The manifestation child id (= what loadBoilerV2State is keyed by). */
  signalId: string;
  /**
   * True when a Generate / Refine / Branch / Finalize event has been
   * fired and the founder is waiting for the design to land. Drives the
   * 6s poll fallback so first-time generations don't miss the channel.
   */
  pendingGeneration: boolean;
}

export function BoilerV2Realtime({
  signalId,
  pendingGeneration,
}: BoilerV2RealtimeProps) {
  const queryClient = useQueryClient();
  const pendingThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Throttled invalidate — collapses an Inngest-driven burst (single
  // version write + multiple mockup_render rows for {front × N colorways})
  // into one refetch instead of N.
  const invalidate = useCallback(() => {
    if (pendingThrottleRef.current) return;
    pendingThrottleRef.current = setTimeout(() => {
      pendingThrottleRef.current = null;
      void queryClient.invalidateQueries({
        queryKey: ["boiler-v2-state", signalId],
      });
    }, 600);
  }, [queryClient, signalId]);

  useEffect(() => {
    return () => {
      if (pendingThrottleRef.current) clearTimeout(pendingThrottleRef.current);
    };
  }, []);

  // Three subscriptions — one per table whose mutations the renderer cares
  // about. Each fires the same throttled invalidate.
  useRealtimeChannel("design_versions", invalidate);
  useRealtimeChannel("boiler_state", invalidate);
  useRealtimeChannel("mockup_renders", invalidate);

  // Poll fallback while a generation is in flight. 6s strikes a balance
  // between picking up the row quickly (low tier ETA is 15-25s) and not
  // hammering the DB if the user leaves the tab open after generation.
  // Skipped when no generation is pending so idle workspaces are silent.
  useEffect(() => {
    if (!pendingGeneration) return;
    const id = setInterval(() => invalidate(), 6_000);
    return () => clearInterval(id);
  }, [pendingGeneration, invalidate]);

  return null;
}
