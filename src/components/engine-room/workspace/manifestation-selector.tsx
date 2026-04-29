"use client";

import { useEffect, useRef, useState } from "react";
import type { SignalStatus } from "@/components/engine-room/stage-pips";

/**
 * ManifestationSelector — Phase 9.5.
 *
 * Sits in the post-STOKER stage tabs (FURNACE / BOILER / ENGINE /
 * PROPELLER) when a parent signal has fanned out into 1-3 decade
 * manifestations. Lets the founder switch which manifestation the
 * canvas is rendering data for, without leaving the parent workspace.
 *
 * Three rendering modes driven by the visible (non-dismissed) count:
 *
 *   visible.length === 0 → returns null. Caller is responsible for
 *     showing an empty state ("all manifestations dismissed") and
 *     hiding post-STOKER tabs altogether. We don't render an empty
 *     selector to avoid a misleading interactive affordance.
 *
 *   visible.length === 1 → frozen pill. Decade tint, decade code,
 *     shortcode. No caret, no popover, not interactive (no need —
 *     there's nothing to switch to). Same dimensions as the
 *     interactive trigger so the layout doesn't jump when a user
 *     dismisses two manifestations.
 *
 *   visible.length >= 2 → dropdown. The trigger reads the active
 *     manifestation's decade tint; the popover lists all visible
 *     options (each with its own tint), with the active option
 *     marked. Click an option → onSelect → caller swaps the
 *     activeManifestation prop, popover closes, focus returns to
 *     trigger.
 *
 * Dismissed filtering: `status === "DISMISSED"` is the only excluded
 * state. Pre-STOKER and intermediate states (IN_STOKER waiting for
 * founder review, IN_FURNACE running through the next stage, etc.)
 * are all surfaced — the user reviews IN_STOKER cards on the parent's
 * STOKER tab grid, but might still want to peek at a card-in-flight's
 * data. Dismissal is the only "this manifestation is gone" terminal
 * state for a child signal in the current pipeline (Phase 9-11);
 * later phases may add more.
 *
 * Decade colors come from var(--d), scoped via the .t-rck/.t-rcl/.t-rcd
 * classes on the rendered elements. The same classes globals.css
 * already aliases to var(--d-batch / -instant / -scheduled) — so
 * Phase 9's polish work carries forward unchanged.
 */

export type DecadeKey = "RCK" | "RCL" | "RCD";

export type ManifestationOption = {
  decade: DecadeKey;
  shortcode: string;
  title: string;
  status: SignalStatus;
};

const DECADE_LABELS: Record<DecadeKey, string> = {
  RCK: "The Reckoning",
  RCL: "The Recalibration",
  RCD: "The Reckoned",
};

/** Returns the CSS class that activates the decade's tint for var(--d). */
export function decadeTintClass(decade: DecadeKey): string {
  return decade === "RCK" ? "t-rck" : decade === "RCL" ? "t-rcl" : "t-rcd";
}

/**
 * SignalStatus values that mean "this manifestation has moved past
 * STOKER and has post-STOKER work to render". Exported so other
 * surfaces (Bridge chip cluster) filter on the same set — keeping
 * the "what counts as advancing" definition in one place.
 *
 * Excluded: IN_STOKER (pending — still on the parent's STOKER tab
 * awaiting per-card review), DISMISSED, BUNKER_FAILED (children
 * never go through BUNKER, defensive guard), STOKER_REFUSED, and
 * the parent-only terminal states.
 */
export const POST_STOKER_VISIBLE: ReadonlySet<SignalStatus> = new Set([
  "IN_FURNACE",
  "IN_BOILER",
  "IN_ENGINE",
  "AT_PROPELLER",
  "DOCKED",
]);

