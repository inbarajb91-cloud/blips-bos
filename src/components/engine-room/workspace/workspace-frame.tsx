"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { signals, collections } from "@/db/schema";
import { AgentTabStrip } from "./agent-tab-strip";
import { LeftRail } from "./left-rail";
import { OrcPanel } from "./orc-panel";
import { RENDERERS } from "./renderers/registry";
import { computeStageStates, pickInitialTab, type AgentKey } from "./types";
import type { SignalStatus } from "@/components/engine-room/stage-pips";

/**
 * WorkspaceFrame — Phase 7 signal workspace.
 *
 * Three-region grid: left rail · canvas · ORC panel. The canvas swaps
 * per selected agent tab via the renderer registry. Parent collection's
 * decade color bleeds into accent surfaces (tab underline, breathing
 * dots, mini-collection border) via the `t-{type}` class on the root.
 *
 * Responsibilities:
 *   - Host the 3-region layout (grid-template-columns CSS variables)
 *   - Own active tab state → route to the right renderer
 *   - Rail collapse toggle (wide-canvas reading mode)
 *   - Resize handle between canvas and ORC panel, clamped 300-620px,
 *     persisted to localStorage so the user's preferred chat width
 *     survives reloads
 *
 * Phase 7 does NOT yet:
 *   - Wire signal_locks (7E)
 *   - Wire agent_conversations persistence (7D inside OrcPanel)
 *   - Render real content for STOKER/FURNACE/etc. (future phases)
 */

const STORAGE_KEY = "ws.railRight";
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

  // Rail collapse state
  const [railCollapsed, setRailCollapsed] = useState(false);

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
  const railLeftWidth = railCollapsed ? 36 : 300;

  return (
    <div className={`${typeClass} flex flex-col h-full bg-ink`}>
      {/* Header region — back link, signal identity, tab strip */}
      <section className="px-11 pt-5 border-b border-rule-1">
        <div className="flex items-center justify-between mb-[18px]">
          <Link
            href="/engine-room"
            className="font-mono text-[10.5px] tracking-[0.22em] uppercase text-t3 hover:text-t1 transition-colors inline-flex items-center gap-[6px] rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          >
            <span style={{ color: "rgba(var(--d), 0.75)" }}>‹</span>
            Back to Bridge
          </Link>
          {/* Lock chip — Phase 7E wires the real lock; for now we show a
              demoted self-lock placeholder so the real estate is reserved
              and the visual doesn't shift when the lock lands. */}
          <div
            className="inline-flex items-center gap-[6px] text-t5 font-mono text-[10px] tracking-[0.18em] uppercase"
            title="Signal locks ship in Phase 7E"
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                border: "1.25px solid var(--color-t5)",
                borderRadius: "50%",
                position: "relative",
              }}
            />
            <span className="text-t4">lock · phase 7e</span>
          </div>
        </div>

        {/* Signal identity — shortcode, working title, collection name, concept */}
        <div className="grid grid-cols-[auto_1fr] gap-y-2 gap-x-8 items-baseline pb-6">
          <div className="font-display font-bold text-[13px] tracking-[0.16em] text-t1 pt-[14px]">
            {signal.shortcode}
          </div>
          <h1 className="font-display font-medium text-[40px] -tracking-[0.012em] leading-[1.1] text-t1">
            {signal.workingTitle}
          </h1>
          {collection && (
            <>
              <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5 whitespace-nowrap">
                From Collection
              </div>
              <div className="font-editorial italic text-[14px] text-t4 leading-[1.45]">
                {collection.name}
              </div>
            </>
          )}
          {signal.concept && (
            <>
              <div />
              <p className="font-editorial italic text-[18.5px] leading-[1.45] text-t3 max-w-[72ch] mt-1">
                &ldquo;{signal.concept}&rdquo;
              </p>
            </>
          )}
        </div>

        <AgentTabStrip
          states={states}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </section>

      {/* Three-region grid */}
      <div
        className="grid flex-1 min-h-0 transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: `${railLeftWidth}px 1fr 6px ${railRight}px`,
        }}
      >
        {/* Left rail — min-h-0 so the grid cell can shrink below content
            height and let overflow-y-auto on the inner content handle
            scrolling. Without min-h-0, the cell grows with content and
            the whole workspace locks up. */}
        <aside
          className="border-r border-rule-1 bg-wash-1 relative overflow-hidden min-h-0"
          aria-label="Collection context"
        >
          {/* Collapse toggle sits on the rail's right edge, always visible */}
          <button
            type="button"
            onClick={() => setRailCollapsed((v) => !v)}
            aria-label={railCollapsed ? "Expand rail" : "Collapse rail"}
            aria-expanded={!railCollapsed}
            className="absolute top-[30px] -right-3 w-6 h-6 rounded-full border border-rule-2 bg-ink flex items-center justify-center text-t3 text-[10px] z-[5] hover:text-t1 hover:border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          >
            <span
              style={{
                transition: "transform 0.3s",
                transform: railCollapsed ? "rotate(180deg)" : "none",
              }}
            >
              ‹
            </span>
          </button>

          {/* Collapsed-state tint strip on inner edge */}
          {railCollapsed && (
            <div
              aria-hidden
              className="absolute top-0 bottom-0 right-0"
              style={{
                width: 2,
                background: "rgba(var(--d), 0.45)",
              }}
            />
          )}

          <div
            className="h-full overflow-y-auto"
            style={{
              opacity: railCollapsed ? 0 : 1,
              pointerEvents: railCollapsed ? "none" : "auto",
              transition: "opacity 0.2s",
            }}
          >
            <LeftRail signal={signal} collection={collection} />
          </div>
        </aside>

        {/* Canvas — min-h-0 + overflow-y-auto so tall retrospective content
            scrolls within the canvas region while left rail / ORC panel
            stay fixed. Otherwise the grid cell grew to content height
            and the whole page couldn't scroll. */}
        <main
          id="workspace-canvas"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="overflow-y-auto min-h-0"
        >
          <div className="max-w-[880px] w-full px-12 py-10">
            <Renderer signal={signal} collection={collection} state={states[activeTab]} />
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

        {/* Right panel — ORC conversation. min-h-0 on the grid cell itself
            and on every descendant up to the thread div ensures the
            thread's overflow-y-auto actually scrolls instead of the
            panel growing to content height. */}
        <aside
          className="border-l border-rule-1 bg-wash-1 flex flex-col min-h-0 overflow-hidden"
          aria-label="ORC conversation"
        >
          <OrcPanel signal={signal} activeStage={activeTab} />
        </aside>
      </div>
    </div>
  );
}
