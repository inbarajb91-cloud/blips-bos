"use server";

import { and, eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  db,
  signals as signalsTable,
  agentOutputs,
  decisionHistory,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";

/**
 * BOILER server actions — Phase 11E.
 *
 * Per-gallery actions invoked from the workspace's BOILER tab renderer
 * (and ORC tools). The gallery lives as one agent_outputs row on the
 * manifestation child signal: agent_name='BOILER',
 * output_type='boiler_gallery', content=<gallery JSONB>, status=PENDING
 * until founder picks a variant.
 *
 * Two terminal paths:
 *   1. Approve one variant → status=APPROVED + content.approvedVariantSlug
 *      set + manifestation IN_BOILER → IN_ENGINE + engine.ready event
 *      fires (Phase 12 picks up).
 *   2. Dismiss → status=REJECTED + manifestation BOILER_REFUSED. The
 *      manifestation is dead from BOILER's perspective; founder can
 *      still re-run by editing the FURNACE brief past gate (cascade
 *      detection in Phase 11F).
 *
 * Phase 11E ships approve + dismiss + chat-suggestion chips. Variant /
 * gallery regen tools are deferred to Phase 11E.1 (need a `boiler.regenerate`
 * event the handler doesn't listen for yet — small follow-up to wire).
 *
 * RLS scoping: every action joins agent_outputs to signals.org_id since
 * agent_outputs has no direct org_id column (it scopes through the parent
 * signal). Same pattern as FURNACE actions.
 */

interface GalleryRow {
  id: string;
  signalId: string;
  status: string;
  content: Record<string, unknown>;
  revisions: Array<Record<string, unknown>>;
  childShortcode: string;
  childStatus: string;
  parentSignalId: string | null;
}

/** Load the gallery row + manifestation context, scoped to the user's org. */
async function loadGalleryScoped(opts: {
  galleryId: string;
  orgId: string;
}): Promise<GalleryRow> {
  const [row] = await db
    .select({
      id: agentOutputs.id,
      signalId: agentOutputs.signalId,
      status: agentOutputs.status,
      content: agentOutputs.content,
      revisions: agentOutputs.revisions,
      childShortcode: signalsTable.shortcode,
      childStatus: signalsTable.status,
      parentSignalId: signalsTable.parentSignalId,
    })
    .from(agentOutputs)
    .innerJoin(signalsTable, eq(agentOutputs.signalId, signalsTable.id))
    .where(
      and(
        eq(agentOutputs.id, opts.galleryId),
        eq(agentOutputs.agentName, "BOILER"),
        eq(signalsTable.orgId, opts.orgId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error("BOILER gallery not found.");
  }
  return {
    id: row.id,
    signalId: row.signalId,
    status: row.status,
    content: (row.content ?? {}) as Record<string, unknown>,
    revisions: Array.isArray(row.revisions)
      ? (row.revisions as Array<Record<string, unknown>>)
      : [],
    childShortcode: row.childShortcode,
    childStatus: row.childStatus,
    parentSignalId: row.parentSignalId,
  };
}

/** Revalidate the manifestation + Bridge + parent paths after a write. */
async function revalidateGalleryPaths(gallery: GalleryRow): Promise<void> {
  revalidatePath(`/engine-room/signals/${gallery.childShortcode}`);
  revalidatePath("/engine-room");
  if (gallery.parentSignalId) {
    const [parent] = await db
      .select({ shortcode: signalsTable.shortcode })
      .from(signalsTable)
      .where(eq(signalsTable.id, gallery.parentSignalId))
      .limit(1);
    if (parent) revalidatePath(`/engine-room/signals/${parent.shortcode}`);
  }
}

// ─── Approve one variant — pick the concept ──────────────────────

interface BoilerVariantContent {
  variantSlug: string;
}

/**
 * Approve a single concept variant from the gallery. This is the
 * "Pick this concept" CTA on the renderer + ORC's approve_boiler_variant
 * tool target.
 *
 * Side effects:
 *   1. agent_outputs.content.approvedVariantSlug = variantSlug
 *   2. agent_outputs.status = APPROVED
 *   3. signals.status = IN_ENGINE (advancing manifestation past BOILER gate)
 *   4. decision_history row recorded
 *   5. engine.ready event fires (no listener until Phase 12; that's fine
 *      — the event is queued in Inngest and Phase 12's handler will
 *      replay-from-history when it ships).
 */
export async function approveBoilerVariant(opts: {
  galleryId: string;
  variantSlug: string;
}): Promise<{
  ok: true;
  manifestationShortcode: string;
  approvedVariantSlug: string;
}> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const gallery = await loadGalleryScoped({
    galleryId: opts.galleryId,
    orgId: user.orgId,
  });

  if (gallery.status !== "PENDING") {
    throw new Error(
      `Gallery is at status ${gallery.status} — variant approval is only valid at PENDING. ` +
        `Use ORC's regenerate_boiler_gallery (Phase 11E.1) to revise an APPROVED gallery.`,
    );
  }

  // Refused galleries have no variants — guard the picker
  const refused = gallery.content.refused === true;
  if (refused) {
    throw new Error(
      "Gallery was refused by BOILER — there are no variants to pick. ORC can dismiss the manifestation or you can edit the FURNACE brief past gate.",
    );
  }

  // Validate variantSlug exists in the variants array. Also picks up the
  // typo case ("varient-1") cleanly.
  const variants = (gallery.content.variants ?? []) as BoilerVariantContent[];
  if (variants.length === 0) {
    throw new Error("Gallery has no variants — cannot approve.");
  }
  const matched = variants.find((v) => v.variantSlug === opts.variantSlug);
  if (!matched) {
    const slugs = variants.map((v) => v.variantSlug).join(", ");
    throw new Error(
      `Variant '${opts.variantSlug}' not found in gallery. Available: ${slugs}.`,
    );
  }

  // Look up the active journey for decision_history. Same pattern as
  // FURNACE dismiss action — fail-soft if no journey (every signal has
  // one per Phase 8 architecture; defensive guard).
  const { journeys } = await import("@/db/schema");
  const [activeJourney] = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      and(
        eq(journeys.signalId, gallery.signalId),
        eq(journeys.status, "active"),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .update(agentOutputs)
      .set({
        status: "APPROVED",
        approvedBy: user.authId,
        approvedAt: new Date(),
        content: {
          ...gallery.content,
          approvedVariantSlug: opts.variantSlug,
          approvedAt: new Date().toISOString(),
        },
      })
      .where(eq(agentOutputs.id, gallery.id));

    await tx
      .update(signalsTable)
      .set({ status: "IN_ENGINE", updatedAt: new Date() })
      .where(eq(signalsTable.id, gallery.signalId));

    if (activeJourney) {
      await tx.insert(decisionHistory).values({
        orgId: user.orgId,
        signalId: gallery.signalId,
        journeyId: activeJourney.id,
        agentName: "BOILER",
        decision: "variant_approved",
        reason: `Picked ${opts.variantSlug} → advancing to ENGINE Step 1.`,
        decidedBy: user.authId,
      });
    }
  });

  // Fire engine.ready — Phase 12 ENGINE handler will pick this up when
  // it ships. Best-effort send; manifestation is at IN_ENGINE in DB
  // regardless and Inngest replays unhandled events when the function
  // registers later.
  try {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "engine.ready",
      data: {
        orgId: user.orgId,
        manifestationSignalId: gallery.signalId,
        galleryId: gallery.id,
        approvedVariantSlug: opts.variantSlug,
      },
    });
  } catch (err) {
    console.warn(
      "[approveBoilerVariant] inngest.send failed (gallery still APPROVED in DB; ENGINE can be triggered manually):",
      err,
    );
  }

  await revalidateGalleryPaths(gallery);
  return {
    ok: true,
    manifestationShortcode: gallery.childShortcode,
    approvedVariantSlug: opts.variantSlug,
  };
}

