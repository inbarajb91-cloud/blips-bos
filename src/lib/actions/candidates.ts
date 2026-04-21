"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, bunkerCandidates, signals } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { inngest } from "@/lib/inngest/client";
import { generateStructured } from "@/lib/ai/generate";
import { computeContentHash } from "@/lib/sources/dedup";
import { bunkerSkill } from "@/skills/bunker";

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

/**
 * Source 01 — Direct input. Founder pastes raw text into the Bridge's
 * "Submit Signal" modal; we run BUNKER extraction synchronously (user
 * expects immediate feedback), persist the candidate, return its shortcode.
 *
 * Runs synchronously (not through Inngest) because:
 *   - User is actively waiting; sub-5-second LLM call is acceptable
 *   - No scheduled batch context; no durability benefit from Inngest
 *   - Simpler UX: user sees candidate appear immediately, not "check back later"
 */
export async function submitDirectInput(rawText: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const text = rawText.trim();
  if (text.length < 50) {
    throw new Error(
      "Signal needs at least 50 characters of context for BUNKER to extract meaningfully.",
    );
  }
  const body = text.slice(0, 5000);

  // Split first line / first sentence as the title; remainder becomes body.
  // Keeps BUNKER's input shape uniform with other sources (title + body pair).
  const firstLineBreak = body.indexOf("\n");
  const firstSentenceEnd = body.search(/[.!?]\s/);
  const splitAt =
    firstLineBreak > 0 && firstLineBreak < 200
      ? firstLineBreak
      : firstSentenceEnd > 0 && firstSentenceEnd < 200
        ? firstSentenceEnd + 1
        : Math.min(150, body.length);
  const title = body.slice(0, splitAt).trim().slice(0, 200);
  const fullBody = body.slice(splitAt).trim() || title;

  const contentHash = computeContentHash({ title, body: fullBody });

  // Dedup — reject if already in triage or previously processed
  const [existing] = await db
    .select({
      id: bunkerCandidates.id,
      shortcode: bunkerCandidates.shortcode,
    })
    .from(bunkerCandidates)
    .where(
      and(
        eq(bunkerCandidates.orgId, user.orgId),
        eq(bunkerCandidates.contentHash, contentHash),
      ),
    )
    .limit(1);
  if (existing) {
    throw new Error(
      `This text was already submitted as candidate ${existing.shortcode}. Paste something new, or modify wording.`,
    );
  }

  // Run BUNKER extraction
  const result = await generateStructured({
    agentKey: "BUNKER",
    orgId: user.orgId,
    system: bunkerSkill.systemPrompt,
    prompt: bunkerSkill.buildPrompt(
      bunkerSkill.inputSchema.parse({
        source: "direct",
        title,
        body: fullBody,
      }),
    ),
    schema: bunkerSkill.outputSchema,
  });

  // Persist
  const [row] = await db
    .insert(bunkerCandidates)
    .values({
      orgId: user.orgId,
      shortcode: result.object.shortcode,
      workingTitle: result.object.working_title,
      concept: result.object.concept,
      source: "direct",
      rawText: fullBody.slice(0, 2000),
      rawMetadata: {
        source_context: result.object.source_context,
        submitted_by: user.email,
        submitted_at: new Date().toISOString(),
      },
      contentHash,
      status: "PENDING_REVIEW",
    })
    .returning({
      id: bunkerCandidates.id,
      shortcode: bunkerCandidates.shortcode,
      workingTitle: bunkerCandidates.workingTitle,
    });

  revalidatePath("/engine-room");
  return {
    shortcode: row.shortcode,
    workingTitle: row.workingTitle,
    model: result.model,
    fallbacksUsed: result.fallbacksUsed,
  };
}
