"use client";

import { useCallback, useEffect, useRef } from "react";
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
   * flight or its output is awaiting founder review. Drives a 3s
   * poll fallback (same belt-and-suspenders pattern as Bridge).
   */
  hasActiveWork: boolean;
}

/**
 * Silent client component that keeps the Signal Workspace live.
 *
 * Mirrors the Bridge realtime pattern — see `bridge-realtime.tsx` for
 * the full history of why we ended up at `window.location.replace()`
 * instead of `router.refresh()`. Short version: post-migration to the
 * new Supabase + Vercel infra, `router.refresh()` and its variants get
 * silently dedup'd by Next.js 16 during sustained-write scenarios
 * (STOKER flipping IN_STOKER → FANNED_OUT, FURNACE / BOILER stage
 * outputs landing, manifestation children appearing). The only
 * fully-reliable refresh is a full navigation, so that's what we do.
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

// Quiet window after page load before any auto-reload may fire (gates
// the active-work poll from causing an infinite reload loop). Same
// pattern as bridge-realtime.tsx — see that file for full rationale.
const POST_LOAD_QUIET_MS = 8000;
const RELOAD_MIN_INTERVAL_MS = 2500;

export function WorkspaceRealtime({
  signalId,
  hasActiveWork,
}: WorkspaceRealtimeProps) {
  void signalId; // reserved for future row-level filtering
  const mountTimeRef = useRef<number>(Date.now());
  const lastReloadRef = useRef<number>(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (pendingRef.current) return;
    const now = Date.now();
    const sinceMount = now - mountTimeRef.current;
    const sinceReload = now - lastReloadRef.current;
    const quietDelay = Math.max(0, POST_LOAD_QUIET_MS - sinceMount);
    const rateDelay = Math.max(0, RELOAD_MIN_INTERVAL_MS - sinceReload);
    const delay = Math.max(quietDelay, rateDelay);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      lastReloadRef.current = Date.now();
      window.location.replace(window.location.href);
    }, delay);
  }, []);

  useEffect(() => {
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasActiveWork) return;
    const id = setInterval(() => schedule(), 3000);
    return () => clearInterval(id);
  }, [hasActiveWork, schedule]);

  useRealtimeChannel("signals", schedule);
  useRealtimeChannel("agent_outputs", schedule);

  return null;
}
