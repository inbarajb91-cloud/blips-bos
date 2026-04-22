"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  approveCandidate,
  dismissCandidate,
} from "@/lib/actions/candidates";
import { runCollectionNow } from "@/lib/actions/collections";
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

  const typeLabel = c.type.charAt(0).toUpperCase() + c.type.slice(1);
  const isRunning = c.status === "running";
  const isQueued = c.status === "queued";
  const isFailed = c.status === "failed";
  const isActive = isRunning || isQueued; // "something is happening"
  const totalCount = c.candidateCount + c.signalCount;
  // Run now only belongs on scheduled collections that are waiting for
  // their next cadence tick. You can fire them early; you can't re-run a
  // finished instant/batch (those are one-shot) and you can't nudge the
  // Direct submissions / Legacy buckets — neither is a real BUNKER run.
  const canRunNow =
    !isActive &&
    c.type === "scheduled" &&
    c.name !== "Direct submissions" &&
    c.name !== "Legacy — pre-6.5" &&
    c.nextRunAt !== null &&
    new Date(c.nextRunAt) > new Date();

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
      {/* Spine: clickable area + optional Run-now button. Split button +
          button nesting is illegal — the whole spine is a <div> with a
          dedicated expand button on the left and a Run-now button on the
          right when applicable. */}
      <div className="grid grid-cols-[16px_1fr_auto_auto] gap-5 items-baseline px-4 py-5">
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
            <span className="text-t5">·</span>
            <span>{timeMeta}</span>
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

        {canRunNow ? (
          <button
            type="button"
            onClick={() => {
              startRunTransition(async () => {
                try {
                  await runCollectionNow(c.id);
                } catch (e) {
                  console.error("Run now failed:", e);
                }
              });
            }}
            disabled={runPending}
            className="font-mono text-[10px] tracking-[0.22em] uppercase px-3 py-1.5 rounded-sm border border-rule-2 text-t3 hover:text-t1 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
            style={{
              borderColor: runPending ? "rgba(var(--d), 0.85)" : undefined,
            }}
            aria-label={`Run ${c.name} now`}
          >
            {runPending ? "Firing…" : "Run now"}
          </button>
        ) : (
          <span />
        )}

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

      {/* Expanded body */}
      <div
        id={`collection-body-${c.id}`}
        className="overflow-hidden transition-[max-height,padding] duration-300 ease-out ml-[42px] border-l"
        style={{
          maxHeight: open ? "3200px" : "0",
          padding: open ? "8px 24px 28px 28px" : "0 24px 0 28px",
          borderLeftColor: open ? "rgba(var(--d), 0.55)" : "transparent",
        }}
      >
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
                <SignalRow key={s.id} s={s} />
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

/** Pipeline signal row — stage pips + Open → workspace link. */
function SignalRow({ s }: { s: SignalForCard }) {
  const age = formatAge(s.updatedAt);

  return (
    <Link
      href={`/engine-room/signals/${encodeURIComponent(s.shortcode)}`}
      className="grid grid-cols-[72px_1fr_auto_auto_auto] gap-4 items-center py-3.5 border-b border-rule-1 last:border-b-0 hover:bg-wash-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 rounded-sm"
    >
      <span className="font-display font-bold text-[11.5px] tracking-[0.16em] text-t1">
        {s.shortcode}
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="font-display font-medium text-[14.5px] -tracking-[0.005em] text-t1 leading-[1.3]">
          {s.workingTitle}
        </span>
        {s.concept && (
          <span className="font-editorial italic text-[14px] leading-[1.5] text-t3 line-clamp-1">
            {s.concept}
          </span>
        )}
      </div>
      <StagePips status={s.status} size={5} showLabel={false} />
      <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-t2 whitespace-nowrap">
        {currentStageLabel(s.status)}
      </span>
      <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-t5 whitespace-nowrap">
        {age} &rsaquo;
      </span>
    </Link>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatCollectionTime(c: CollectionForCard): string {
  if (c.status === "running") return "live";
  if (c.lastRunAt) {
    const ago = formatAge(c.lastRunAt);
    return `updated ${ago}`;
  }
  return formatAge(c.createdAt);
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
