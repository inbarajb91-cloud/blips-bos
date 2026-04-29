"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  approveCandidate,
  dismissCandidate,
} from "@/lib/actions/candidates";
import {
  archiveCollection,
  runCollectionNow,
} from "@/lib/actions/collections";
import { POST_STOKER_VISIBLE } from "@/components/engine-room/workspace/manifestation-selector";
import { StagePips, type SignalStatus } from "./stage-pips";

/**
 * CollectionCard — v4 spine + thread + body pattern.
 *
 * Outer <div> carries a `t-{type}` class so decade tint propagates via the
 * `--d` CSS variable (set in globals.css). Surfaces inside rgba(var(--d), α)
 * pick up the collection's color identity.
 *
 * Expanded body contains two stacked sections:
 *   1. TRIAGE  — pending candidates awaiting approve/dismiss
 *   2. PIPELINE — approved signals with 6-stage pips + Open → workspace
 *
 * Collapsed spine shows just name + type/timestamp meta + total count.
 */

export interface CollectionForCard {
  id: string;
  name: string;
  outline: string | null;
  type: "instant" | "batch" | "scheduled";
  status: "queued" | "running" | "idle" | "archived" | "failed";
  candidateCount: number;
  signalCount: number;
  targetCount: number;
  cadence: string | null;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CandidateForCard {
  id: string;
  shortcode: string;
  workingTitle: string;
  concept: string | null;
  source: string;
  createdAt: Date;
}

export interface SignalForCard {
  id: string;
  shortcode: string;
  workingTitle: string;
  concept: string | null;
  status: SignalStatus;
  source: string;
  updatedAt: Date;
  /** Phase 9E — set on manifestation children, null on raw signals. */
  decade: "RCK" | "RCL" | "RCD" | null;
  /** Phase 9E — nested manifestations rendered indented under the
   *  parent row. Empty array on manifestation children themselves
   *  (no grandchildren — STOKER refuses to recurse on its own outputs). */
  manifestations: SignalForCard[];
}

/** Summary of the collection's most recent run — surfaces on the spine. */
export interface LatestRunSummary {
  status: "queued" | "running" | "idle" | "archived" | "failed";
  fetchedRaw: number;
  deduped: number;
  extracted: number;
  errors: number;
  completedAt: Date | null;
}

export interface CollectionCardProps {
  collection: CollectionForCard;
  candidates: CandidateForCard[];
  signals: SignalForCard[];
  latestRun?: LatestRunSummary | null;
  /** Expand this collection on initial render. */
  defaultOpen?: boolean;
}

export function CollectionCard({
  collection: c,
  candidates,
  signals,
  latestRun = null,
  defaultOpen = false,
}: CollectionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [runPending, startRunTransition] = useTransition();
  // Inline count picker state. Closed by default; click Regenerate → opens
  // with the original targetCount pre-filled so the default path stays
  // 2 clicks (Regenerate → Go).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [regenCount, setRegenCount] = useState<number>(c.targetCount);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [archivePending, startArchiveTransition] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus + select the count on open so users can overwrite with a
  // single keystroke. Reset count + error when closed so the next open
  // starts clean.
  useEffect(() => {
    if (pickerOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      setRegenCount(c.targetCount);
      setRegenError(null);
    }
  }, [pickerOpen, c.targetCount]);

  const typeLabel = c.type.charAt(0).toUpperCase() + c.type.slice(1);
  const isRunning = c.status === "running";
  const isQueued = c.status === "queued";
  const isFailed = c.status === "failed";
  const isActive = isRunning || isQueued; // "something is happening"
  const totalCount = c.candidateCount + c.signalCount;
  // Regenerate applies to every collection type: Instant/Batch for "add
  // more to triage," Scheduled for "don't wait for the next cron, top up
  // now." Excluded: Direct submissions + Legacy (buckets, not BUNKER runs).
  // Status gate is handled here + re-verified by the server action.
  const canRegenerate =
    !isActive &&
    c.name !== "Direct submissions" &&
    c.name !== "Legacy — pre-6.5";

  const fireRegenerate = () => {
    setRegenError(null);
    startRunTransition(async () => {
      try {
        await runCollectionNow(c.id, { count: regenCount });
        setPickerOpen(false);
      } catch (e) {
        // Surface the error inline under the picker so the user actually
        // sees why regenerate didn't fire — "already running," "count out
        // of range," "could not queue collection run" etc. Without this,
        // the picker just closes out of pending state with no feedback
        // and looks like a dead button.
        console.error("Regenerate failed:", e);
        setRegenError(
          e instanceof Error
            ? e.message
            : "Could not start regeneration.",
        );
      }
    });
  };

  // Decide what to surface from the latest run. Only show when the run
  // actually ran (completed or failed) AND the result is informative —
  // "ran clean with new signals" is already clear from the aggregate count,
  // so we skip it. We DO want to surface "0 new · deduped" and "errors".
  const runInfo = !isActive && latestRun ? interpretRun(latestRun) : null;

  // Relative time for meta row
  const timeMeta = formatCollectionTime(c);
  const cadenceMeta =
    c.type === "scheduled" && c.cadence
      ? `every ${c.cadence === "daily" ? "day" : c.cadence === "weekly" ? "Monday" : c.cadence === "monthly" ? "month" : c.cadence}`
      : null;

  return (
    <div
      className={`t-${c.type} border-t border-rule-1 last:border-b transition-colors duration-200`}
      style={{
        background: open
          ? `linear-gradient(to bottom, rgba(var(--d), 0.034), rgba(var(--d), 0.022))`
          : isActive
            ? `rgba(var(--d), 0.028)`
            : `rgba(var(--d), 0.012)`,
      }}
    >
      {/* Spine: clickable area + count + Regenerate action.
          Column order matters for alignment: dot | title | count | action.
          The Regenerate cell sits on the far right so its right edge is
          anchored to the container padding — the picker open/close state
          and varying count-cell widths can't slide it around. Count's
          content is right-aligned, so its numbers also line up across
          cards even as the subtitle text width varies.
          The Regenerate cell has a min-width covering both the closed
          ("Regenerate") and open ([input] [Go] [Cancel]) states so the
          action doesn't visually jump when the picker toggles. */}
      <div className="grid grid-cols-[16px_1fr_auto_minmax(112px,auto)] gap-5 items-baseline px-4 py-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`collection-body-${c.id}`}
          aria-label={open ? "Collapse collection" : "Expand collection"}
          className="flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 cursor-pointer"
          style={{ height: 22 }}
        >
          <span
            className="rounded-full transition-colors"
            style={{
              width: 7,
              height: 7,
              background: isActive
                ? "rgba(var(--d), 1)"
                : c.type === "scheduled"
                  ? "transparent"
                  : open
                    ? "rgba(var(--d), 0.92)"
                    : "rgba(var(--d), 0.65)",
              border:
                c.type === "scheduled"
                  ? "1.5px solid rgba(var(--d), 0.72)"
                  : "none",
              boxShadow: isActive ? "0 0 6px rgba(var(--d), 0.45)" : "none",
              animation: isActive ? "breathe 2.8s ease-in-out infinite" : "none",
            }}
            aria-hidden
          />
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-left flex flex-col gap-1 min-w-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 rounded-sm"
        >
          <div className="font-display font-medium text-[17px] -tracking-[0.005em] leading-[1.3] text-t1">
            {c.name}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap font-mono text-[10.5px] tracking-[0.22em] uppercase text-t4">
            <span
              className="font-medium"
              style={{
                color: `rgba(var(--d), ${open ? 1 : 0.92})`,
              }}
            >
              {typeLabel}
            </span>
            {cadenceMeta && (
              <>
                <span className="text-t5">·</span>
                <span>{cadenceMeta}</span>
              </>
            )}
            {/* Skip the generic timeMeta ("live") when we'll render an
                explicit LIVE/QUEUED label below — otherwise the meta row
                reads "LIVE · LIVE · collecting" which is silly. */}
            {!isActive && (
              <>
                <span className="text-t5">·</span>
                <span>{timeMeta}</span>
              </>
            )}
            {isRunning && (
              <>
                <span className="text-t5">·</span>
                <span
                  className="breathe font-medium"
                  style={{ color: "rgba(var(--d), 1)" }}
                >
                  LIVE · collecting
                </span>
              </>
            )}
            {isQueued && (
              <>
                <span className="text-t5">·</span>
                <span
                  className="breathe font-medium"
                  style={{ color: "rgba(var(--d), 1)" }}
                >
                  QUEUED · starting…
                </span>
              </>
            )}
            {isFailed && (
              <>
                <span className="text-t5">·</span>
                <span className="font-medium text-[#d4908a]">FAILED</span>
              </>
            )}
          </div>

          {/* Secondary run-summary line — only when last run is worth
              calling out (0 new / errors). Small, retreating. */}
          {runInfo && (
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t5 mt-1">
              {runInfo.text}
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-col items-end gap-0.5 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 rounded-sm"
        >
          <span
            className="font-display font-medium text-[16px]"
            style={{
              color: open
                ? `color-mix(in oklab, var(--color-t1) 86%, rgba(var(--d), 1) 14%)`
                : "var(--color-t1)",
            }}
          >
            {isActive ? (
              <span className="breathe">
                {totalCount}
                <span className="text-t4"> / {c.targetCount}</span>
              </span>
            ) : (
              totalCount
            )}
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-t5">
            {c.candidateCount > 0 && c.signalCount > 0
              ? `${c.candidateCount} triage · ${c.signalCount} pipeline`
              : c.signalCount > 0
                ? `${c.signalCount} pipeline`
                : c.candidateCount > 0
                  ? `${c.candidateCount} triage`
                  : isActive
                    ? "starting"
                    : "empty"}
          </span>
        </button>

        {/* Regenerate cell — anchored to the right edge of the spine via
            the grid's last column. Both closed and open states are
            justified-end inside this cell so the button/picker don't
            shift when toggled. When a regenerate error surfaces, it
            renders beneath the picker row in the same cell. */}
        <div className="flex flex-col items-end gap-1.5">
          {canRegenerate ? (
            pickerOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="number"
                  min={1}
                  max={100}
                  value={regenCount}
                  onChange={(e) => {
                    // Clamp to 1-100 server-side too; here we just keep a
                    // reasonable number in the input. Empty string → 1.
                    const raw = e.target.value;
                    if (raw === "") {
                      setRegenCount(1);
                      return;
                    }
                    const n = Math.max(1, Math.min(100, Number(raw) || 1));
                    setRegenCount(n);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      fireRegenerate();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setPickerOpen(false);
                    }
                  }}
                  disabled={runPending}
                  aria-label="Number of signals to regenerate"
                  className="w-[52px] font-mono text-[12px] text-center bg-transparent border border-rule-2 rounded-sm py-1.5 text-t1 focus-visible:outline-none focus-visible:border-t2 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={fireRegenerate}
                  disabled={runPending}
                  className="font-mono text-[10px] tracking-[0.22em] uppercase px-3 py-1.5 rounded-sm border text-t1 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
                  style={{
                    borderColor: "rgba(var(--d), 0.72)",
                    background: runPending
                      ? "rgba(var(--d), 0.12)"
                      : "transparent",
                  }}
                  aria-label={`Regenerate ${regenCount} signal${regenCount === 1 ? "" : "s"} for ${c.name}`}
                >
                  {runPending ? "Firing…" : "Go"}
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  disabled={runPending}
                  className="font-mono text-[10px] tracking-[0.22em] uppercase px-2 py-1.5 rounded-sm text-t5 hover:text-t3 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="font-mono text-[10px] tracking-[0.22em] uppercase px-3 py-1.5 rounded-sm border border-rule-2 text-t3 hover:text-t1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
                aria-label={`Regenerate ${c.name}`}
              >
                Regenerate
              </button>
            )
          ) : null}
          {regenError && (
            <div
              role="alert"
              className="font-mono text-[10px] tracking-[0.14em] text-[#d4908a] max-w-[280px] text-right leading-[1.4]"
            >
              {regenError}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar — now visible during queued AND running. Thicker than
          the old 1px hairline so you can actually see it. */}
      {isActive && (
        <div
          className="relative h-[3px] mx-4 ml-[42px] rounded-[1.5px] overflow-hidden"
          style={{ background: "rgba(var(--d), 0.12)" }}
          aria-label="Collection progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={c.targetCount}
          aria-valuenow={totalCount}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-[1.5px] breathe"
            style={{
              width: isQueued
                ? "12%" // indeterminate-ish pulse while queued
                : `${Math.max(3, Math.min(100, (totalCount / Math.max(1, c.targetCount)) * 100))}%`,
              background: "rgba(var(--d), 0.95)",
              boxShadow: "0 0 6px rgba(var(--d), 0.5)",
              transition: "width 600ms ease-out",
            }}
          />
        </div>
      )}

      {/* Expanded body — grid-template-rows trick for a single fluid
          collapse. Outer grid animates from 1fr → 0fr, which smoothly
          tracks the inner content's actual height down to zero. This
          replaces the old max-height approach which created a visible
          two-stage feel (ceiling drops with content pinned, then content
          snaps off the bottom). Padding lives on the deepest wrapper so
          it gets clipped together with the content, not animated
          independently. */}
      <div
        id={`collection-body-${c.id}`}
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
        aria-hidden={!open}
      >
        <div
          className="overflow-hidden ml-[42px] border-l transition-[border-color] duration-300 ease-out"
          style={{
            borderLeftColor: open ? "rgba(var(--d), 0.55)" : "transparent",
          }}
        >
          <div className="pt-2 pb-7 pl-7 pr-6">
            {c.outline && (
              <p className="font-editorial italic text-[14px] leading-[1.5] text-t3 py-1.5 pb-4 max-w-[620px]">
                {c.outline}
              </p>
            )}

            {/* PIPELINE first — approved signals moving through stages.
                Showing progress before obligation: the work you're making
                is visible immediately; the triage chore comes after. */}
            {signals.length > 0 && (
              <section className="mt-2 mb-7">
                <SectionLabel>
                  Pipeline · {signals.length} in motion · click row to open
                </SectionLabel>
                <div className="flex flex-col">
                  {signals.map((s) => (
                    <SignalRow
                      key={s.id}
                      s={s}
                      parentHref={`/engine-room/signals/${encodeURIComponent(s.shortcode)}`}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* TRIAGE — pending candidates awaiting your approve/dismiss */}
            {candidates.length > 0 && (
              <section className="mt-2">
                <SectionLabel>
                  Triage · {candidates.length} awaiting review
                </SectionLabel>
                <div className="flex flex-col">
                  {candidates.map((cand) => (
                    <CandidateRow key={cand.id} c={cand} />
                  ))}
                </div>
              </section>
            )}

            {candidates.length === 0 && signals.length === 0 && (
              <p className="font-editorial italic text-[14px] text-t4 py-6">
                nothing here yet. {isRunning ? "collecting…" : "re-run to refresh."}
              </p>
            )}

            {/* Archive affordance — only on non-singleton collections that
                aren't actively running. Archive is soft: the row hides from
                Bridge but stays in the DB (collections.status='archived')
                so recovery via SQL is always possible. Direct submissions
                + Legacy are system buckets and never archivable. */}
            {canRegenerate && !isActive && (
              <div className="mt-8 pt-5 border-t border-rule-1 flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveError(null);
                      startArchiveTransition(async () => {
                        try {
                          await archiveCollection(c.id);
                        } catch (e) {
                          console.error("Archive failed:", e);
                          setArchiveError(
                            e instanceof Error
                              ? e.message
                              : "Could not archive this collection.",
                          );
                        }
                      });
                    }}
                    disabled={archivePending}
                    className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5 hover:text-t3 transition-colors self-start disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 rounded-sm"
                    aria-label={`Archive collection ${c.name}`}
                  >
                    {archivePending ? "Archiving…" : "Archive"}
                  </button>
                  {archiveError && (
                    <span
                      role="alert"
                      className="font-mono text-[10px] tracking-[0.14em] text-[#d4908a] mt-2"
                    >
                      {archiveError}
                    </span>
                  )}
                </div>
                <span className="font-editorial italic text-[12.5px] text-t5 max-w-[340px] text-right leading-[1.5]">
                  Hides this collection from Bridge. Signals stay in the
                  pipeline; triage candidates retained.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-4">
      {children}
    </h3>
  );
}

/** Compact candidate row — triage preview without the old pipeline pip styling. */
function CandidateRow({ c }: { c: CandidateForCard }) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"approve" | "dismiss" | null>(null);

  const age = formatAge(c.createdAt);

  return (
    <div
      className={`grid grid-cols-[72px_1fr_auto_auto] gap-4 items-center py-3.5 border-b border-rule-1 last:border-b-0 transition-opacity ${
        pending ? "opacity-50" : ""
      }`}
    >
      <span className="font-display font-bold text-[11.5px] tracking-[0.16em] text-t1">
        {c.shortcode}
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="font-display font-medium text-[14.5px] -tracking-[0.005em] text-t1 leading-[1.3]">
          {c.workingTitle}
        </span>
        {c.concept && (
          <span className="font-editorial italic text-[14px] leading-[1.5] text-t3">
            {c.concept}
          </span>
        )}
      </div>
      <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-t4 whitespace-nowrap">
        {c.source} · {age}
      </span>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setAction("dismiss");
            startTransition(async () => {
              await dismissCandidate(c.id);
            });
          }}
          disabled={pending}
          className="font-mono text-[10.5px] tracking-[0.2em] uppercase px-3 py-1.5 rounded-sm text-t4 hover:text-t1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
        >
          {pending && action === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAction("approve");
            startTransition(async () => {
              await approveCandidate(c.id);
            });
          }}
          disabled={pending}
          className="font-mono text-[10.5px] tracking-[0.2em] uppercase px-3 py-1.5 rounded-sm bg-off-white text-ink hover:bg-warm-bright transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          {pending && action === "approve" ? "Approving…" : "Approve"}
        </button>
      </div>
    </div>
  );
}

/** Pipeline signal row — stage pips + Open → workspace link.
 *
 * Phase 9.5: Bridge flatten. Manifestation children no longer render
 * as their own nested rows under the parent. Instead, the parent row
 * gains an inline decade-chip cluster (RCK / RCL / RCD) showing
 * which non-dismissed manifestations exist. Each chip is a separate
 * navigation target — clicking a chip jumps to the parent workspace
 * with `?m=DECADE` so the manifestation selector pre-selects that
 * decade. Clicking the rest of the row falls through to the parent's
 * default workspace (no `?m=`, first-visible manifestation chosen by
 * the workspace itself).
 *
 * Why flat: with the nested-row layout, a single STOKER fan-out
 * tripled a collection's visible row count, and post-STOKER each
 * child evolved its own pipeline status — making the Bridge feel
 * crowded with secondary information. The decade chips carry the
 * "this signal has 3 manifestations" weight in a fraction of the
 * vertical space, with full per-manifestation detail one click away.
 *
 * Implementation note: the chips sit inside the same <Link> that wraps
 * the row, but call e.preventDefault() + e.stopPropagation() in their
 * own onClick to navigate via router.push. This is the cleanest way
 * to keep the row a real <a> (so middle-click / cmd-click open in new
 * tab still work) while letting the chips override navigation when
 * clicked directly.
 */
function SignalRow({
  s,
  parentHref,
}: {
  s: SignalForCard;
  /** Resolved href for the parent navigation — same shortcode, no
   *  `?m=`. Computed once by the caller and reused for both the row
   *  Link and the chip onClick handlers below. */
  parentHref: string;
}) {
  const age = formatAge(s.updatedAt);
  // Phase 9.5 polish — chip cluster only surfaces manifestations that
  // have moved past STOKER (advancing through FURNACE+). Pending
  // children (still IN_STOKER) belong on the parent's STOKER tab
  // for per-card review, not on the Bridge — surfacing them here
  // would invite a click that lands on FURNACE with nothing to show
  // (selector falls back to first visible, URL ?m= is ignored). Same
  // POST_STOKER_VISIBLE set the workspace's ManifestationSelector
  // uses, kept in sync via the shared export.
  const activeManifestations = s.manifestations.filter((m) =>
    POST_STOKER_VISIBLE.has(m.status),
  );
  const hasManifestations = activeManifestations.length > 0;
  const router = useRouter();

  return (
    // Outer wrapper carries the row hover + border. Two <Link>s span
    // the non-chip cells via `display: contents` so they participate
    // in the parent grid as normal children but don't introduce
    // nested-anchor markup. Chip cluster sits as a sibling between
    // them — the Bridge's previous Link-wrapping-buttons layout was
    // invalid HTML (interactive content inside <a>) and broke
    // keyboard/AT navigation; CR pass on PR #10 caught it.
    //
    // Two-Link split (vs. one Link covering everything via more
    // exotic display tricks): keeps each Link's purpose clear, both
    // resolve to the same parentHref, and keyboard tab order stays
    // intuitive (shortcode/title → chips → stage-pips/label/age).
    // The outer <div> carries the row's hover+focus-within state so
    // the row still highlights as a single unit.
    <div className="grid grid-cols-[72px_1fr_auto_auto_auto_auto] gap-4 items-center py-3.5 border-b border-rule-1 last:border-b-0 hover:bg-wash-1 focus-within:bg-wash-1 transition-colors rounded-sm">
      <Link
        href={parentHref}
        className="contents focus-visible:outline-none"
      >
        <span className="font-display font-bold text-[11.5px] tracking-[0.16em] text-t1">
          {s.shortcode}
        </span>
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="font-display font-medium text-[14.5px] text-t1 -tracking-[0.005em] leading-[1.3]">
            {s.workingTitle}
          </span>
          {s.concept && (
            <span className="font-editorial italic text-[14px] leading-[1.5] text-t3 line-clamp-1">
              {s.concept}
            </span>
          )}
        </div>
      </Link>
      {/* Decade chip cluster — Phase 9.5. One chip per non-dismissed
          manifestation child, color-coded by decade. Empty div when
          the parent has no manifestations so the grid track collapses
          cleanly. CR pass on PR #10: chips moved out of the Link to
          fix nested-anchor invalid markup; using m.id (not m.decade)
          as the React key, and skipping any child whose decade is
          missing (defensive — DB CHECK keeps decades present). */}
      <div className="flex items-center gap-1.5">
        {hasManifestations &&
          activeManifestations
            .filter((m): m is typeof m & { decade: "RCK" | "RCL" | "RCD" } =>
              m.decade != null,
            )
            .map((m) => (
              <DecadeChip
                key={m.id}
                decade={m.decade}
                onClick={() => {
                  router.push(
                    `/engine-room/signals/${encodeURIComponent(s.shortcode)}?m=${m.decade}`,
                  );
                }}
              />
            ))}
      </div>
      <Link
        href={parentHref}
        className="contents focus-visible:outline-none"
      >
        <StagePips status={s.status} size={5} showLabel={false} />
        <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-t2 whitespace-nowrap">
          {currentStageLabel(s.status)}
        </span>
        <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-t5 whitespace-nowrap">
          {age} &rsaquo;
        </span>
      </Link>
    </div>
  );
}

/**
 * Decade chip — small colored pill rendered in the parent row for each
 * non-dismissed manifestation. Renders as a sibling of the row's
 * <Link>s (CR pass on PR #10 — was previously nested inside the Link
 * which was invalid HTML and broke keyboard/AT navigation). Plain
 * <button> with onClick for navigation; no preventDefault dance
 * needed now that it's not under an anchor.
 */
function DecadeChip({
  decade,
  onClick,
}: {
  decade: "RCK" | "RCL" | "RCD";
  onClick: () => void;
}) {
  const tint =
    decade === "RCK" ? "t-rck" : decade === "RCL" ? "t-rcl" : "t-rcd";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open the ${decade} manifestation`}
      className={`${tint} font-mono text-[9px] tracking-[0.18em] uppercase font-medium px-1.5 py-0.5 border rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2`}
      style={{
        color: "rgba(var(--d), 0.95)",
        borderColor: "rgba(var(--d), 0.4)",
        background: "rgba(var(--d), 0.06)",
      }}
    >
      {decade}
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatCollectionTime(c: CollectionForCard): string {
  if (c.status === "running") return "live";
  // Scheduled collections waiting for their next cron fire — surface the
  // wait time, not the creation age. Priority over lastRunAt so a scheduled
  // that just finished shows "next in 24h" rather than "updated 1m ago".
  if (c.type === "scheduled" && c.status === "idle" && c.nextRunAt) {
    const until = formatUntil(c.nextRunAt);
    if (until) return `next run ${until}`;
  }
  if (c.lastRunAt) {
    const ago = formatAge(c.lastRunAt);
    return `updated ${ago}`;
  }
  return formatAge(c.createdAt);
}

/** "in 12h" / "in 3d" / "in 5m" — returns null if the date is already past. */
function formatUntil(date: Date): string | null {
  const seconds = Math.floor((new Date(date).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return null;
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `in ${days}d`;
  const months = Math.floor(days / 30);
  return `in ${months}mo`;
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/**
 * Decide whether the latest run is worth surfacing on the spine.
 *
 * Rules:
 *   - Clean win (extracted > 0, errors = 0) → null. The count on the right
 *     already tells the story; don't clutter the meta.
 *   - 0 extracted, all dedup'd (BUNKER saw stuff but nothing was new) →
 *     "0 new · N deduped". Helps the user understand why the count is 0.
 *   - Errors present → surface them.
 *   - Nothing happened (fetched 0 raw) → null. Probably a transient source
 *     glitch; will self-correct on next run.
 */
function interpretRun(run: LatestRunSummary): { text: string } | null {
  const { fetchedRaw, deduped, extracted, errors } = run;

  // Pure success — let the spine count speak for itself.
  if (extracted > 0 && errors === 0) return null;

  // Nothing fetched — probably network blip, not actionable info for user.
  if (fetchedRaw === 0 && errors === 0) return null;

  const parts: string[] = [];
  if (extracted === 0) {
    parts.push("0 new");
  } else if (errors > 0) {
    parts.push(`${extracted} new`);
  }
  if (deduped > 0) parts.push(`${deduped} already seen`);
  if (errors > 0) {
    parts.push(`${errors} source ${errors === 1 ? "error" : "errors"}`);
  }
  if (parts.length === 0) return null;
  return { text: parts.join(" · ") };
}

function currentStageLabel(status: SignalStatus): string {
  switch (status) {
    case "IN_BUNKER":
      return "BUNKER";
    case "IN_STOKER":
      return "STOKER";
    case "IN_FURNACE":
      return "FURNACE";
    case "IN_BOILER":
      return "BOILER";
    case "IN_ENGINE":
      return "ENGINE";
    case "AT_PROPELLER":
      return "PROPELLER";
    case "DOCKED":
      return "DOCKED";
    case "FANNED_OUT":
      return "FANNED OUT";
    case "STOKER_REFUSED":
      return "STOKER REFUSED";
    case "COLD_BUNKER":
      return "COLD";
    case "DISMISSED":
      return "DISMISSED";
    case "BUNKER_FAILED":
    case "EXTRACTION_FAILED":
      return "FAILED";
    default:
      return "—";
  }
}
