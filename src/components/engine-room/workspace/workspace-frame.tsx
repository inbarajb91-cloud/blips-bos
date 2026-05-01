"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { signals, collections } from "@/db/schema";
import { AgentTabStrip } from "./agent-tab-strip";
import { ContextStrip } from "./context-strip";
import { OrcPanel } from "./orc-panel";
import {
  ManifestationSelector,
  POST_STOKER_VISIBLE,
  type DecadeKey,
} from "./manifestation-selector";
import { POST_STOKER_STAGES, RENDERERS } from "./renderers/registry";
import type { ParentStokerData } from "./renderers/stoker-resonance";
import type {
  ParentReference,
  ManifestationOwnDetail,
  ManifestationSummary,
} from "./renderers/types";
import { WorkspaceRealtime } from "./workspace-realtime";
import { computeStageStates, pickInitialTab, type AgentKey } from "./types";
import type { SignalStatus } from "@/components/engine-room/stage-pips";
import {
  acquireSignalLock,
  renewSignalLock,
  releaseSignalLock,
  type LockStatus,
} from "@/lib/actions/signal-locks";

const VALID_DECADES: ReadonlySet<DecadeKey> = new Set(["RCK", "RCL", "RCD"]);

function readDecadeFromUrl(): DecadeKey | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("m");
  if (param && VALID_DECADES.has(param as DecadeKey)) {
    return param as DecadeKey;
  }
  return null;
}

function writeDecadeToUrl(decade: DecadeKey | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (decade) {
    url.searchParams.set("m", decade);
  } else {
    url.searchParams.delete("m");
  }
  // replaceState (not pushState) — manifestation switching shouldn't
  // pollute the back-button history. The user's mental model is
  // "I'm on this signal's workspace and toggling between its
  // manifestations", not "I navigated to a new page."
  window.history.replaceState(window.history.state, "", url);
}

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

// Phase 7.5 — ORC panel pinned to the LEFT side of the workspace.
// Previous Phase 7 layout placed ORC on the right, which (a) wasted the
// thin empty column on the left edge and (b) visually suggested ORC
// was somehow tab-scoped because it sat alongside the tab content.
// Pinning ORC left makes the architectural truth obvious — ORC is a
// signal-scoped constant, the tab strip controls only the canvas.
//
// Storage key changed from `ws.railRight` so users on the old layout
// don't inherit a size that doesn't fit the new orientation. Any saved
// "I want ORC at 540px" preference resets to the new default 380.
const STORAGE_KEY = "ws.orcLeft";
const LAST_SIGNAL_KEY = "ws.lastSignalShortcode";
const DEFAULT_PANEL = 380;
const MIN_PANEL = 300;
const MAX_PANEL = 620;

// Phase 9.5 — ORC defaults COLLAPSED. The walkthrough surfaced that
// users open the workspace to look at the canvas first; ORC is a
// thinking partner you reach for, not a default surface. Collapsing
// gives the canvas the full viewport on first paint, with a thin
// rail (RAIL_WIDTH px) on the left as the persistent reopen affordance.
//
// Open/closed state lives in its own storage key so it's independent
// of the panel-width preference — a user who likes ORC at 540px when
// they open it doesn't lose that preference just because they kept
// it collapsed last session. Storage key versioned `-v2` so existing
// users get the new default-collapsed behaviour on first reload after
// the Phase 9.5 deploy (the absence of the new key triggers the
// default-false codepath, regardless of any stale `-v1` value).
const ORC_OPEN_KEY = "ws.orcOpen-v2";
const RAIL_WIDTH = 36;