export function ManifestationSelector({
  manifestations,
  active,
  onSelect,
}: {
  manifestations: ManifestationOption[];
  /** Active decade. May be null on first render before the caller
   *  has resolved its initial selection. We fall back to the first
   *  visible manifestation in that case so the trigger always has
   *  something to render. */
  active: DecadeKey | null;
  onSelect: (decade: DecadeKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Phase 9.5 polish — visible filter tightened. Original Phase 9.5
  // filter was "anything except DISMISSED", which leaked PENDING
  // (still IN_STOKER, awaiting parent-side per-card approval) into
  // the FURNACE / BOILER / ENGINE dropdowns. That was wrong: a
  // pending manifestation has no FURNACE work yet — there's nothing
  // for those tabs' renderers to render. Founder reviewed and asked
  // to surface only manifestations that have actually moved past
  // STOKER. The positive-list approach (IN_FURNACE through DOCKED)
  // is more defensive than negative-listing — any future intermediate
  // status added to the SignalStatus enum will default to "hidden
  // from selector" rather than "leaks in until someone notices",
  // which is the safer fail mode.
  const visible = manifestations.filter((m) =>
    POST_STOKER_VISIBLE.has(m.status),
  );

  // Close on outside click + Escape. Effect runs only when open so
  // we don't pay listener cost on every workspace render.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (visible.length === 0) return null;

  // Caller should keep `active` in sync with `visible`, but if a
  // dismissal lands while the component renders we may briefly receive
  // an active-decade that's no longer in the visible list. Fallback:
  // first visible manifestation.
  const activeOption =
    visible.find((m) => m.decade === active) ?? visible[0];
  const activeTint = decadeTintClass(activeOption.decade);

  // ─── Frozen pill (single visible) ─────────────────────────────────
  if (visible.length === 1) {
    return (
      <div className={`${activeTint} inline-flex`}>
        <span
          className="inline-flex items-center gap-[10px] px-[14px] py-[7px] rounded-full text-[12px] font-display font-medium -tracking-[0.005em] border"
          style={{
            background: "rgba(var(--d), 0.16)",
            borderColor: "rgba(var(--d), 0.45)",
            color: "rgba(var(--d), 0.95)",
          }}
          aria-label={`Active manifestation: ${DECADE_LABELS[activeOption.decade]} (${activeOption.shortcode})`}
        >
          <DecadeBadge decade={activeOption.decade} />
          <span>{activeOption.shortcode}</span>
        </span>
      </div>
    );
  }

  // ─── Dropdown (multiple visible) ──────────────────────────────────
  return (
    <div
      ref={containerRef}
      className={`${activeTint} relative inline-flex`}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active manifestation: ${DECADE_LABELS[activeOption.decade]} (${activeOption.shortcode}). Click to switch.`}
        className="inline-flex items-center gap-[10px] px-[14px] py-[7px] rounded-full text-[12px] font-display font-medium -tracking-[0.005em] border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 hover:brightness-110"
        style={{
          background: "rgba(var(--d), 0.16)",
          borderColor: "rgba(var(--d), 0.45)",
          color: "rgba(var(--d), 0.95)",
        }}
      >
        <DecadeBadge decade={activeOption.decade} />
        <span>{activeOption.shortcode}</span>
        <span
          aria-hidden
          style={{
            transition: "transform 0.2s ease-out",
            transform: open ? "rotate(180deg)" : "rotate(0)",
            lineHeight: 1,
            fontSize: "9px",
            marginLeft: "2px",
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch manifestation"
          className="absolute top-full left-0 mt-2 z-20 min-w-[280px] border border-rule-2 rounded-sm bg-ink shadow-[0_8px_28px_rgba(0,0,0,0.4)] overflow-hidden"
        >
          {visible.map((m) => {
            const isActive = m.decade === activeOption.decade;
            const tint = decadeTintClass(m.decade);
            return (
              <button
                key={m.decade}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onSelect(m.decade);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`${tint} w-full text-left flex items-center gap-3 px-[14px] py-[10px] hover:bg-[rgba(var(--d),0.08)] focus:outline-none focus:bg-[rgba(var(--d),0.08)] transition-colors ${
                  isActive ? "bg-[rgba(var(--d),0.06)]" : ""
                }`}
              >
                <DecadeBadge decade={m.decade} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="font-display font-medium text-[13px] -tracking-[0.005em] text-t1 truncate">
                    {m.title}
                  </span>
                  <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-t4 mt-[3px]">
                    {m.shortcode}
                  </span>
                </span>
                {isActive && (
                  <span
                    className="font-mono text-[9px] tracking-[0.22em] uppercase shrink-0"
                    style={{ color: "rgba(var(--d), 0.95)" }}
                  >
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Small decade glyph — a colored dot + decade code. Wraps itself in
 * its own t-{decade} class so the var(--d) inside resolves to the
 * decade's color regardless of the surrounding context (lets us reuse
 * the same badge inside a popover option whose surrounding scope might
 * be a different decade's tint).
 */
function DecadeBadge({ decade }: { decade: DecadeKey }) {
  const tint = decadeTintClass(decade);
  return (
    <span className={`${tint} inline-flex items-center gap-[6px] shrink-0`}>
      <span
        aria-hidden
        className="inline-block rounded-full"
        style={{
          width: 6,
          height: 6,
          background: "rgba(var(--d), 0.95)",
        }}
      />
      <span
        className="font-mono text-[9px] tracking-[0.22em] uppercase font-medium"
        style={{ color: "rgba(var(--d), 0.95)" }}
      >
        {decade}
      </span>
    </span>
  );
}
