"use client";

import Link from "next/link";
import type { signals, collections } from "@/db/schema";
import { StagePips, type SignalStatus } from "@/components/engine-room/stage-pips";

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
}: {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
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
        <MetaRow
          k="Created"
          v={formatDate(signal.createdAt)}
        />
        <MetaRow
          k="Updated"
          v={formatDate(signal.updatedAt)}
        />
      </div>
    </div>
  );
}

// ─── Presentational helpers ────────────────────────────────────────

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
