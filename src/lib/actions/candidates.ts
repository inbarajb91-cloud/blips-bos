"use server";

import { and, eq, like, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, bunkerCandidates, collections, signals } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { inngest } from "@/lib/inngest/client";
import { generateStructured } from "@/lib/ai/generate";
import { computeContentHash } from "@/lib/sources/dedup";
import { bunkerSkill } from "@/skills/bunker";
import { createInitialJourney } from "@/lib/orc/journey";
import { resolveShortcode } from "@/lib/signals/resolve-shortcode";

/**
 * DB-backed shortcode resolution. Queries existing shortcodes in this
 * org that match `base` or `base-N`, hands the resulting set to the
 * pure `resolveShortcode` helper.
 *
 * Pre-CodeRabbit-pass-1, the resolver logic was inlined here AND
 * reimplemented in scripts/phase-8-evals.ts. The eval could pass even
 * if the runtime version diverged. Extracting the pure function to
 * src/lib/signals/resolve-shortcode.ts gives both callers one source
 * of truth.
 *
 * 2026-04-25 fix: replaced the long-standing TODO(phase-6-polish)
 * after Inba hit a server error trying to approve "Golden Handcuffs
 * Of Home" (shortcode ROOTS) when ROOTS was already an active signal.
 */
async function resolveAvailableShortcode(
  base: string,
  orgId: string,
): Promise<string> {
  const rows = await db
    .select({ shortcode: signals.shortcode })
    .from(signals)
    .where(
      and(
        eq(signals.orgId, orgId),
        or(
          eq(signals.shortcode, base),
          like(signals.shortcode, `${base}-%`),
        ),
      ),
    );

  const taken = new Set(rows.map((r) => r.shortcode));
  return resolveShortcode(base, taken);
}

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

  // Resolve a unique shortcode for the new signal. BUNKER may have
  // produced a shortcode that's already taken (e.g. multiple themed
  // candidates in different runs converging on ROOTS / CLOCK / LEGACY).
  // resolveAvailableShortcode queries existing signals in this org and
  // returns the base if free, or base-2/-3/... otherwise.
  const finalShortcode = await resolveAvailableShortcode(
    candidate.shortcode,
    user.orgId,
  );

  // Atomic claim + signal creation in one transaction. Three things
  // must succeed-or-fail together:
  //   1. Claim the candidate (UPDATE PENDING_REVIEW → APPROVED) —
  //      the WHERE includes status='PENDING_REVIEW' so a concurrent
  //      approve loses the race; if RETURNING is empty we throw to
  //      roll the txn back. Pre-CodeRabbit-pass-1, this UPDATE happened
  //      AFTER the signal insert as a separate statement, which left a
  //      window where two concurrent approves could each insert a
  //      signal from the same candidate. Now the claim happens first
  //      and atomically.
  //   2. Insert the signal with the resolved unique shortcode.
  //   3. Create Journey 1 (every signal is born with an active journey
  //      so all downstream writes have a journeyId FK).
  //
  // If the shortcode still races at INSERT (resolveAvailableShortcode
  // is outside the txn — two approves can pick the same suffix), the
  // 23505 catch retries once with a fresh resolve.
  let signal: { id: string };
  try {
    signal = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(bunkerCandidates)
        .set({ status: "APPROVED" })
        .where(
          and(
            eq(bunkerCandidates.id, candidateId),
            eq(bunkerCandidates.orgId, user.orgId),
            eq(bunkerCandidates.status, "PENDING_REVIEW"),
          ),
        )
        .returning({ id: bunkerCandidates.id });

      if (!claimed) {
        throw new Error(
          "Candidate is no longer pending review (already approved or dismissed by another request)",
        );
      }

      const [createdSignal] = await tx
        .insert(signals)
        .values({
          orgId: user.orgId,
          shortcode: finalShortcode,
          workingTitle: candidate.workingTitle,
          concept: candidate.concept,
          source: candidate.source,
          rawText: candidate.rawText,
          rawMetadata: candidate.rawMetadata,
          collectionId: candidate.collectionId ?? null,
          status: "IN_BUNKER",
        })
        .returning({ id: signals.id });

      await createInitialJourney(
        { signalId: createdSignal.id, createdBy: user.authId },
        tx,
      );

      return createdSignal;
    });
  } catch (e) {
    // Race case: two approves picked the same finalShortcode between
    // resolveAvailableShortcode() and the INSERT. Postgres unique
    // violation = error code 23505. Retry once with a fresh resolve;
    // if it still fails, surface a clean error rather than a 500.
    // Note: if the candidate-claim race lost (someone else approved
    // first), the thrown Error from inside the txn lands here too —
    // we re-throw it because there's no shortcode collision to retry.
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "23505"
    ) {
      const retryShortcode = await resolveAvailableShortcode(
        candidate.shortcode,
        user.orgId,
      );
      signal = await db.transaction(async (tx) => {
        // Re-claim defensively — if first txn's claim succeeded but
        // the insert failed on shortcode collision, the candidate is
        // already APPROVED. This second claim handles the "first
        // attempt claimed; this is a clean retry" path.
        const [claimed] = await tx
          .update(bunkerCandidates)
          .set({ status: "APPROVED" })
          .where(
            and(
              eq(bunkerCandidates.id, candidateId),
              eq(bunkerCandidates.orgId, user.orgId),
              // Accept both PENDING_REVIEW (first claim was rolled
              // back with the failed insert) and APPROVED (first
              // claim committed before the insert failure).
            ),
          )
          .returning({ id: bunkerCandidates.id });

        if (!claimed) {
          throw new Error(
            "Candidate vanished during retry — manual investigation needed",
          );
        }

        const [createdSignal] = await tx
          .insert(signals)
          .values({
            orgId: user.orgId,
            shortcode: retryShortcode,
            workingTitle: candidate.workingTitle,
            concept: candidate.concept,
            source: candidate.source,
            rawText: candidate.rawText,
            rawMetadata: candidate.rawMetadata,
            collectionId: candidate.collectionId ?? null,
            status: "IN_BUNKER",
          })
          .returning({ id: signals.id });

        await createInitialJourney(
          { signalId: createdSignal.id, createdBy: user.authId },
          tx,
        );

        return createdSignal;
      });
    } else {
      throw e;
    }
  }

  // Update aggregate counters on the collection.
  // Subqueries include org_id even though collection_id is UUID-unique
  // globally — these actions use the service-role connection which bypasses
  // RLS, so defense-in-depth keeps multi-tenant safe.
  if (candidate.collectionId) {
    await db
      .update(collections)
      .set({
        candidateCount: sql`(SELECT count(*) FROM bunker_candidates WHERE collection_id = ${candidate.collectionId} AND org_id = ${user.orgId} AND status = 'PENDING_REVIEW')`,
        signalCount: sql`(SELECT count(*) FROM signals WHERE collection_id = ${candidate.collectionId} AND org_id = ${user.orgId})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(collections.id, candidate.collectionId),
          eq(collections.orgId, user.orgId),
        ),
      );
  }

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
 * Get-or-create the per-org "Direct submissions" singleton collection.
 * Race-safe: two concurrent calls will both enter, one will insert, the
 * other will hit the partial unique index + re-fetch the existing row.
 */
async function findOrCreateDirectSubmissions(
  orgId: string,
  userId: string,
): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(
      and(
        eq(collections.orgId, orgId),
        eq(collections.name, "Direct submissions"),
      ),
    )
    .limit(1);
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(collections)
      .values({
        orgId,
        name: "Direct submissions",
        outline:
          "Signals you pasted in directly. One ongoing bucket so nothing lives homeless.",
        type: "scheduled",
        targetCount: 100,
        cadence: "custom",
        cadenceCron: "never", // never auto-fires; grows only via direct input
        status: "idle",
        createdBy: userId,
      })
      .returning({ id: collections.id });
    return created;
  } catch (e) {
    // Unique violation — concurrent insert won. Re-select.
    const [raced] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(
        and(
          eq(collections.orgId, orgId),
          eq(collections.name, "Direct submissions"),
        ),
      )
      .limit(1);
    if (!raced) throw e;
    return raced;
  }
}

/**
 * Dismiss a candidate. Status set to DISMISSED (kept, not deleted).
 * Also refreshes parent collection's pending count.
 */
export async function dismissCandidate(candidateId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const [candidate] = await db
    .select({ collectionId: bunkerCandidates.collectionId })
    .from(bunkerCandidates)
    .where(
      and(
        eq(bunkerCandidates.id, candidateId),
        eq(bunkerCandidates.orgId, user.orgId),
      ),
    )
    .limit(1);

  await db
    .update(bunkerCandidates)
    .set({ status: "DISMISSED" })
    .where(
      and(
        eq(bunkerCandidates.id, candidateId),
        eq(bunkerCandidates.orgId, user.orgId),
      ),
    );

  if (candidate?.collectionId) {
    await db
      .update(collections)
      .set({
        candidateCount: sql`(SELECT count(*) FROM bunker_candidates WHERE collection_id = ${candidate.collectionId} AND org_id = ${user.orgId} AND status = 'PENDING_REVIEW')`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(collections.id, candidate.collectionId),
          eq(collections.orgId, user.orgId),
        ),
      );
  }

  revalidatePath("/engine-room");
}

/**
 * Legacy on-demand BUNKER fire. Phase 6.5 replaces this with the full
 * createCollection flow (see @/lib/actions/collections.ts). Kept for
 * backward-compat — any old callers still fire the generic event.
 */
export async function triggerCollect() {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  await inngest.send({
    name: "bunker.collection.on_demand",
    data: { orgId: user.orgId },
  });

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

  // Phase 6.5: direct inputs flow into a singleton "Direct submissions"
  // collection — find-or-create. The partial unique index in the migration
  // on (org_id, name) WHERE name IN (...) makes concurrent creates safe:
  // the SECOND insert gets a unique violation and we re-fetch.
  const directCol = await findOrCreateDirectSubmissions(user.orgId, user.authId);

  const [row] = await db
    .insert(bunkerCandidates)
    .values({
      orgId: user.orgId,
      collectionId: directCol.id,
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

  // Refresh the Direct-submissions collection's pending count.
  await db
    .update(collections)
    .set({
      candidateCount: sql`(SELECT count(*) FROM bunker_candidates WHERE collection_id = ${directCol.id} AND org_id = ${user.orgId} AND status = 'PENDING_REVIEW')`,
      updatedAt: new Date(),
    })
    .where(
      and(eq(collections.id, directCol.id), eq(collections.orgId, user.orgId)),
    );

  revalidatePath("/engine-room");
  return {
    shortcode: row.shortcode,
    workingTitle: row.workingTitle,
    model: result.model,
    fallbacksUsed: result.fallbacksUsed,
  };
}