// ─── Dismiss the gallery — kill the manifestation at BOILER ───────

/**
 * Dismiss the gallery. Manifestation is BOILER_REFUSED — the founder
 * can still resurrect it by editing the FURNACE brief past gate (cascade
 * detection in Phase 11F surfaces the dirty state on the FURNACE tab).
 */
export async function dismissBoilerGallery(opts: {
  galleryId: string;
  reason: string;
}): Promise<{ ok: true; manifestationShortcode: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (opts.reason.trim().length < 4 || opts.reason.trim().length > 500) {
    throw new Error("Reason must be 4-500 characters.");
  }

  const gallery = await loadGalleryScoped({
    galleryId: opts.galleryId,
    orgId: user.orgId,
  });

  if (gallery.status === "APPROVED") {
    throw new Error(
      "Gallery is already APPROVED — manifestation is in ENGINE. Cannot dismiss the gallery without first reverting the approval (deferred to Phase 11E.1).",
    );
  }

  const { journeys } = await import("@/db/schema");
  const [activeJourney] = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      and(
        eq(journeys.signalId, gallery.signalId),
        eq(journeys.status, "active"),
      ),
    )
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .update(agentOutputs)
      .set({
        status: "REJECTED",
        approvedBy: user.authId,
        approvedAt: new Date(),
      })
      .where(eq(agentOutputs.id, gallery.id));

    await tx
      .update(signalsTable)
      .set({ status: "BOILER_REFUSED", updatedAt: new Date() })
      .where(eq(signalsTable.id, gallery.signalId));

    if (activeJourney) {
      await tx.insert(decisionHistory).values({
        orgId: user.orgId,
        signalId: gallery.signalId,
        journeyId: activeJourney.id,
        agentName: "BOILER",
        decision: "gallery_dismissed",
        reason: opts.reason,
        decidedBy: user.authId,
      });
    }
  });

  await revalidateGalleryPaths(gallery);
  return { ok: true, manifestationShortcode: gallery.childShortcode };
}

