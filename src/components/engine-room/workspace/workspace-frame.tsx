"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { signals, collections } from "@/db/schema";
import { AgentTabStrip } from "./agent-tab-strip";
import { ContextStrip } from "./context-strip";
import { OrcPanel } from "./orc-panel";
import { RENDERERS } from "./renderers/registry";
import { computeStageStates, pickInitialTab, type AgentKey } from "./types";
import type { SignalStatus } from "@/components/engine-room/stage-pips";
import {
  acquireSignalLock,
  renewSignalLock,
  releaseSignalLock,
  type LockStatus,
} from "@/lib/actions/signal-locks";

/**
 * WorkspaceFrame — Phase 7 signal workspace.
 *
 * Two-panel grid: canvas · ORC panel, with a horizontal context strip
 * riding above both. The canvas swaps per selected agent tab via the
 * renderer registry. Parent collection's decade color bleeds into
 * accent surfaces (tab underline, breathing dots, mini-collection
 * border) via the `t-{type}` class on the root.
 *
 * Architecture shift (Phase 7 post-walkthrough):
 *   Previously had a 3-column grid with a vertical LeftRail carrying
 *   collection context + lock + signal meta. That rail stole ~300px
 *   of viewport full-time for information the user glances at once.
 *   Replaced with a horizontal ContextStrip that defaults collapsed
 *   (~44px, surfacing the two things users reach for mid-session:
 *   collection identity + lock state) and expands on click. Net: more
 *   canvas width, less chrome noise, same info available.
 *
 * Responsibilities:
 *   - Host the 2-region layout (canvas + ORC) with the ContextStrip
 *     riding above as a full-width header row
 *   - Own active tab state → route to the right renderer
 *   - Own the signal lock lifecycle (acquire/renew/release + voluntary
 *     release via user-gate ref)
 *   - Resize handle between canvas and ORC panel, clamped 300-620px,
 *     persisted to localStorage so the user's preferred chat width
 *     survives reloads
 */

const STORAGE_KEY = "ws.railRight";
const LAST_SIGNAL_KEY = "ws.lastSignalShortcode";
const DEFAULT_RIGHT = 380;
const MIN_RIGHT = 300;
const MAX_RIGHT = 620;

