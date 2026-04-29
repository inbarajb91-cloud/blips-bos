"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  db,
  signals as signalsTable,
  agentOutputs,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";

/**
 * STOKER server actions — Phase 9D.
 *
 * Per-manifestation actions invoked from the workspace's STOKER tab
 * renderer when the founder approves / edits / dismisses a card.
 *
 * Architecture (Model 3): each manifestation IS its own signal row.
 * "Approve" flips the child's status from IN_STOKER → IN_FURNACE
 * (advancing it into the next pipeline stage). "Edit" rewrites the
 * STOKER agent_outputs framing fields and appends an entry to the
 * revisions JSONB array. "Dismiss" flips the child to DISMISSED.
 *
 * Cascade semantics (Phase 9G expansion): the editing/dismissing path
 * here only handles pre-FURNACE state (status === 'IN_STOKER'). When
 * a manifestation has advanced past STOKER, edits/dismisses go through
 * ORC's tool surface (edit_manifestation_framing / dismiss_manifestation
 * with cascade flags) which lands in 9G. The 9D actions are deliberately
 * pre-gate-only.
 *
 * RLS: every action scopes by the manifestation's orgId via
 * getCurrentUserWithOrg. The child signal's orgId is verified to match
 * the caller's orgId before any write.
 */

// ─── Approve a manifestation card ────────────────────────────────

export async function approveStokerManifestation(opts: {
  manifestationSignalId: string;
}): Promise<{ ok: true; childShortcode: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Fetch the child to verify scope + that it's at IN_STOKER (the
  // founder gate state). Approving anything else is a no-op or a logic
  // error — fail loudly so the renderer can show a sensible message.
  const [child] = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      parentSignalId: signalsTable.parentSignalId,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.id, opts.manifestationSignalId),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!child) throw new Error("Manifestation not found.");
  if (child.parentSignalId === null) {
    throw new Error(
      "Cannot approve a non-manifestation signal via this action — use approveCandidate for raw signals.",
    );
  }
  if (child.status !== "IN_STOKER") {
    throw new Error(
      `This manifestation is at status ${child.status} — STOKER approval is only valid at IN_STOKER. Use ORC's edit_manifestation_framing tool with force+cascade for past-gate edits.`,
    );
  }

  // Pre-check that a STOKER agent_outputs row exists before the
  // transaction — without this, the tx.update on agent_outputs could
  // affect 0 rows silently while the signal status flips to IN_FURNACE,
  // leaving a manifestation advancing without an APPROVED audit trail.
  // CR pass on PR #8 caught this consistency hole; same pre-check is
  // already used in editStokerManifestation. Keep the patterns aligned.
  const [existingOutput] = await db
    .select({ id: agentOutputs.id })
    .from(agentOutputs)
    .where(
      and(
        eq(agentOutputs.signalId, child.id),
        eq(agentOutputs.agentName, "STOKER"),
      ),
    )
    .limit(1);
  if (!existingOutput) {
    throw new Error(
      "STOKER output row missing for this manifestation — can't approve. The Inngest fan-out may have partially failed; ask ORC to restart STOKER on the parent.",
    );
  }

  // Flip child status → IN_FURNACE (advances it). Also flip its STOKER
  // agent_outputs row to APPROVED so the renderer knows the card was
  // acted on.
  await db.transaction(async (tx) => {
    await tx
      .update(signalsTable)
      .set({ status: "IN_FURNACE", updatedAt: new Date() })
      .where(eq(signalsTable.id, child.id));
    await tx
      .update(agentOutputs)
      .set({
        status: "APPROVED",
        approvedBy: user.authId,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(agentOutputs.signalId, child.id),
          eq(agentOutputs.agentName, "STOKER"),
        ),
      );
  });

  // FURNACE event firing is deferred to Phase 10 (no FURNACE handler
  // yet). Manifestation sits at IN_FURNACE until Phase 10 ships.
  // Leaving the parent's STOKER tab + Bridge are revalidated so the
  // renderer reflects the new state.
  revalidatePath(`/engine-room/signals/${child.shortcode}`);
  revalidatePath("/engine-room");
  return { ok: true, childShortcode: child.shortcode };
}

// ─── Edit a manifestation's framing in place ─────────────────────

export interface ManifestationEditFields {
  framingHook?: string;
  tensionAxis?: string;
  narrativeAngle?: string;
}

