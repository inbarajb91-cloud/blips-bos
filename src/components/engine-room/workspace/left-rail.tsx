"use client";

import Link from "next/link";
import type { signals, collections } from "@/db/schema";
import type { LockStatus } from "@/lib/actions/signal-locks";

/**
 * Left rail — collection context + pipeline pips + signal meta.
 *
 * Lives on the left edge of the workspace; collapsible via the
 * `<WorkspaceFrame>` toggle. When collapsed, the rail content fades
 * out but the collection's decade tint stays visible as a thin strip
 * on the rail's inner edge so the user can still see which collection
 * this signal belongs to.
 *
 * Mini-collection card links back to Bridge scrolled to that collection
 * (once Bridge supports deep-linking to a specific collection — for now
 * just back to /engine-room).
 */
export function LeftRail({
  signal,
  collection,
  lockStatus,
  onReleaseLock,
  onAcquireLock,
}: {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
  lockStatus: LockStatus | null;
  /** Release the lock voluntarily. No-op if the current user isn't the
   *  holder. The button in the lock row calls this. */
  onReleaseLock: () => void;
  /** Re-acquire a previously-released lock. Only available when the
   *  signal has no active lock (user released, or it expired). */
  onAcquireLock: () => void;
}) {
  return (
    <div className="p-[32px_28px] space-y-7">
      {collection ? (
        <>
          <Label>From Collection</Label>
          <Link
            href="/engine-room"
            className={`block p-[14px_14px_14px_16px] border border-rule-2 rounded-sm bg-[rgba(var(--d),0.028)] hover:bg-[rgba(var(--d),0.048)] transition-colors mb-7 t-${collection.type}`}
            style={{
              borderLeftWidth: 2,
              borderLeftColor: "rgba(var(--d), 0.65)",
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
        </>
      ) : (
        <>
          <Label>Signal origin</Label>
          <div className="p-[14px_16px] border border-rule-1 rounded-sm bg-wash-1 mb-7">
            <div className="font-editorial italic text-[13.5px] text-t4">
              Direct submission · no parent collection
            </div>
          </div>
        </>
      )}

      {signal.concept && (
        <div>
          <Label>Concept</Label>
          <p className="font-editorial italic text-[15px] leading-[1.5] text-t2 mb-7">
            &ldquo;{signal.concept}&rdquo;
          </p>
        </div>
      )}

      {/* Previously rendered a "Pipeline Progress" row with StagePips
          + a stage label. Removed — the AgentTabStrip at the top of
          the canvas already shows all six stages with their breathing
          underline + completed/active/future dot states, so the rail
          row was restating the same information three inches away. */}

      <div>
        <Label>Signal</Label>
        <MetaRow k="Shortcode" v={signal.shortcode} />
        <MetaRow k="Source" v={signal.source} />
        <MetaRow k="Created" v={formatDate(signal.createdAt)} />
        <MetaRow k="Updated" v={formatDate(signal.updatedAt)} />
        {/* Lock row — live status from signal_locks, with interactive
            release/acquire toggle.
            - Still loading (lockStatus null) → "…" placeholder
            - Held by me → muted timer + [Release] button
            - Released by me (no active lock) → "unlocked" + [Lock] button
            - Held by someone else → warning color + holder name, no button */}
        <MetaRow
          k="Lock"
          v={
            <LockToggle
              status={lockStatus}
              onRelease={onReleaseLock}
              onAcquire={onAcquireLock}
            />
          }
        />
      </div>

      {/* Read-only banner — appears when the lock is held by someone
          else. Phase 7 + 8 will wire editable affordances (ORC send,
          stage-approve); the banner preempts them with a visible
          explanation so the user knows why things are disabled.
          Gating (post-CodeRabbit): trigger on "someone else holds an
          active lock" (lockedByAuthId present + heldByMe false) — NOT
          on lockedByEmail. Email can be null (users table join missed,
          deleted user, not-yet-provisioned auth row) and in that case
          the user still deserves an explanation for why edits are
          disabled. We fall back to a generic identity string so the
          banner never disappears when the condition that triggers it
          is active. */}
      {lockStatus &&
        !lockStatus.heldByMe &&
        lockStatus.lockedByAuthId && (
          <div className="mt-6 p-[12px_14px] border border-[#d4908a]/30 bg-[#a04040]/10 rounded-sm">
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
  );
}

// ─── Presentational helpers ────────────────────────────────────────

/**
 * Lock row value — renders differently based on who holds the lock,
 * and exposes a release/acquire toggle so the user can voluntarily
 * step out of edit mode (or step back in).
 *
 * Four states:
 *   1. Loading (status === null) → small placeholder
 *   2. I hold it → timer + [Release] button
 *   3. No active lock (I released, or expired) → "unlocked" + [Lock] button
 *   4. Someone else holds it → warning color + holder, no button (can't steal)
 *
 * Tiny visual detail: the button sits to the right of the status text
 * and picks up a decade-tinted border on hover to signal it's actionable
 * without shouting.
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
    return <span className="text-t5">…</span>;
  }

  // No active lock — user released voluntarily or lock expired.
  // Offer re-acquire button so they can step back into edit mode.
  if (!status.lockedByAuthId || !status.expiresAt) {
    return (
      <span className="inline-flex items-center gap-[10px]">
        <span className="text-t5 italic font-editorial text-[12px]">unlocked</span>
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
        <span className="text-t4">
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

  // Someone else — lean warning color, no button (no stealing)
  const holder = status.lockedByEmail ?? "someone";
  const shortHolder = holder.includes("@") ? holder.split("@")[0] : holder;
  return (
    <span className="text-[#d4908a]">
      {shortHolder} · {timeLeft}
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
    <div className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-[14px]">
      {children}
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2 border-b border-rule-1 last:border-b-0 text-[11px]">
      <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-t5">
        {k}
      </span>
      <span className="text-t2" style={{ fontFeatureSettings: '"tnum"' }}>
        {v}
      </span>
    </div>
  );
}

function collectionCountsText(signalCount: number, candidateCount: number): string {
  const parts: string[] = [];
  if (signalCount > 0) parts.push(`${signalCount} pipeline`);
  if (candidateCount > 0) parts.push(`${candidateCount} triage`);
  return parts.length > 0 ? parts.join(" · ") : "empty";
}


function formatDate(date: Date): string {
  // Locale pinned to en-US — two reasons:
  //   1. Determinism: `toLocaleDateString(undefined, …)` is
  //      runtime-locale dependent, so SSR (server in its TZ/locale) and
  //      client (browser in India/UK) disagreed on ordering ("Apr 23"
  //      vs. "23 Apr") and triggered a hydration mismatch.
  //   2. Codebase convention: src/app/(app)/profile/page.tsx uses
  //      "en-US" for both created_at (toLocaleDateString) and
  //      last_sign_in_at (toLocaleString). Matching that keeps date
  //      rendering consistent across screens without the reader
  //      flipping mental formats mid-session.
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
