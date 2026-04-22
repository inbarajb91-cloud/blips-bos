"use client";

import Link from "next/link";
import { useState } from "react";
import type { signals, collections } from "@/db/schema";
import type { LockStatus } from "@/lib/actions/signal-locks";

/**
 * Horizontal collapsible context strip — Phase 7 architectural.
 *
 * Replaces the vertical LeftRail. Lives between the signal title header
 * and the AgentTabStrip. Always renders in both states; the only thing
 * that changes is the amount of information it shows.
 *
 * Why horizontal instead of a left rail:
 *   - The rail stole ~300px of viewport from the canvas full-time to
 *     carry context the user glances at once and then mostly ignores
 *     (collection name, concept, signal shortcode, source). Not a fair
 *     trade.
 *   - The tab strip already carries pipeline progress, so the rail's
 *     "Pipeline Progress" row was redundant.
 *   - Horizontal-collapsed surfaces the two things the user DOES
 *     reach for mid-session — "what collection is this from?" and
 *     "am I holding the edit lock?" — in a single glance, with the
 *     richer context available via one click when wanted.
 *
 * End state: the workspace becomes a two-panel layout (canvas + ORC
 * conversation). The strip sits above both panels, spanning full width.
 *
 * Two states:
 *
 *   Collapsed (default, ~44px) — renders every page load:
 *     FROM COLLECTION · name · type · pipeline/triage counts
 *                                      lock: you · 30m · [Release] ‹
 *
 *   Expanded (user-expanded, ~140px):
 *     [collection mini-card with decade tint]   [concept pull-quote]
 *     [signal meta grid]                        [lock row]       ›
 *
 * Decade tint: the collection's type (instant/batch/scheduled) maps to
 * a decade color via the `t-{type}` class on the workspace root. This
 * component's accent surfaces read that via rgba(var(--d), …) so the
 * collection card's left border glows in decade color, matching the
 * tab strip's breathing underline and the resize handle's active state.
 *
 * Lock toggle moves inside this strip. The LeftRail's LockToggle
 * component was ported in-place rather than re-exported — the shape
 * is the same (timer + Release button when held, "unlocked" +
 * Lock button when self-released, warning text when held by someone
 * else). Same underlying handlers from the parent WorkspaceFrame.
 */