export async function editStokerManifestation(opts: {
  manifestationSignalId: string;
  fields: ManifestationEditFields;
  reason?: string;
}): Promise<{ ok: true; revisionsCount: number }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Validate at least one field changed
  const trimmedFields: Record<string, string> = {};
  if (opts.fields.framingHook !== undefined) {
    const v = opts.fields.framingHook.trim();
    if (v.length < 10 || v.length > 150) {
      throw new Error("Framing hook must be 10-150 characters.");
    }
    trimmedFields.framingHook = v;
  }
  if (opts.fields.tensionAxis !== undefined) {
    const v = opts.fields.tensionAxis.trim();
    if (v.length < 10 || v.length > 200) {
      throw new Error("Tension axis must be 10-200 characters.");
    }
    trimmedFields.tensionAxis = v;
  }
  if (opts.fields.narrativeAngle !== undefined) {
    const v = opts.fields.narrativeAngle.trim();
    if (v.length < 50 || v.length > 800) {
      throw new Error("Narrative angle must be 50-800 characters.");
    }
    trimmedFields.narrativeAngle = v;
  }
  if (Object.keys(trimmedFields).length === 0) {
    throw new Error("Provide at least one field to edit.");
  }

  // Scope check + status gate (pre-FURNACE only at this layer)
  const [child] = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      parentSignalId: signalsTable.parentSignalId,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.id, opts.manifestationSignalId),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!child) throw new Error("Manifestation not found.");
  if (child.parentSignalId === null) {
    throw new Error("Cannot edit a non-manifestation signal here.");
  }
  if (child.status !== "IN_STOKER") {
    throw new Error(
      `Past-gate edits go through ORC's edit_manifestation_framing tool with cascade. This signal is at ${child.status}.`,
    );
  }

  // Fetch the STOKER agent_outputs row to merge the edit into content
  // and append to revisions.
  const [output] = await db
    .select({
      id: agentOutputs.id,
      content: agentOutputs.content,
      revisions: agentOutputs.revisions,
    })
    .from(agentOutputs)
    .where(
      and(
        eq(agentOutputs.signalId, child.id),
        eq(agentOutputs.agentName, "STOKER"),
      ),
    )
    .limit(1);
  if (!output) throw new Error("STOKER output row not found.");

  // Defensive default to {} when content is null/undefined (CR pass on
  // PR #8). Schema permits NOT NULL on agent_outputs.content but the
  // jsonb type can technically hold null at the value level; the spread
  // below would throw at runtime if oldContent were null.
  const oldContent = (output.content ?? {}) as Record<string, unknown>;
  const newContent = { ...oldContent, ...trimmedFields };

  const revisionEntry = {
    ts: new Date().toISOString(),
    fields: trimmedFields,
    editor: { authId: user.authId, kind: "founder" as const },
    reason: opts.reason ?? null,
  };

  // Append to revisions JSONB. jsonb_array_append concat operator is
  // safe: it's atomic, no read-modify-write race here.
  await db
    .update(agentOutputs)
    .set({
      content: newContent,
      revisions: sql`${agentOutputs.revisions} || ${JSON.stringify([revisionEntry])}::jsonb`,
    })
    .where(eq(agentOutputs.id, output.id));

  revalidatePath(`/engine-room/signals/${child.shortcode}`);
  // Also revalidate the parent's workspace so the parent's STOKER tab
  // sees the updated framing in the resonance card grid.
  // (We need the parent's shortcode; chase via parentSignalId.)
  const [parent] = await db
    .select({ shortcode: signalsTable.shortcode })
    .from(signalsTable)
    .where(eq(signalsTable.id, child.parentSignalId!))
    .limit(1);
  if (parent) revalidatePath(`/engine-room/signals/${parent.shortcode}`);

  const existingRevisions = Array.isArray(output.revisions)
    ? output.revisions
    : [];
  return { ok: true, revisionsCount: existingRevisions.length + 1 };
}

// ─── Dismiss a manifestation card ────────────────────────────────

export async function dismissStokerManifestation(opts: {
  manifestationSignalId: string;
  reason?: string;
}): Promise<{ ok: true; childShortcode: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const [child] = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      parentSignalId: signalsTable.parentSignalId,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.id, opts.manifestationSignalId),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!child) throw new Error("Manifestation not found.");
  if (child.parentSignalId === null) {
    throw new Error("Cannot dismiss a non-manifestation signal here.");
  }
  if (child.status !== "IN_STOKER") {
    throw new Error(
      `Past-gate dismiss goes through ORC's dismiss_manifestation tool with cascade. This signal is at ${child.status}.`,
    );
  }

  // Same pre-check as approveStokerManifestation — without it, a
  // missing STOKER row would silently leave the dismiss with no audit
  // trail on the agent_outputs side. CR pass on PR #8.
  const [existingOutput] = await db
    .select({ id: agentOutputs.id })
    .from(agentOutputs)
    .where(
      and(
        eq(agentOutputs.signalId, child.id),
        eq(agentOutputs.agentName, "STOKER"),
      ),
    )
    .limit(1);
  if (!existingOutput) {
    throw new Error(
      "STOKER output row missing for this manifestation — can't dismiss. The Inngest fan-out may have partially failed; ask ORC to restart STOKER on the parent.",
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(signalsTable)
      .set({ status: "DISMISSED", updatedAt: new Date() })
      .where(eq(signalsTable.id, child.id));
    await tx
      .update(agentOutputs)
      .set({
        status: "REJECTED",
        // CR nitpick on PR #8 — `approvedBy` / `approvedAt` are
        // semantically misleading on a dismissal path; they're really
        // "decidedBy" / "decidedAt" (audit fields for any terminal
        // action, not just approvals). Schema already shipped with
        // these names; the right longer-term fix is renaming them in a
        // schema migration. For now, repurposing them for both approve
        // and dismiss keeps the audit trail coherent in one place. If
        // the rename happens, both this and approveStokerManifestation
        // change in parallel.
        approvedBy: user.authId,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(agentOutputs.signalId, child.id),
          eq(agentOutputs.agentName, "STOKER"),
        ),
      );
  });

  revalidatePath(`/engine-room/signals/${child.shortcode}`);
  revalidatePath("/engine-room");
  // Note: dismissal of one manifestation doesn't change the parent's
  // FANNED_OUT terminal state. Even if all manifestations are dismissed,
  // STOKER still ran and produced output — the parent's "fanned out"
  // moment happened. The DISMISSED children are kept as audit trail.
  // If the founder wants the parent itself dismissed, that's a separate
  // action on the parent.
  return { ok: true, childShortcode: child.shortcode };
}
