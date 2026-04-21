import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, bunkerCandidates } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { CandidateCard } from "@/components/engine-room/candidate-card";
import { CollectButton } from "@/components/engine-room/collect-button";
import { SubmitSignalDialog } from "@/components/engine-room/submit-signal-dialog";
import { BridgeRealtime } from "@/components/engine-room/bridge-realtime";

export const metadata = { title: "Bridge · Engine Room · BLIPS BOS" };

/**
 * Bridge — the Engine Room's home view.
 *
 * Phase 6 scope:
 *   - Triage queue of PENDING_REVIEW candidates (BUNKER's output awaiting
 *     founder approve/dismiss)
 *   - "Collect now" button fires on-demand BUNKER run via Inngest
 *   - Realtime subscription invalidates the page on any candidate change,
 *     so new candidates surface live during collection
 *
 * Phase 7 adds: batch folders, signal rows with 6-stage progress,
 * ORC command panel, Source 01 direct input form.
 */
export default async function BridgePage() {
  const user = await getCurrentUserWithOrg();
  if (!user) redirect("/login");

  const pending = await db
    .select({
      id: bunkerCandidates.id,
      shortcode: bunkerCandidates.shortcode,
      workingTitle: bunkerCandidates.workingTitle,
      concept: bunkerCandidates.concept,
      source: bunkerCandidates.source,
      createdAt: bunkerCandidates.createdAt,
      rawMetadata: bunkerCandidates.rawMetadata,
    })
    .from(bunkerCandidates)
    .where(
      and(
        eq(bunkerCandidates.orgId, user.orgId),
        eq(bunkerCandidates.status, "PENDING_REVIEW"),
      ),
    )
    .orderBy(desc(bunkerCandidates.createdAt));

  return (
    <div className="w-full max-w-[1800px] mx-auto px-6 md:px-10 lg:px-14 pt-10 pb-16">
      <BridgeRealtime />

      <header className="mb-10 flex items-end justify-between gap-6 flex-wrap">
        <div className="max-w-2xl">
          <h1 className="font-display text-2xl font-semibold leading-tight">
            Bridge
          </h1>
          <p className="font-mono text-xs text-warm-muted mt-2 leading-relaxed">
            Pipeline overview. Triage queue below shows signals BUNKER pulled
            in — approve to enter the pipeline, dismiss to park.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CollectButton />
          <SubmitSignalDialog />
        </div>
      </header>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-mono text-[10px] tracking-[0.25em] uppercase text-warm-muted">
            Triage Queue
          </h2>
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-warm-muted">
            {pending.length} pending
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="border border-dashed border-deep-divider rounded-md py-16 px-8 flex flex-col items-center gap-3 text-center">
            <p className="font-editorial italic text-warm-bright text-xl">
              No candidates waiting.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-warm-muted">
              Click <span className="text-warm-bright">Collect now</span> to
              run BUNKER · New candidates will stream in live
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((c) => (
              <CandidateCard
                key={c.id}
                id={c.id}
                shortcode={c.shortcode}
                workingTitle={c.workingTitle}
                concept={c.concept}
                source={c.source}
                createdAt={new Date(c.createdAt)}
                rawMetadata={
                  c.rawMetadata as Record<string, unknown> | null
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