export function ContextStrip({
  signal,
  collection,
  lockStatus,
  onReleaseLock,
  onAcquireLock,
}: {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
  lockStatus: LockStatus | null;
  onReleaseLock: () => void;
  onAcquireLock: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Decade border tint for the collection mini-card when present. When
  // there's no collection (direct submission / legacy), we fall back to
  // a neutral rule color instead of the ink-default so the card still
  // reads as a container.
  const accentBorder = collection
    ? "rgba(var(--d), 0.65)"
    : "var(--color-rule-2)";

  return (
    <section
      aria-label="Signal context"
      className="px-11 border-b border-rule-1 bg-wash-1"
    >
      {/* Collapsed row — single-line summary. Always visible, even when
          the strip is expanded (the expanded body sits beneath it, same
          row just taller). Keeping the collapsed row visible in both
          states gives the chevron a stable perch and makes the
          collapse/expand affordance feel like a disclosure, not a
          page-shift. */}
      <div className="flex items-center justify-between gap-6 h-[44px]">
        <div className="flex items-center gap-5 min-w-0">
          {collection ? (
            <>
              <Label>From Collection</Label>
              <Link
                href="/engine-room"
                className="flex items-baseline gap-[10px] min-w-0 group"
              >
                <span className="font-display font-medium text-[14px] -tracking-[0.005em] text-t1 leading-none truncate group-hover:text-off-white transition-colors">
                  {collection.name}
                </span>
                <span
                  className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-medium"
                  style={{ color: "rgba(var(--d), 0.9)" }}
                >
                  {collection.type.charAt(0).toUpperCase() +
                    collection.type.slice(1)}
                </span>
                <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-t4 truncate">
                  {collectionCountsText(
                    collection.signalCount,
                    collection.candidateCount,
                  )}
                </span>
              </Link>
            </>
          ) : (
            <>
              <Label>Signal origin</Label>
              <span className="font-editorial italic text-[13.5px] text-t4 truncate">
                Direct submission · no parent collection
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-5 shrink-0">
          <LockToggle
            status={lockStatus}
            onRelease={onReleaseLock}
            onAcquire={onAcquireLock}
          />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="context-strip-body"
            aria-label={expanded ? "Collapse context" : "Expand context"}
            className="w-7 h-7 rounded-full border border-rule-2 bg-ink flex items-center justify-center text-t3 text-[11px] hover:text-t1 hover:border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          >
            <span
              style={{
                transition: "transform 0.25s ease-out",
                transform: expanded ? "rotate(90deg)" : "rotate(-90deg)",
                lineHeight: 1,
              }}
            >
              ‹
            </span>
          </button>
        </div>
      </div>

      {/* Expanded body — grid-template-rows animates smoothly from 0fr
          to 1fr so the body slides in and out without a hard snap. The
          inner min-h-0 prevents the grid child from forcing its own
          height when collapsed (which would defeat the 0fr). Same
          pattern as the collection-card body expansion on Bridge. */}
      <div
        id="context-strip-body"
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className={`grid gap-8 pt-2 pb-6 ${collection ? `t-${collection.type}` : ""}`}
            style={{
              gridTemplateColumns: "minmax(240px, 340px) 1fr minmax(240px, 320px)",
            }}
          >
            {/* Collection mini-card — links back to Bridge. Decade tint on
                the left border reads as a subtle identity marker; the
                concept-level thinking is carried in the middle column. */}
            {collection ? (
              <Link
                href="/engine-room"
                className="block p-[14px_14px_14px_16px] border border-rule-2 rounded-sm bg-[rgba(var(--d),0.028)] hover:bg-[rgba(var(--d),0.048)] transition-colors"
                style={{
                  borderLeftWidth: 2,
                  borderLeftColor: accentBorder,
                }}
              >
                <div className="font-display font-medium text-[14px] -tracking-[0.005em] text-t1 leading-[1.3] mb-[6px]">
                  {collection.name}
                </div>
                <div
                  className="font-mono text-[9.5px] tracking-[0.22em] uppercase font-medium"
                  style={{ color: "rgba(var(--d), 0.9)" }}
                >
                  {collection.type.charAt(0).toUpperCase() +
                    collection.type.slice(1)}
                  <span className="text-t5 mx-[6px]">·</span>
                  <span className="text-t3">
                    {collectionCountsText(
                      collection.signalCount,
                      collection.candidateCount,
                    )}
                  </span>
                </div>
              </Link>
            ) : (
              <div className="p-[14px_16px] border border-rule-1 rounded-sm bg-wash-1">
                <div className="font-editorial italic text-[13.5px] text-t4">
                  Direct submission · no parent collection
                </div>
              </div>
            )}

            {/* Concept pull-quote — the one piece of extraction writing
                that consistently reads well in a glance. Quietly italicized
                so it feels like the signal's voice, not boilerplate. */}
            <div className="flex flex-col justify-center">
              {signal.concept ? (
                <>
                  <Label>Concept</Label>
                  <p className="font-editorial italic text-[15px] leading-[1.5] text-t2">
                    &ldquo;{signal.concept}&rdquo;
                  </p>
                </>
              ) : null}
            </div>

            {/* Signal meta grid — shortcode, source, created, updated.
                Monospace keys on the left, values on the right; same
                two-column row pattern as the old LeftRail so the
                muscle-memory carries over. */}
            <div>
              <Label>Signal</Label>
              <MetaRow k="Shortcode" v={signal.shortcode} />
              <MetaRow k="Source" v={signal.source} />
              <MetaRow k="Created" v={formatDate(signal.createdAt)} />
              <MetaRow k="Updated" v={formatDate(signal.updatedAt)} />
            </div>
          </div>

          {/* Read-only banner — ported from LeftRail. Gating on
              lockedByAuthId (not email) so the banner still renders when
              the users join returns null — we fall back to "Another user"
              so the explanation never disappears. Same post-CodeRabbit
              fix applied here. Only shows when expanded so the collapsed
              row stays clean; the LockToggle there already surfaces the
              "someone else holds it" state via its warning color. */}
          {lockStatus &&
            !lockStatus.heldByMe &&
            lockStatus.lockedByAuthId && (
              <div className="mb-6 p-[12px_14px] border border-[#d4908a]/30 bg-[#a04040]/10 rounded-sm">
                <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-[#d4908a] mb-1">
                  Read-only
                </div>
                <p className="font-editorial italic text-[13.5px] leading-[1.5] text-t3">
                  {lockStatus.lockedByEmail ?? "Another user"} is currently
                  editing this signal. You can view — edits unlock when
                  their session ends or the lock expires.
                </p>
              </div>
            )}
        </div>
      </div>
    </section>
  );
}

// ─── Presentational helpers ────────────────────────────────────────

/**
 * Lock row value — renders differently based on who holds the lock,
 * and exposes a release/acquire toggle so the user can voluntarily
 * step out of edit mode (or step back in).
 *
 * Four states (identical to the previous LeftRail implementation):
 *   1. Loading (status === null) → small placeholder
 *   2. I hold it → timer + [Release] button
 *   3. No active lock (I released, or expired) → "unlocked" + [Lock] button
 *   4. Someone else holds it → warning color + holder, no button (can't steal)
 */
function LockToggle({
  status,
  onRelease,
  onAcquire,
}: {
  status: LockStatus | null;
  onRelease: () => void;
  onAcquire: () => void;
}) {
  if (status === null) {
    return (
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5">
        …
      </span>
    );
  }

  // No active lock — user released voluntarily or lock expired.
  if (!status.lockedByAuthId || !status.expiresAt) {
    return (
      <span className="inline-flex items-center gap-[10px]">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5">
          Lock
        </span>
        <span className="text-t5 italic font-editorial text-[12px]">
          unlocked
        </span>
        <button
          type="button"
          onClick={onAcquire}
          className="font-mono text-[9px] tracking-[0.22em] uppercase text-t3 hover:text-t1 transition-colors px-[8px] py-[3px] border border-rule-2 rounded-sm hover:border-[rgba(var(--d),0.5)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          aria-label="Acquire edit lock on this signal"
        >
          Lock
        </button>
      </span>
    );
  }

  const timeLeft = formatTimeLeft(status.expiresAt);

  if (status.heldByMe) {
    return (
      <span className="inline-flex items-center gap-[10px]">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5">
          Lock
        </span>
        <span className="text-t4 text-[11px]">
          you · <span className="text-t2">{timeLeft}</span>
        </span>
        <button
          type="button"
          onClick={onRelease}
          className="font-mono text-[9px] tracking-[0.22em] uppercase text-t3 hover:text-t1 transition-colors px-[8px] py-[3px] border border-rule-2 rounded-sm hover:border-[rgba(var(--d),0.5)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          aria-label="Release edit lock on this signal"
        >
          Release
        </button>
      </span>
    );
  }

  // Someone else — lean warning color, no button (no stealing).
  const holder = status.lockedByEmail ?? "someone";
  const shortHolder = holder.includes("@") ? holder.split("@")[0] : holder;
  return (
    <span className="inline-flex items-center gap-[10px]">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t5">
        Lock
      </span>
      <span className="text-[#d4908a] text-[11px]">
        {shortHolder} · {timeLeft}
      </span>
    </span>
  );
}

function formatTimeLeft(expiresAt: Date): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s left`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m left`;
  const hr = Math.floor(min / 60);
  return `${hr}h left`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-[10px] shrink-0">
      {children}
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between py-[6px] border-b border-rule-1 last:border-b-0 text-[11px]">
      <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-t5">
        {k}
      </span>
      <span className="text-t2" style={{ fontFeatureSettings: '"tnum"' }}>
        {v}
      </span>
    </div>
  );
}

function collectionCountsText(
  signalCount: number,
  candidateCount: number,
): string {
  const parts: string[] = [];
  if (signalCount > 0) parts.push(`${signalCount} pipeline`);
  if (candidateCount > 0) parts.push(`${candidateCount} triage`);
  return parts.length > 0 ? parts.join(" · ") : "empty";
}

function formatDate(date: Date): string {
  // Locale pinned to en-US — matches codebase convention (profile page)
  // and keeps SSR/CSR agreement. See LeftRail history for the
  // hydration-mismatch background.
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
