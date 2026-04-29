import { and, asc, eq, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import {
  db,
  signals as signalsTable,
  collections as collectionsTable,
  agentOutputs as agentOutputsTable,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { WorkspaceFrame } from "@/components/engine-room/workspace/workspace-frame";
import type { ParentStokerData } from "@/components/engine-room/workspace/renderers/stoker-resonance";
import type {
  ParentReference,
  ManifestationOwnDetail,
} from "@/components/engine-room/workspace/renderers/types";

export const metadata = { title: "Signal · Engine Room · BLIPS BOS" };

/**
 * Signal Workspace — Phase 7.
 *
 * Full workspace: agent tab strip (6 stages), per-stage renderer registry
 * starting with BUNKER retrospective, ORC conversation panel (stub in
 * 7A, wired in 7D), collection context rail (left), resizable right
 * panel. Replaces the Phase 6.5 lightweight detail view.
 *
 * This page is a Server Component — it fetches the signal + parent
 * collection once, then hands off to the client `<WorkspaceFrame>`
 * which owns all interactivity (tab state, rail collapse, resize).
 *
 * Phase 7 chunks landing incrementally on this page:
 *   - 7A (this commit): shell + tab strip + BUNKER renderer + registry
 *   - 7D: agent_conversations wiring in OrcPanel
 *   - 7E: signal_locks acquire/release + lock chip upgrade
 *   - 7F: Bridge housekeeping (doesn't touch this page)
 */
export default async function SignalPage({
  params,
}: {
  params: Promise<{ shortcode: string }>;
}) {
  const user = await getCurrentUserWithOrg();
  if (!user) redirect("/login");

  const { shortcode } = await params;
  const decoded = decodeURIComponent(shortcode);

  const [signal] = await db
    .select()
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.orgId, user.orgId),
        eq(signalsTable.shortcode, decoded),
      ),
    )
    .limit(1);

  if (!signal) notFound();

  // Load the parent collection if the signal came from one (older signals
  // pre-Phase-6.5 may not have a collection_id — nullable FK).
  let collection: typeof collectionsTable.$inferSelect | null = null;
  if (signal.collectionId) {
    const [c] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, signal.collectionId))
      .limit(1);
    collection = c ?? null;
  }

  // Phase 9D — eagerly load STOKER data for the parent's STOKER tab
  // renderer if the signal has progressed past BUNKER. Renderer convention
  // says "Renderers must not fetch data" — so the page does it once.
  //
  // Two pieces:
  //   1. Parent's own STOKER agent_outputs row (the decade_resonance
  //      JSON the 3-card grid renders from). Only present once STOKER
  //      has run; null pre-STOKER, null on raw signals that haven't
  //      advanced.
  //   2. Manifestation children (signals where parent_signal_id =
  //      this signal's id) plus each child's STOKER agent_outputs row
  //      (so the renderer knows status: PENDING / APPROVED / REJECTED
  //      and can show approved/dismissed markers per card).
  let stokerData: ParentStokerData | null = null;
  const isManifestation = signal.parentSignalId !== null;
  const stokerHasRun =
    !isManifestation &&
    [
      "IN_STOKER",
      "FANNED_OUT",
      "STOKER_REFUSED",
      "DISMISSED",
    ].includes(signal.status);

  if (stokerHasRun) {
    const [parentStokerOutputRow] = await db
      .select({
        id: agentOutputsTable.id,
        content: agentOutputsTable.content,
        status: agentOutputsTable.status,
        revisions: agentOutputsTable.revisions,
      })
      .from(agentOutputsTable)
      .where(
        and(
          eq(agentOutputsTable.signalId, signal.id),
          eq(agentOutputsTable.agentName, "STOKER"),
        ),
      )
      .orderBy(asc(agentOutputsTable.createdAt))
      .limit(1);

    if (parentStokerOutputRow) {
      const children = await db
        .select({
          id: signalsTable.id,
          shortcode: signalsTable.shortcode,
          status: signalsTable.status,
          manifestationDecade: signalsTable.manifestationDecade,
        })
        .from(signalsTable)
        .where(
          and(
            eq(signalsTable.parentSignalId, signal.id),
            eq(signalsTable.orgId, user.orgId),
          ),
        );

      // Map children's STOKER agent_outputs by signal id.
      // CR pass 1 on PR #8 caught the missing inArray filter (was
      // fetching every STOKER row in the org). CR pass 2 caught the
      // determinism issue: a child can eventually have multiple STOKER
      // outputs (e.g., post-Phase-9G restart_stoker creates a new
      // journey + new agent_outputs rows). Without an explicit order,
      // `new Map(rows.map(...))` keeps whichever row Postgres returned
      // last per signal_id — non-deterministic. Adding an ORDER BY
      // signal_id, created_at ASC and iterating to keep the EARLIEST
      // (canonical first STOKER run) per signal makes this stable.
      const childIds = children.map((c) => c.id);
      const childOutputs = childIds.length
        ? await db
            .select({
              signalId: agentOutputsTable.signalId,
              status: agentOutputsTable.status,
              content: agentOutputsTable.content,
              revisions: agentOutputsTable.revisions,
              createdAt: agentOutputsTable.createdAt,
            })
            .from(agentOutputsTable)
            .where(
              and(
                eq(agentOutputsTable.agentName, "STOKER"),
                inArray(agentOutputsTable.signalId, childIds),
              ),
            )
            .orderBy(
              asc(agentOutputsTable.signalId),
              asc(agentOutputsTable.createdAt),
            )
        : [];
      // Iterate forward and `Map.set` only on first sighting per signal
      // — earliest createdAt wins because the rows come out in
      // (signalId ASC, createdAt ASC) order.
      const outputBySignal = new Map<string, (typeof childOutputs)[number]>();
      for (const o of childOutputs) {
        if (!outputBySignal.has(o.signalId)) {
          outputBySignal.set(o.signalId, o);
        }
      }

      stokerData = {
        parentOutput: {
          id: parentStokerOutputRow.id,
          content: parentStokerOutputRow.content as Record<string, unknown>,
          status: parentStokerOutputRow.status,
        },
        children: children.map((c) => {
          const out = outputBySignal.get(c.id);
          return {
            id: c.id,
            shortcode: c.shortcode,
            status: c.status,
            decade: c.manifestationDecade as "RCK" | "RCL" | "RCD",
            outputStatus: out?.status ?? null,
            outputContent: (out?.content ?? null) as Record<
              string,
              unknown
            > | null,
          };
        }),
      };
    }
  }

  // Phase 9F — when this signal is a manifestation, fetch the parent's
  // basic info (for the inherited BUNKER banner + workspace breadcrumbs)
  // and this manifestation's own STOKER agent_outputs row (for the
  // STOKER tab's single-card detail view).
  let parentRef: ParentReference | null = null;
  let manifestationDetail: ManifestationOwnDetail | null = null;

  if (isManifestation && signal.parentSignalId) {
    const [parent] = await db
      .select({
        id: signalsTable.id,
        shortcode: signalsTable.shortcode,
        workingTitle: signalsTable.workingTitle,
        concept: signalsTable.concept,
      })
      .from(signalsTable)
      .where(
        and(
          eq(signalsTable.id, signal.parentSignalId),
          eq(signalsTable.orgId, user.orgId),
        ),
      )
      .limit(1);
    if (parent) parentRef = parent;

    const [own] = await db
      .select({
        id: agentOutputsTable.id,
        content: agentOutputsTable.content,
        status: agentOutputsTable.status,
        revisions: agentOutputsTable.revisions,
      })
      .from(agentOutputsTable)
      .where(
        and(
          eq(agentOutputsTable.signalId, signal.id),
          eq(agentOutputsTable.agentName, "STOKER"),
        ),
      )
      // CR pass on PR #8 — match the parent-side query's ordering so
      // the .limit(1) is deterministic when multiple STOKER outputs
      // exist (e.g., after a future restart_stoker tool produces a
      // second output row on a journey 2). Earliest createdAt = the
      // canonical first run for this manifestation.
      .orderBy(asc(agentOutputsTable.createdAt))
      .limit(1);
    if (own) {
      manifestationDetail = {
        id: own.id,
        content: own.content as Record<string, unknown>,
        status: own.status,
        revisionsCount: Array.isArray(own.revisions) ? own.revisions.length : 0,
      };
    }
  }

  return (
    <WorkspaceFrame
      signal={signal}
      collection={collection}
      stokerData={stokerData}
      parentRef={parentRef}
      manifestationDetail={manifestationDetail}
    />
  );
}
