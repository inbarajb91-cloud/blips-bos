"use client";

import Link from "next/link";
import type { signals, collections } from "@/db/schema";
import { StagePips, type SignalStatus } from "@/components/engine-room/stage-pips";
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
}: {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
  lockStatus: LockStatus | null;
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

      <Label>Pipeline Progress</Label>
      <div className="flex items-center gap-2 mb-7">
        <StagePips
          status={signal.status as SignalStatus}
          size={6}
          showLabel={false}
        />
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t3 ml-1">
          {stageLabelFor(signal.status as SignalStatus)}
        </span>
      </div>

      <div>
        <Label>Signal</Label>
        <MetaRow k="Shortcode" v={signal.shortcode} />
        <MetaRow k="Source" v={signal.source} />
        <MetaRow k="Created" v={formatDate(signal.createdAt)} />
        <MetaRow k="Updated" v={formatDate(signal.updatedAt)} />
        {/* Lock row — live status from signal_locks.
            - Still loading (lockStatus null) → small "…" placeholder
            - Held by current user → muted timer ("you · 28m left")
            - Held by someone else → prominent warning ("Sarah · 22m left")
            - No lock (shouldn't happen while mounted but defensive) → em dash */}
        <MetaRow k="Lock" v={<LockValue status={lockStatus} />} />
      </div>

      {/* Read-only banner — appears when the lock is held by someone
          else. Phase 7 + 8 will wire editable affordances (ORC send,
          stage-approve); the banner preempts them with a visible
          explanation so the user knows why things are disabled. */}
      {lockStatus && !lockStatus.heldByMe && lockStatus.lockedByEmail && (
        <div className="mt-6 p-[12px_14px] border border-[#d4908a]/30 bg-[#a04040]/10 rounded-sm">
          <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-[#d4908a] mb-1">
            Read-only
          </div>
          <p className="font-editorial italic text-[13.5px] leading-[1.5] text-t3">
            {lockStatus.lockedByEmail} is currently editing this signal.
            You can view — edits unlock when their session ends or the
            lock expires.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Presentational helpers ────────────────────────────────────────

/**
 * Lock row value — renders differently based on who holds the lock.
 * Self-lock is quiet (your own name + timer), other-lock is louder
 * (warning color on holder's name + timer).
 */
function LockValue({ status }: { status: LockStatus | null }) {
  if (status === null) {
    return <span className="text-t5">…</span>;
  }
  if (!status.lockedByAuthId || !status.expiresAt) {
    // Shouldn't happen in mounted workspace (we acquire on mount) but
    // covers the fail-soft branch where acquire threw.
    return <span className="text-t5">—</span>;
  }

  const timeLeft = formatTimeLeft(status.expiresAt);

  if (status.heldByMe) {
    return (
      <span className="text-t4">
        you · <span className="text-t2">{timeLeft}</span>
      </span>
    );
  }

  // Someone else — lean warning color
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

function stageLabelFor(status: SignalStatus): string {
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
    default:
      return status;
  }
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
