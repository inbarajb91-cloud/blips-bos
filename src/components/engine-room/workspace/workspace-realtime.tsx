"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

interface WorkspaceRealtimeProps {
  /**
   * The currently-open signal id. Used to filter realtime events:
   *   - signals row updates where id = currentSignalId (status flips
   *     during STOKER processing or terminal state)
   *   - signals INSERTs where parent_signal_id = currentSignalId
   *     (manifestation children appearing as STOKER fans out)
   *   - agent_outputs INSERTs/UPDATEs where signal_id = currentSignalId
   *     (the parent's STOKER row landing post-skill, or status flips
   *     from per-card actions)
   */
  signalId: string;
  /**
   * True while we expect imminent updates — currently scoped to
   * "signal in IN_STOKER status" since that's when STOKER is mid-
   * flight or its output is awaiting founder review. Drives a 2s
   * poll fallback (same belt-and-suspenders pattern as Bridge).
   */
  hasActiveWork: boolean;
}

/**
 * Silent client component that keeps the Signal Workspace live.
 *
 * Mirrors the Bridge realtime pattern (src/components/engine-room/
 * bridge-realtime.tsx) — Supabase Realtime as primary, 2s poll
 * fallback when something is in flight. Throttled at 800ms so an
 * Inngest-driven burst (parent flip + 1-3 child inserts + agent_
 * outputs writes, all within seconds) collapses into one smooth
 * router.refresh().
 *
 * Phase 9 polish — added when Inba reported STOKER finishing without
 * the workspace auto-refreshing. Without this, the user has to F5
 * to see the resonance card grid populate.
 *
 * Realtime channels subscribed:
 *   - signals: catches the parent flipping IN_STOKER → FANNED_OUT /
 *     STOKER_REFUSED, plus manifestation children appearing
 *   - agent_outputs: catches the parent's STOKER row landing + child
 *     status updates from approve/dismiss actions
 *
 * Note: `useRealtimeChannel` doesn't currently support row-level
 * filtering on the JS side (it subscribes to whole-table changes
 * scoped to the user's RLS). That's fine — we throttle aggressively
 * and the page-level fetch is already org-scoped.
 */
export function WorkspaceRealtime({
  signalId,
  hasActiveWork,
}: WorkspaceRealtimeProps) {
  void signalId; // reserved for future row-level filtering
  const router = useRouter();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (pendingRef.current) return;
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

  // Poll fallback — only while there's active STOKER work. Same throttle
  // dedupes poll + realtime hits in the same tick.
  useEffect(() => {
    if (!hasActiveWork) return;
    const id = setInterval(() => schedule(), 2000);
    return () => clearInterval(id);
  }, [hasActiveWork, schedule]);

  useRealtimeChannel("signals", schedule);
  useRealtimeChannel("agent_outputs", schedule);

  return null;
}
