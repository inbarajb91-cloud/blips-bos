import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import {
  db,
  signals as signalsTable,
  collections as collectionsTable,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { WorkspaceFrame } from "@/components/engine-room/workspace/workspace-frame";

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

  return <WorkspaceFrame signal={signal} collection={collection} />;
}
