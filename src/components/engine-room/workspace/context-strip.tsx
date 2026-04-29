"use client";

import Link from "next/link";
import { useState } from "react";
import type { signals, collections } from "@/db/schema";
import type { LockStatus } from "@/lib/actions/signal-locks";

/**
 * Context strip — Phase 9.5 unified header.
 *
 * Phase 7 introduced this as a horizontal collapsible strip riding
 * BELOW the title section (which lived in WorkspaceFrame as its own
 * `pl-7 pr-11 pt-5 pb-6` region). Phase 9.5 merges those two:
 * shortcode + working title now live in the strip's collapsed row,
 * and the collection identification (name + type + counts) gets
 * pushed to the expanded body. Reasoning from Inba's walkthrough:
 * two strips at the top read as visual clutter, and the collapsed-
 * row collection line ("From Collection 9 to 5 is a joke · Scheduled
 * · 8 pipeline · 2 triage") was carrying information the user only
 * reaches for when they're orienting — perfect for one-click expand.
 *
 * Layout responsibility:
 *   This is now THE workspace header. Nothing else sits above the
 *   tab strip. WorkspaceFrame removes its own title section and
 *   relies on this component as the top-of-page identity surface.
 *
 * Two states:
 *
 *   Collapsed (default, ~76px) — renders every page load:
 *     [shortcode]  [working title]                       [lock] [chevron]
 *
 *   Expanded (user-expanded) — adds below the title row:
 *     [collection mini-card with decade tint]
 *     [concept pull-quote]
 *     [signal meta: source / created / updated]
 *     [read-only banner if locked by other user]
 *
 * Shortcode + title sizing:
 *   - Title was 40px display medium in the old standalone strip.
 *     Reduced to 28px to fit a single-row strip without making the
 *     header dominate the viewport. Still display medium, still
 *     reads as identity-anchor weight.
 *   - Shortcode kept at 12.5px display bold tracked uppercase —
 *     the orientation marker, not the eye-anchor. Lives to the
 *     left of the title at baseline alignment.
 *
 * Decade tint: still flows from the workspace root's `t-{type}`
 * class (set in WorkspaceFrame). The strip reads `var(--d)` for
 * the lock-toggle hover border, the chevron focus ring, and the
 * expanded collection mini-card's left border.
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
      aria-label="Signal header"
      className="pl-7 pr-11 border-b border-rule-1 bg-wash-1"
    >
      {/* Collapsed row — identity. Shortcode + working title on the
          left; lock toggle + expand chevron on the right. The full
          row sits at min-h-[76px] with py-4 to give the 28px title
          enough breathing room above and below. items-baseline keeps
          the shortcode tracking-uppercase glyphs sharing the title's
          baseline for an editorial-newspaper read. */}
      <div className="flex items-center justify-between gap-6 min-h-[76px] py-4">
        <div className="flex items-baseline gap-7 min-w-0">
          <span className="font-display font-bold text-[12.5px] tracking-[0.18em] uppercase text-t1 shrink-0">
            {signal.shortcode}
          </span>
          <h1 className="font-display font-medium text-[28px] -tracking-[0.012em] leading-[1.1] text-t1 truncate">
            {signal.workingTitle}
          </h1>
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
              gridTemplateColumns:
                "minmax(240px, 340px) 1fr minmax(240px, 320px)",
            }}
          >
            {/* Collection mini-card — links back to Bridge. Decade tint
                on the left border reads as a subtle identity marker;
                full collection identity (name + type + counts) lives
                here in expanded body, not in the collapsed row.
                Collapsed row stays focused on signal identity alone. */}
            {collection ? (
              <Link
                href="/engine-room"
                className="block p-[14px_14px_14px_16px] border border-rule-2 rounded-sm bg-[rgba(var(--d),0.028)] hover:bg-[rgba(var(--d),0.048)] transition-colors"
                style={{
                  borderLeftWidth: 2,
                  borderLeftColor: accentBorder,
                }}
              >
                <Label>From Collection</Label>
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
                <Label>Origin</Label>
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

            {/* Signal meta grid — source, created, updated.
                Phase 9.5 dropped the Shortcode row from this grid: it's
                now in the collapsed-row identity strip above, so showing
                it again here was redundant and made the meta grid feel
                top-heavy with a duplicated key glyph. */}
            <div>
              <Label>Signal</Label>
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

/**
 * `<Label>` — stacked variant used in the expanded-body columns
 * (label sits above its content, so carries a bottom margin).
 */
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