export function WorkspaceFrame({
  signal,
  collection,
}: {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
}) {
  const states = useMemo(
    () => computeStageStates(signal.status as SignalStatus),
    [signal.status],
  );
  const [activeTab, setActiveTab] = useState<AgentKey>(() =>
    pickInitialTab(states),
  );

  // Re-home the active tab when the signal advances while the workspace
  // is mounted (e.g. STOKER completes, status changes). Keeps the UI in
  // sync with the pipeline's real state.
  useEffect(() => {
    setActiveTab(pickInitialTab(states));
  }, [states]);

  // Right-panel width — restore from localStorage, clamp, default 380.
  const [railRight, setRailRight] = useState<number>(DEFAULT_RIGHT);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= MIN_RIGHT && n <= MAX_RIGHT) {
          setRailRight(n);
        }
      }
    } catch {
      /* localStorage may be unavailable; use default */
    }
  }, []);

  // Remember the last-viewed signal so the Signal Workspace section tab
  // can return to it. Without this, clicking the section tab from another
  // section lands on an empty state — frustrating UX when the user had a
  // signal open seconds ago. Persists across sessions (localStorage, not
  // sessionStorage) so returning next day also resumes the last signal.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_SIGNAL_KEY, signal.shortcode);
    } catch {
      /* ignore */
    }
  }, [signal.shortcode]);

  // ─── Signal lock lifecycle (Phase 7E) ─────────────────────────────
  //
  // On mount: acquire the lock. Every 5 min: renew. On unmount + window
  // beforeunload: release. If we can't acquire (someone else holds a
  // fresh lock), we still render the workspace — just read-only, with
  // the OrcPanel input disabled and a lock chip in the ContextStrip
  // explaining who holds it.
  //
  // Voluntary release (Phase 7 post-feedback):
  //   The ContextStrip exposes a [Release] button in its lock row
  //   (visible in both collapsed and expanded states). When the user
  //   clicks it, we flip `userReleasedRef` so:
  //     - the 5-min renew skips (doesn't silently re-acquire)
  //     - unmount + beforeunload skip the auto-release (nothing to release)
  //   Re-acquire via the [Lock] button clears the flag and starts the
  //   lifecycle again.
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
  const userReleasedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Initial acquire
    acquireSignalLock(signal.id)
      .then((status) => {
        if (!cancelled) setLockStatus(status);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          console.error("Failed to acquire signal lock:", e);
          // Fail-soft: assume not-held so UI falls back to read-only
          setLockStatus({
            heldByMe: false,
            lockedByAuthId: null,
            lockedByEmail: null,
            expiresAt: null,
          });
        }
      });

    // Renew every 5 minutes so the lock doesn't expire on an active tab.
    // Skip when the user has voluntarily released — otherwise we'd
    // silently steal the lock back every 5 min and defeat the toggle.
    const renewInterval = setInterval(
      () => {
        if (userReleasedRef.current) return;
        renewSignalLock(signal.id)
          .then((status) => {
            if (!cancelled) setLockStatus(status);
          })
          .catch((e: Error) => {
            console.error("Failed to renew signal lock:", e);
          });
      },
      5 * 60 * 1000,
    );

    // Best-effort release on window close. beforeunload can't wait for
    // async, so this is fire-and-forget; the lock's 30-min expiry covers
    // the case where release doesn't complete before tab close.
    const handleBeforeUnload = () => {
      if (userReleasedRef.current) return;
      releaseSignalLock(signal.id).catch(() => {
        /* ignore — expiry will clean up */
      });
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      cancelled = true;
      clearInterval(renewInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Explicit release on navigation away within the app — but only
      // if we still hold it. If user voluntarily released earlier, the
      // row is already gone; no need to call again.
      if (!userReleasedRef.current) {
        releaseSignalLock(signal.id).catch(() => {
          /* ignore */
        });
      }
    };
  }, [signal.id]);

  // Handlers for the ContextStrip lock toggle.
  async function handleReleaseLock() {
    try {
      await releaseSignalLock(signal.id);
      userReleasedRef.current = true;
      // Reflect "no lock" immediately — OrcPanel will disable send,
      // ContextStrip will swap to the [Lock] button.
      setLockStatus({
        heldByMe: false,
        lockedByAuthId: null,
        lockedByEmail: null,
        expiresAt: null,
      });
    } catch (e) {
      console.error("Failed to release signal lock:", e);
    }
  }

  async function handleAcquireLock() {
    try {
      const status = await acquireSignalLock(signal.id);
      userReleasedRef.current = false;
      setLockStatus(status);
    } catch (e) {
      console.error("Failed to re-acquire signal lock:", e);
    }
  }

  // Resize handle drag
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizingRef.current) return;
      const delta = startXRef.current - e.clientX; // drag LEFT widens panel
      const next = Math.max(
        MIN_RIGHT,
        Math.min(MAX_RIGHT, startWidthRef.current + delta),
      );
      setRailRight(next);
    }
    function onMouseUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(STORAGE_KEY, String(railRightLatest.current));
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Track latest railRight for the mouseup persist handler (closure otherwise
  // captures the initial value).
  const railRightLatest = useRef(railRight);
  useEffect(() => {
    railRightLatest.current = railRight;
  }, [railRight]);

  function startResize(e: React.MouseEvent) {
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = railRight;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  function resetRailRight() {
    setRailRight(DEFAULT_RIGHT);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  const Renderer = RENDERERS[activeTab];
  const typeClass = collection ? `t-${collection.type}` : "";

  // Layout model: document-scroll, not internal-scroll.
  //
  // Previous attempt used h-full + overflow-y-auto on the canvas cell,
  // which meant the canvas scrolled internally while rails stayed fixed
  // — but the UX felt trapped (can't scroll from outside the canvas,
  // short viewport made the canvas region tiny). Switched to letting
  // the whole workspace flow naturally and scroll as a document in the
  // engine-room layout's existing overflow container.
  //
  // Order from top:
  //   1. Signal identity header (shortcode + working title, hero weight)
  //   2. ContextStrip (collapsed row riding above tab strip; expands on
  //      click to reveal collection mini-card + concept + signal meta)
  //   3. AgentTabStrip (sticky — stays visible as user scrolls canvas)
  //   4. Two-column grid: canvas + ORC panel
  //
  // The canvas + ORC row uses `align-self: start` so panels don't
  // stretch vertically to match each other; natural content height
  // everywhere. The resize handle stretches to row height (the max of
  // its siblings) so drag is grabbable along either cell's full extent.
  return (
    <div className={`${typeClass} flex flex-col bg-ink`}>
      {/* Header — identity only: shortcode + working title. */}
      <section className="px-11 pt-5 pb-6">
        <div className="flex items-baseline gap-8">
          <span className="font-display font-bold text-[13px] tracking-[0.16em] text-t1">
            {signal.shortcode}
          </span>
          <h1 className="font-display font-medium text-[40px] -tracking-[0.012em] leading-[1.05] text-t1">
            {signal.workingTitle}
          </h1>
        </div>
      </section>

      {/* Context strip — horizontal, collapsed by default. Shows
          collection identity + lock state in the collapsed row; full
          context (mini-card, concept pull-quote, meta grid, read-only
          banner) via the expand chevron. Replaces the old vertical
          LeftRail. */}
      <ContextStrip
        signal={signal}
        collection={collection}
        lockStatus={lockStatus}
        onReleaseLock={handleReleaseLock}
        onAcquireLock={handleAcquireLock}
      />

      {/* Tab strip — sticky to top of the scroll container (engine-room
          layout's overflow-auto). As the user scrolls through stage
          content, the strip stays visible so tab navigation remains
          reachable without scrolling back up. Sticky within the
          document-scroll model; no internal-scroll nesting. */}
      <div
        className="sticky top-0 z-10 bg-ink border-b border-rule-1 px-11"
      >
        <AgentTabStrip
          states={states}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* Two-region grid — canvas + ORC panel. Natural height, flows
          with document. Panels use align-self: start so they don't
          stretch to match each other. The resize handle stretches
          (default behavior) so it's grabbable along the canvas's full
          vertical extent. */}
      <div
        className="grid transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: `1fr 6px ${railRight}px`,
        }}
      >
        {/* Canvas — natural content height. Flows with document scroll.
            min-w-0 prevents text/grid overflow pushing the canvas cell
            wider than its grid track. */}
        <main
          id="workspace-canvas"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="min-w-0"
        >
          <div className="max-w-[880px] w-full px-12 py-10">
            <Renderer
              signal={signal}
              collection={collection}
              state={states[activeTab]}
            />
          </div>
        </main>

        {/* Resize handle — drag to widen/narrow the ORC panel. Double-click
            to reset to default width. Visual grip lights up in the parent
            collection's decade color on hover/drag via the `group`
            hover-state pattern (no styled-jsx). */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize ORC panel"
          className="cursor-col-resize relative border-l border-rule-1 hover:border-[rgba(var(--d),0.45)] group transition-colors"
          onMouseDown={startResize}
          onDoubleClick={resetRailRight}
        >
          <div
            aria-hidden
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[1px] transition-all bg-rule-2 group-hover:bg-[rgba(var(--d),0.9)] group-active:bg-[rgba(var(--d),1)] group-hover:shadow-[0_0_8px_rgba(var(--d),0.4)]"
            style={{
              width: 2,
              height: 40,
            }}
          />
        </div>

        {/* Right panel — ORC conversation. align-self: start so it's its
            natural content height and doesn't stretch to match the
            canvas. Flows with document scroll. Long conversations just
            grow the panel; no internal scroll to trap the user. */}
        <aside
          className="border-l border-rule-1 bg-wash-1 flex flex-col self-start"
          aria-label="ORC conversation"
        >
          <OrcPanel
            signal={signal}
            activeStage={activeTab}
            lockStatus={lockStatus}
          />
        </aside>
      </div>
    </div>
  );
}