// ─── Retry a failed gallery (Phase 11G.3) ─────────────────────────

/**
 * Retry a BOILER gallery that hit a technical failure (Inngest exhausted
 * retries, Gemini structured-output flakiness, etc.).
 *
 * Detects the failure marker row (status=REJECTED + content.refused=false +
 * content.error present) written by the handler's `onFailure` callback,
 * deletes it, and re-fires `furnace.brief.approved` so the now-fresh
 * Gemini call has a chance at landing valid JSON. Idempotent: if no
 * failure marker exists (e.g. someone retried twice in parallel), the
 * action is a no-op apart from re-firing the event.
 *
 * The renderer's `BoilerFailed` state surfaces the Retry button that
 * calls this action; ORC also gets a tool path for "retry the BOILER
 * run" if the founder asks.
 *
 * NOT to be confused with `dismissBoilerGallery` (kills the gallery for
 * good) or a future `regenerate_boiler_gallery` (founder wants a new
 * direction; not just a retry of the same prompt).
 */
export async function retryBoilerGallery(opts: {
  /** The manifestation child signal id (NOT the agent_outputs id —
   *  the failure marker may not exist if onFailure didn't run yet). */
  manifestationSignalId: string;
}): Promise<{ ok: true; manifestationShortcode: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Scope-check the manifestation child + look up its current FURNACE
  // brief (the event's briefId payload).
  const [child] = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      orgId: signalsTable.orgId,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.id, opts.manifestationSignalId),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!child) {
    throw new Error("Manifestation not found.");
  }
  if (child.status !== "IN_BOILER") {
    throw new Error(
      `Manifestation status is ${child.status} — retry is only valid at IN_BOILER. ` +
        `If status is BOILER_REFUSED, use dismiss + a new approach. If past IN_BOILER, the gallery already advanced.`,
    );
  }

  // Latest APPROVED FURNACE brief for the manifestation
  const [brief] = await db
    .select({ id: agentOutputs.id, status: agentOutputs.status })
    .from(agentOutputs)
    .where(
      and(
        eq(agentOutputs.signalId, child.id),
        eq(agentOutputs.agentName, "FURNACE"),
      ),
    )
    .orderBy(desc(agentOutputs.createdAt))
    .limit(1);
  if (!brief || brief.status !== "APPROVED") {
    throw new Error(
      "No APPROVED FURNACE brief found on this manifestation. Cannot retry without an approved brief.",
    );
  }

  // CR pass 1 fix: atomic delete + send via transaction. Two failure
  // modes were possible with naive ordering:
  //
  // (A) delete-first-then-send: if inngest.send throws, the failure
  //     marker is gone but no new run fires. User stuck — renderer
  //     falls through to BoilerProcessing (breathing dot forever)
  //     because `boilerOutput` is null, and the Retry button is only
  //     mounted from BoilerFailed which needs `content.error`.
  //
  // (B) send-first-then-delete: if delete throws, an orphan failure
  //     marker persists alongside the new gallery row. The page query
  //     uses `asc(createdAt)` + first-wins (`if !outputByAgent.has`),
  //     so the orphan WINS and the user sees the stale failure state
  //     even after the new gallery succeeds.
  //
  // Wrap delete + send in a transaction. If inngest.send throws, the
  // transaction rolls back the delete and the failure marker stays
  // intact — Retry button still mounted. If the delete throws (rare),
  // the send doesn't fire either. Either both happen or neither does.
  let cleared: Array<{ id: string }> = [];
  try {
    await db.transaction(async (tx) => {
      cleared = await tx
        .delete(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, child.id),
            eq(agentOutputs.agentName, "BOILER"),
          ),
        )
        .returning({ id: agentOutputs.id });

      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "furnace.brief.approved",
        data: {
          orgId: user.orgId,
          manifestationSignalId: child.id,
          briefId: brief.id,
        },
      });
    });
  } catch (err) {
    console.error(
      "[retryBoilerGallery] retry transaction failed; failure marker preserved so the Retry button stays mounted:",
      err,
    );
    throw new Error(
      "Couldn't re-fire the BOILER event. Try the retry button again, or check Inngest connectivity.",
    );
  }

  console.info(
    `[retryBoilerGallery] re-fired furnace.brief.approved for ${child.shortcode}; cleared ${cleared.length} prior row(s) atomically`,
  );

  revalidatePath(`/engine-room/signals/${child.shortcode}`);
  revalidatePath("/engine-room");
  return { ok: true, manifestationShortcode: child.shortcode };
}
