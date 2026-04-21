"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, bunkerCandidates, signals } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { inngest } from "@/lib/inngest/client";

/**
 * Approve a BUNKER candidate.
 *
 *  1. Load + scope-check candidate against current user's org
 *  2. Create a `signals` row from the candidate (shortcode, title, concept
 *     copied over; status IN_BUNKER until STOKER advances it)
 *  3. Mark the candidate APPROVED (kept for audit, not deleted)
 *  4. Fire `bunker.candidate.approved` event — STOKER Phase 9 will handle
 *  5. Revalidate Bridge so the triage queue updates
 */
export async function approveCandidate(candidateId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const [candidate] = await db
    .select()
    .from(bunkerCandidates)
    .where(
      and(
        eq(bunkerCandidates.id, candidateId),
        eq(bunkerCandidates.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!candidate) throw new Error("Candidate not found");
  if (candidate.status !== "PENDING_REVIEW") {
    throw new Error(`Candidate is ${candidate.status}, cannot approve`);
  }

  // Create signal row. If shortcode collision, append digit suffix.
  // TODO(phase-6-polish): proper shortcode collision resolution
  const [signal] = await db
    .insert(signals)
    .values({
      orgId: user.orgId,
      shortcode: candidate.shortcode,
      workingTitle: candidate.workingTitle,
      concept: candidate.concept,
      source: candidate.source,
      rawText: candidate.rawText,
      rawMetadata: candidate.rawMetadata,
      status: "IN_BUNKER",
    })
    .returning({ id: signals.id });

  await db
    .update(bunkerCandidates)
    .set({ status: "APPROVED" })
    .where(eq(bunkerCandidates.id, candidateId));

  // Fire event — STOKER handler will pick it up in Phase 9
  await inngest.send({
    name: "bunker.candidate.approved",
    data: {
      orgId: user.orgId,
      candidateId,
      signalId: signal.id,
    },
  });

  revalidatePath("/engine-room");
  return { signalId: signal.id };
}

/**
 * Dismiss a candidate. Status set to DISMISSED (kept, not deleted).
 */
export async function dismissCandidate(candidateId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  await db
    .update(bunkerCandidates)
    .set({ status: "DISMISSED" })
    .where(
      and(
        eq(bunkerCandidates.id, candidateId),
        eq(bunkerCandidates.orgId, user.orgId),
      ),
    );

  revalidatePath("/engine-room");
}

/**
 * Trigger on-demand BUNKER collection from the Bridge "Collect now" button.
 * Returns fast — actual collection runs in the background via Inngest.
 */
export async function triggerCollect() {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  await inngest.send({
    name: "bunker.collection.on_demand",
    data: { orgId: user.orgId },
  });

  // Revalidate so the UI eventually picks up new candidates (realtime
  // subscription will also invalidate, but this is the belt-and-suspenders).
  revalidatePath("/engine-room");
}
