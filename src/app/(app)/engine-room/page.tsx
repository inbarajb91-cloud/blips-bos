import { and, desc, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  db,
  bunkerCandidates,
  collections as collectionsTable,
  collectionRuns as collectionRunsTable,
  signals as signalsTable,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { CollectionCard } from "@/components/engine-room/collection-card";
import { CollectNowDialog } from "@/components/engine-room/collect-now-dialog";
import { SubmitSignalDialog } from "@/components/engine-room/submit-signal-dialog";
import { BridgeRealtime } from "@/components/engine-room/bridge-realtime";

export const metadata = { title: "Bridge · Engine Room · BLIPS BOS" };

/**
 * Bridge — the Engine Room's home view.
 *
 * Phase 6.5: collection-centric. Each collection is a spine with an
 * expandable body containing both:
 *   1. Triage — pending candidates awaiting approve/dismiss
 *   2. Pipeline — approved signals with 6-stage pips + link to workspace
 *
 * Stream is ordered by most-recently-updated collection first. Archived
 * collections hidden. Empty-state shows when no collections exist.
 */
export default async function BridgePage() {
  const user = await getCurrentUserWithOrg();
  if (!user) redirect("/login");

  // Four round-trips in parallel: collections, pending candidates,
  // active signals, recent collection_runs. The runs query feeds the
  // spine's secondary meta line ("0 new · 23 deduped" etc.).
  const [colRows, candRows, sigRows, runRows] = await Promise.all([
    db
      .select()
      .from(collectionsTable)
      .where(
        and(
          eq(collectionsTable.orgId, user.orgId),
          ne(collectionsTable.status, "archived"),
        ),
      )
      .orderBy(desc(collectionsTable.updatedAt)),
    db
      .select({
        id: bunkerCandidates.id,
        collectionId: bunkerCandidates.collectionId,
        shortcode: bunkerCandidates.shortcode,
        workingTitle: bunkerCandidates.workingTitle,
        concept: bunkerCandidates.concept,
        source: bunkerCandidates.source,
        createdAt: bunkerCandidates.createdAt,
      })
      .from(bunkerCandidates)
      .where(
        and(
          eq(bunkerCandidates.orgId, user.orgId),
          eq(bunkerCandidates.status, "PENDING_REVIEW"),
        ),
      )
      .orderBy(desc(bunkerCandidates.createdAt)),
    db
      .select({
        id: signalsTable.id,
        collectionId: signalsTable.collectionId,
        shortcode: signalsTable.shortcode,
        workingTitle: signalsTable.workingTitle,
        concept: signalsTable.concept,
        source: signalsTable.source,
        status: signalsTable.status,
        updatedAt: signalsTable.updatedAt,
        // Phase 9E — pull parent FK + decade tag so we can group
        // manifestation children under their parent rows.
        parentSignalId: signalsTable.parentSignalId,
        manifestationDecade: signalsTable.manifestationDecade,
      })
      .from(signalsTable)
      .where(
        and(
          eq(signalsTable.orgId, user.orgId),
          ne(signalsTable.status, "DISMISSED"),
        ),
      )
      .orderBy(desc(signalsTable.updatedAt)),
    db
      .select({
        id: collectionRunsTable.id,
        collectionId: collectionRunsTable.collectionId,
        status: collectionRunsTable.status,
        fetchedRaw: collectionRunsTable.fetchedRaw,
        deduped: collectionRunsTable.deduped,
        extracted: collectionRunsTable.extracted,
        errors: collectionRunsTable.errors,
        startedAt: collectionRunsTable.startedAt,
        completedAt: collectionRunsTable.completedAt,
        createdAt: collectionRunsTable.createdAt,
      })
      .from(collectionRunsTable)
      .where(eq(collectionRunsTable.orgId, user.orgId))
      .orderBy(desc(collectionRunsTable.createdAt)),
  ]);

  // Keep only the most recent run per collection. "Most recent" = first
  // match in the desc-by-createdAt result.
  const latestRunByCollection = new Map<string, (typeof runRows)[number]>();
  for (const run of runRows) {
    if (!latestRunByCollection.has(run.collectionId)) {
      latestRunByCollection.set(run.collectionId, run);
    }
  }

  const totalPending = candRows.length;
  const activeCollectionCount = colRows.length;
  const nextScheduled = colRows
    .filter((c) => c.type === "scheduled" && c.nextRunAt)
    .sort(
      (a, b) =>
        (a.nextRunAt?.getTime() ?? Infinity) -
        (b.nextRunAt?.getTime() ?? Infinity),
    )[0];
  // Drives the 2s poll fallback in BridgeRealtime — only polls while
  // something is actually moving. Idle Bridges don't burn refreshes.
  const hasActiveWork = colRows.some(
    (c) => c.status === "queued" || c.status === "running",
  );

  return (
    <div className="w-full max-w-[1600px] mx-auto px-6 md:px-10 lg:px-14 pt-12 pb-40">
      <BridgeRealtime hasActiveWork={hasActiveWork} />

      {/* Heading + aggregate + actions */}
      <header className="mb-10 flex items-baseline justify-between gap-8 flex-wrap">
        <div className="flex flex-col gap-4">
          <h1 className="font-display font-medium text-[32px] -tracking-[0.015em] leading-none">
            Bridge
          </h1>
          <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-t4">
            <span className="text-t2">{totalPending}</span> pending
            &nbsp;·&nbsp;
            <span className="text-t2">{activeCollectionCount}</span>{" "}
            collection{activeCollectionCount === 1 ? "" : "s"}
            {nextScheduled && nextScheduled.nextRunAt && (
              <>
                &nbsp;·&nbsp; next scheduled run{" "}
                <span className="text-t2">
                  {formatRelativeFuture(nextScheduled.nextRunAt)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2.5 items-center">
          <SubmitSignalDialog />
          <CollectNowDialog />
        </div>
      </header>

      {/* Collections stream */}
      {colRows.length === 0 ? (
        <div className="border border-dashed border-rule-2 rounded-md py-20 px-8 flex flex-col items-center gap-4 text-center">
          <p className="font-editorial italic text-t2 text-[22px] leading-tight">
            no collections yet.
          </p>
          <p className="font-mono text-[11px] tracking-[0.22em] uppercase text-t4 max-w-sm leading-relaxed">
            click <span className="text-t2">Collect now</span> to start a run ·{" "}
            <span className="text-t2">Submit signal</span> to paste one in
            directly
          </p>
        </div>
      ) : (
        <>
          <div className="font-mono text-[10px] tracking-[0.28em] uppercase text-t5 mb-3.5">
            Collections
          </div>
          <div className="flex flex-col">
            {colRows.map((c, i) => {
              const candidatesForC = candRows
                .filter((cand) => cand.collectionId === c.id)
                .map((cand) => ({
                  id: cand.id,
                  shortcode: cand.shortcode,
                  workingTitle: cand.workingTitle,
                  concept: cand.concept,
                  source: cand.source,
                  createdAt: cand.createdAt,
                }));
              // Phase 9E — manifestation children belong to the same
              // collection as their parent (the Inngest fan-out
              // inherits collectionId from parent at child creation).
              // Group children under each parent to render them
              // nested in SignalRow.
              const sigsInCollection = sigRows.filter(
                (s) => s.collectionId === c.id,
              );
              const childrenByParent = new Map<
                string,
                Array<(typeof sigRows)[number]>
              >();
              for (const s of sigsInCollection) {
                if (s.parentSignalId !== null) {
                  const arr = childrenByParent.get(s.parentSignalId) ?? [];
                  arr.push(s);
                  childrenByParent.set(s.parentSignalId, arr);
                }
              }
              const signalsForC = sigsInCollection
                .filter((s) => s.parentSignalId === null) // top-level only
                .map((s) => ({
                  id: s.id,
                  shortcode: s.shortcode,
                  workingTitle: s.workingTitle,
                  concept: s.concept,
                  source: s.source,
                  status: s.status,
                  updatedAt: s.updatedAt,
                  decade: null,
                  manifestations: (childrenByParent.get(s.id) ?? []).map(
                    (m) => ({
                      id: m.id,
                      shortcode: m.shortcode,
                      workingTitle: m.workingTitle,
                      concept: m.concept,
                      source: m.source,
                      status: m.status,
                      updatedAt: m.updatedAt,
                      decade: m.manifestationDecade as "RCK" | "RCL" | "RCD",
                      manifestations: [], // children don't have grandchildren
                    }),
                  ),
                }));
              const latestRun = latestRunByCollection.get(c.id) ?? null;
              return (
                <CollectionCard
                  key={c.id}
                  collection={{
                    id: c.id,
                    name: c.name,
                    outline: c.outline,
                    type: c.type,
                    status: c.status,
                    candidateCount: candidatesForC.length,
                    signalCount: signalsForC.length,
                    targetCount: c.targetCount,
                    cadence: c.cadence,
                    lastRunAt: c.lastRunAt,
                    nextRunAt: c.nextRunAt,
                    createdAt: c.createdAt,
                    updatedAt: c.updatedAt,
                  }}
                  latestRun={
                    latestRun
                      ? {
                          status: latestRun.status,
                          fetchedRaw: latestRun.fetchedRaw,
                          deduped: latestRun.deduped,
                          extracted: latestRun.extracted,
                          errors: latestRun.errors,
                          completedAt: latestRun.completedAt,
                        }
                      : null
                  }
                  candidates={candidatesForC}
                  signals={signalsForC}
                  defaultOpen={i === 0}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeFuture(date: Date): string {
  const ms = new Date(date).getTime() - Date.now();
  if (ms < 0) return "any minute";
  const mins = Math.floor(ms / 1000 / 60);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `in ${days}d`;
  return `in ${Math.floor(days / 30)}mo`;
}