export function WorkspaceFrame({
  signal,
  collection,
  stokerData,
  parentRef,
  manifestationDetail,
  manifestations,
}: {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
  /** Phase 9D — STOKER tab data fetched server-side. Null pre-STOKER. */
  stokerData: ParentStokerData | null;
  /** Phase 9F — set when signal is a manifestation child. */
  parentRef: ParentReference | null;
  /** Phase 9F — manifestation's own STOKER agent_outputs detail. */
  manifestationDetail: ManifestationOwnDetail | null;
  /** Phase 9.5 — full manifestation children for this parent, fetched
   *  once server-side so the canvas can swap between them without
   *  another network round-trip. Empty on pre-STOKER and on
   *  manifestation children themselves (they redirect to the parent). */
  manifestations: ManifestationSummary[];
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

  // Left-panel width (ORC pinned left as of Phase 7.5) — restore from
  // localStorage, clamp, default 380. Users who customise this width
  // are usually doing so for chat readability, not canvas dominance,
  // so the same 300-620 range carries over from the right-side era.
  const [panelWidth, setPanelWidth] = useState<number>(DEFAULT_PANEL);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= MIN_PANEL && n <= MAX_PANEL) {
          setPanelWidth(n);
        }
      }
    } catch {
      /* localStorage may be unavailable; use default */
    }
  }, []);

  // ORC open/closed (Phase 9.5) — defaults to false. Users who
  // explicitly opened it last session restore to open; first-time
  // users and anyone who left it closed get the canvas-first layout.
  // Persist on every toggle so the preference survives reloads.
  //
  // SSR-safety pattern (matches panelWidth above): initial state is
  // the default (false) for both server and client first render, so
  // hydration matches; the effect runs post-hydration to upgrade if
  // the user previously chose open. The set-state-in-effect rule is
  // suppressed because this IS the correct shape for browser-only
  // state in a server-rendered client component.
  const [isOrcOpen, setIsOrcOpen] = useState<boolean>(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORC_OPEN_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw === "true") setIsOrcOpen(true);
    } catch {
      /* localStorage may be unavailable; keep default */
    }
  }, []);

  function toggleOrc() {
    setIsOrcOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ORC_OPEN_KEY, next ? "true" : "false");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // ─── Active manifestation (Phase 9.5) ────────────────────────────
  //
  // The post-STOKER stages (FURNACE, BOILER, ENGINE, PROPELLER) all
  // operate on a single manifestation child, not on the parent. The
  // user picks WHICH child via the ManifestationSelector dropdown,
  // and that selection persists across tab switches (you don't lose
  // your "I'm working on RCD" focus when you click BOILER → ENGINE).
  //
  // Initial value: read `?m=DECADE` from the URL. If present and
  // valid (RCK / RCL / RCD), use it. Otherwise fall back to the
  // first non-dismissed manifestation, or null if there are none.
  // The fallback is computed inline from the manifestations prop, so
  // re-renders track the latest server data.
  //
  // On change: write the new decade to URL (?m=DECADE) via
  // replaceState — switching manifestations shouldn't add a back-button
  // entry. Keeps reload-resilience: refresh the page, you land on the
  // same manifestation. Also lets users share URLs that pre-select
  // a manifestation (e.g., a Linear ticket links to ?m=RCD).
  // Visible = manifestations that have moved past STOKER. Pending
  // (IN_STOKER) and dismissed (DISMISSED) are filtered out at this
  // level so the selector and post-STOKER renderers all share the
  // same definition of "actionable manifestation". A pending child
  // belongs on the parent's STOKER tab (per-card review queue), not
  // in the FURNACE/BOILER/ENGINE dropdown — there's nothing for
  // those tabs' renderers to render on a child that hasn't been
  // approved yet. Founder feedback Apr 30 — surfacing pending in
  // the dropdown caused confusion ("I only approved 1 but the
  // dropdown shows 2").
  const visibleManifestations = useMemo(
    () => manifestations.filter((m) => POST_STOKER_VISIBLE.has(m.status)),
    [manifestations],
  );

  const [activeDecade, setActiveDecade] = useState<DecadeKey | null>(null);

  // Resolve initial activeDecade once the visible list is known. The
  // null initial state is a single-frame transient — this useEffect
  // fires synchronously on first commit and resolves to URL or
  // first-visible.
  //
  // CR pass on PR #10 (round 2): keep the URL `?m=` in sync with
  // state on every transition. Previously, when the chosen decade
  // disappeared (manifestation dismissed, status flipped past
  // POST_STOKER_VISIBLE, etc.), state fell back to first-visible
  // but the URL kept the stale decade. Reload would then bounce
  // back to the dismissed decade, fall back again, and so on. Now
  // we explicitly clear or replace the URL when the source-of-truth
  // (server data) no longer matches what the URL claims.
  //
  // The set-state-in-effect rule is suppressed on the first
  // setActiveDecade call — initial resolution from URL+server-data
  // is genuinely client-only state that has to upgrade post-hydration.
  useEffect(() => {
    const fromUrl = readDecadeFromUrl();

    if (visibleManifestations.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveDecade(null);
      // Clear stale ?m= so the URL reflects the empty state.
      if (fromUrl) writeDecadeToUrl(null);
      return;
    }
    if (fromUrl && visibleManifestations.some((m) => m.decade === fromUrl)) {
      setActiveDecade(fromUrl);
      return;
    }
    // Fall back to first visible. If the URL had a stale decade,
    // replace it with the fallback so reload-resilience holds. If
    // the URL was clean (no ?m=), leave it clean — first-visible is
    // the implicit default, no need to clutter the URL.
    const fallback = visibleManifestations[0].decade;
    setActiveDecade(fallback);
    if (fromUrl && fromUrl !== fallback) writeDecadeToUrl(fallback);
    // Run this resolution whenever visible manifestations change
    // (e.g., a dismissal lands and the previously-active decade is
    // no longer visible). visibleManifestations is itself memo'd
    // off manifestations, so this only runs when server data shifts.
  }, [visibleManifestations]);

  function selectManifestation(decade: DecadeKey) {
    setActiveDecade(decade);
    writeDecadeToUrl(decade);
  }

  /**
   * Phase 9.5 polish — atomic "switch to this manifestation on this
   * stage" handler. Used by the STOKER renderer's approved-card
   * top-right arrow + the FanOutPreview pills, both of which need to
   * advance the workspace from "STOKER's 3-card grid" to "FURNACE on
   * the chosen manifestation" in one click. Wraps both state flips
   * (activeTab + activeDecade) so renderers don't have to know the
   * shape of workspace state — they just say "open RCL in FURNACE"
   * and we route accordingly.
   */
  function switchToManifestation(decade: DecadeKey, stage: AgentKey) {
    setActiveTab(stage);
    selectManifestation(decade);
  }

  // Active manifestation object — the one the post-STOKER renderers
  // operate on. Null when:
  //   - parent has no manifestations yet (pre-STOKER)
  //   - all manifestations are dismissed (visibleManifestations.length=0)
  //   - the active decade isn't in the visible list (transient, between
  //     a dismiss and the resolution useEffect catching up)
  // The fallback to first-visible covers the third case so renderers
  // see a stable activeManifestation as long as visible.length > 0.
  const activeManifestation = useMemo<ManifestationSummary | null>(() => {
    if (visibleManifestations.length === 0) return null;
    return (
      visibleManifestations.find((m) => m.decade === activeDecade) ??
      visibleManifestations[0]
    );
  }, [visibleManifestations, activeDecade]);

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
      // Phase 7.5 — ORC is on the LEFT now, so dragging the resize
      // handle RIGHT widens the panel. (Inverse of the Phase 7
      // direction, where the panel sat on the right and dragging
      // LEFT widened it.)
      const delta = e.clientX - startXRef.current;
      const next = Math.max(
        MIN_PANEL,
        Math.min(MAX_PANEL, startWidthRef.current + delta),
      );
      setPanelWidth(next);
    }
    function onMouseUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(STORAGE_KEY, String(panelWidthLatest.current));
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

  // Track latest panelWidth for the mouseup persist handler (closure
  // otherwise captures the initial value).
  const panelWidthLatest = useRef(panelWidth);
  useEffect(() => {
    panelWidthLatest.current = panelWidth;
  }, [panelWidth]);

  function startResize(e: React.MouseEvent) {
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  }

  function resetPanelWidth() {
    setPanelWidth(DEFAULT_PANEL);
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
  // Order from top (Phase 9.5 — title section absorbed into the strip):
  //   1. ContextStrip — unified header. Collapsed row carries shortcode
  //      + working title + lock + chevron. Expands to reveal collection
  //      mini-card, concept pull-quote, signal meta, read-only banner.
  //   2. AgentTabStrip (sticky — stays visible as user scrolls canvas)
  //   3. Two-column grid: ORC panel + canvas
  //
  // The canvas + ORC row uses `align-self: start` so panels don't
  // stretch vertically to match each other; natural content height
  // everywhere. The resize handle stretches to row height (the max of
  // its siblings) so drag is grabbable along either cell's full extent.
  // Phase 9 polish — drive auto-refresh while STOKER is mid-flight or
  // its output is awaiting per-card founder review. Active = signal at
  // IN_STOKER (BUNKER-just-approved parent running through STOKER, OR
  // a manifestation child awaiting its per-card founder gate). The
  // realtime listener catches the parent-side fan-out + per-card
  // approve/dismiss transitions; the 2s poll fallback is the belt-
  // and-suspenders for Realtime channel hiccups.
  const hasActiveWork = signal.status === "IN_STOKER";

  return (
    <div className={`${typeClass} flex flex-col bg-ink`}>
      <WorkspaceRealtime signalId={signal.id} hasActiveWork={hasActiveWork} />
      {/* Unified header strip — Phase 9.5.
          The shortcode + working title that used to live in their own
          `pl-7 pr-11 pt-5 pb-6` <section> above this strip have been
          merged into the strip's collapsed row. Collection identity
          (name + type + counts) moved to the expanded body. Result:
          one strip at the top of the workspace instead of two, less
          vertical chrome, more canvas above the fold. */}
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
          document-scroll model; no internal-scroll nesting.

          Phase 9.5 — manifestation selector lives in its own thin
          sub-row directly below the tab strip, conditional on a
          post-STOKER tab AND the parent having at least one
          non-dismissed manifestation child. Both rows share the same
          sticky container so they travel together as the canvas
          scrolls. Putting the selector on its own row (rather than
          inline next to the tab strip) preserves the AgentTabStrip's
          full-bleed `-mx-11` border treatment without surgery, and
          gives the selector pill enough breathing room on the right
          edge that it reads as the row's intentional anchor.
          BUNKER/STOKER tabs skip the selector row entirely — those
          stages render parent-side data, no manifestation to switch. */}
      <div className="sticky top-0 z-10 bg-ink">
        <div className="border-b border-rule-1 px-11">
          <AgentTabStrip
            states={states}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
        {POST_STOKER_STAGES.has(activeTab) &&
          visibleManifestations.length > 0 && (
            <div className="border-b border-rule-1 bg-wash-1 px-11 py-2.5 flex justify-end items-center gap-3">
              <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5">
                Manifestation
              </span>
              <ManifestationSelector
                manifestations={manifestations}
                active={activeDecade}
                onSelect={selectManifestation}
              />
            </div>
          )}
      </div>

      {/* Two-region grid — ORC panel + canvas. ORC pinned LEFT
          (Phase 7.5 flip from Phase 7's right-side placement). Natural
          height, flows with document. Panels use align-self: start so
          they don't stretch to match each other. The resize handle
          stretches so it's grabbable along the row's full extent.

          Order in DOM: ORC first, then resize handle, then canvas —
          which also sets the natural keyboard tab order (ORC input
          before canvas content), matching the visual reading order
          on LTR.

          Phase 9.5 — collapsed-state layout:
            When ORC is closed (default), the first column shrinks to
            RAIL_WIDTH (36px) and the resize handle hides (0px column).
            Canvas takes ~all of the row. The panel itself swaps to a
            rail layout (vertical "ORC" label + breathing dot + expand
            button), preserving its presence without consuming canvas. */}
      <div
        className="grid transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: isOrcOpen
            ? `${panelWidth}px 6px 1fr`
            : `${RAIL_WIDTH}px 0px 1fr`,
        }}
      >
        {/* Left panel — ORC conversation. Phase 9G fix (May 1):
            ORC panel has its own internal scroll axis so a long
            conversation doesn't drag the whole page. `sticky top-0`
            anchors the panel to the top of the scrolling container,
            `h-` (NOT max-h — see below) gives it a fixed viewport-
            relative height so the OrcPanel's `h-full` resolves
            correctly, and `overflow-hidden` clips overflow into the
            internal scroll axis. The chat thread inside OrcPanel
            uses flex-1 + overflow-y-auto + min-h-0 to scroll within
            this height. Head + input stay pinned top + bottom.
            Why `h-[calc(100dvh-140px)]` and not `max-h-`: the
            previous attempt used max-h, but `h-full` on a child
            requires an explicit `height` on its parent — max-height
            alone doesn't count, so h-full collapses to content
            height, the thread never gets constrained, and
            overflow-y-auto never engages. Switching to fixed h-
            with dvh (dynamic viewport height — accounts for mobile
            browser chrome) makes the chat-shell pattern work. The
            "extra space below input when chat is short" is the
            standard chat-app pattern (Slack / Discord / ChatGPT all
            do this) — input pinned at bottom of a fixed-height
            panel. */}
        <aside
          className="border-r border-rule-1 bg-wash-1 flex flex-col self-start sticky top-0 h-[calc(100dvh-140px)] overflow-hidden"
          aria-label="ORC conversation"
        >
          <OrcPanel
            signal={signal}
            activeStage={activeTab}
            lockStatus={lockStatus}
            isOpen={isOrcOpen}
            onToggle={toggleOrc}
          />
        </aside>

        {/* Resize handle — drag right to widen ORC panel, drag left to
            narrow it. Double-click resets to the default width. Visual
            grip lights up in the parent collection's decade color on
            hover/drag via the `group` hover-state pattern.

            When ORC is collapsed, the column has 0px width — the div
            still renders but is visually absent. pointer-events-none
            prevents stray hovers/clicks while collapsed. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize ORC panel"
          aria-hidden={!isOrcOpen}
          className={`relative border-r border-rule-1 group transition-colors ${
            isOrcOpen
              ? "cursor-col-resize hover:border-[rgba(var(--d),0.45)]"
              : "pointer-events-none overflow-hidden border-transparent"
          }`}
          onMouseDown={isOrcOpen ? startResize : undefined}
          onDoubleClick={isOrcOpen ? resetPanelWidth : undefined}
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

        {/* Canvas — natural content height. Flows with document scroll.
            min-w-0 prevents text/grid overflow pushing the canvas cell
            wider than its grid track. */}
        <main
          id="workspace-canvas"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          className="min-w-0"
        >
          {/* Canvas content fills the grid track — no max-width cap.
              Extraction cells, source metadata, and the Review timeline
              all benefit from breathing room; the content has its own
              internal max-widths where readability matters (paragraphs
              stay reasonable line-lengths via their own font-size +
              leading). */}
          <div className="w-full px-12 py-10">
            <Renderer
              signal={signal}
              collection={collection}
              state={states[activeTab]}
              stokerData={stokerData}
              parentRef={parentRef}
              manifestationDetail={manifestationDetail}
              manifestations={manifestations}
              activeManifestation={
                POST_STOKER_STAGES.has(activeTab) ? activeManifestation : null
              }
              onSwitchToManifestation={switchToManifestation}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
