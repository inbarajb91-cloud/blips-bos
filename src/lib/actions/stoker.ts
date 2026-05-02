"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  db,
  signals as signalsTable,
  agentOutputs,
  decisionHistory,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { createInitialJourney } from "@/lib/orc/journey";
import { resolveShortcode } from "@/lib/signals/resolve-shortcode";

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
      `This manifestation is at status ${child.status} — STOKER approval is only valid at IN_STOKER. Use ORC's edit_manifestation_framing tool with cascade=true for past-gate edits.`,
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

  // Phase 10 — fire furnace.ready so the FURNACE Inngest function picks
  // up this manifestation and generates a brief. The handler does the
  // heavy work (recall playbooks/BRAND.md/MATERIALS.md, run skill, write
  // brief to agent_outputs). Send is fire-and-forget after the DB writes
  // commit so a slow Inngest call doesn't extend this server action.
  // If the send fails (Inngest down), the manifestation stays at
  // IN_FURNACE awaiting brief; the founder can re-trigger via ORC's
  // regenerate_full_brief tool when the system is back up.
  try {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "stoker.manifestation.approved",
      data: {
        orgId: user.orgId,
        manifestationSignalId: child.id,
      },
    });
  } catch (err) {
    console.warn(
      "[approveStokerManifestation] inngest.send failed (manifestation still APPROVED in DB; FURNACE can be re-triggered via ORC):",
      err,
    );
  }

  // Revalidate child + Bridge + parent so the parent's STOKER tab
  // reflects the new APPROVED state on this decade card. Without the
  // parent revalidation, the parent workspace's resonance grid stayed
  // stale until a manual refresh — caught on PR #12 review.
  revalidatePath(`/engine-room/signals/${child.shortcode}`);
  revalidatePath("/engine-room");
  if (child.parentSignalId) {
    const [parent] = await db
      .select({ shortcode: signalsTable.shortcode })
      .from(signalsTable)
      .where(eq(signalsTable.id, child.parentSignalId))
      .limit(1);
    if (parent) revalidatePath(`/engine-room/signals/${parent.shortcode}`);
  }
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
  /** Phase 9G — when true, allow editing past the IN_STOKER gate.
   *  ORC's edit_manifestation_framing tool sets this on past-gate
   *  edits (manifestation already advanced into FURNACE / BOILER /
   *  ENGINE / PROPELLER). Without cascade, the action throws on any
   *  status other than IN_STOKER. With cascade, the edit lands and
   *  the revision history records that the edit happened past-gate
   *  with editor='founder via ORC'. Future stages will use the
   *  revision history to invalidate their own stage outputs when
   *  cascade=true triggered an upstream re-frame. Phase 9G's cascade
   *  is just the bypass — actual downstream invalidation lands as
   *  each downstream stage ships. */
  cascade?: boolean;
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

  // Scope check + status gate. With cascade=true, the IN_STOKER check
  // is bypassed — the edit is allowed past-gate. This is the path ORC
  // uses when editing manifestations that have advanced into FURNACE
  // and beyond.
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
  if (child.status !== "IN_STOKER" && !opts.cascade) {
    throw new Error(
      `Past-gate edits require cascade=true. Use ORC's edit_manifestation_framing tool with cascade enabled. This signal is at ${child.status}.`,
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
    // Phase 9G — flag past-gate edits explicitly so future stages can
    // detect "manifestation framing changed past my gate" and decide
    // whether to invalidate their own outputs. Pre-gate edits don't
    // need this flag; the absence is the signal.
    cascade: opts.cascade && child.status !== "IN_STOKER" ? true : undefined,
    statusAtEdit: child.status,
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
  /** Phase 9G — when true, allow dismissal past the IN_STOKER gate.
   *  ORC's dismiss_manifestation tool sets this on past-gate dismissals
   *  (manifestation already advanced into FURNACE / BOILER / ENGINE /
   *  PROPELLER). Without cascade, the action throws on non-IN_STOKER
   *  status. With cascade, the dismissal lands and a decision_history
   *  entry records the cascade flag for downstream stages to detect. */
  cascade?: boolean;
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
  if (child.status !== "IN_STOKER" && !opts.cascade) {
    throw new Error(
      `Past-gate dismiss requires cascade=true. Use ORC's dismiss_manifestation tool with cascade enabled. This signal is at ${child.status}.`,
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
  // Also revalidate the parent's workspace so the parent's STOKER tab
  // reflects the dismissed card. Without this, the parent's resonance
  // grid showed the card as still pending until manual refresh — caught
  // on PR #12 review (mirrors approve path).
  if (child.parentSignalId) {
    const [parent] = await db
      .select({ shortcode: signalsTable.shortcode })
      .from(signalsTable)
      .where(eq(signalsTable.id, child.parentSignalId))
      .limit(1);
    if (parent) revalidatePath(`/engine-room/signals/${parent.shortcode}`);
  }
  // Note: dismissal of one manifestation doesn't change the parent's
  // FANNED_OUT terminal state. Even if all manifestations are dismissed,
  // STOKER still ran and produced output — the parent's "fanned out"
  // moment happened. The DISMISSED children are kept as audit trail.
  // If the founder wants the parent itself dismissed, that's a separate
  // action on the parent.
  return { ok: true, childShortcode: child.shortcode };
}

// ─── Add a manifestation STOKER refused / missed (Phase 9G) ──────

/**
 * Force-add a manifestation for a decade STOKER didn't produce one
 * for. Use case: STOKER scored RCD at 32 and refused (no manifestation),
 * but the founder thinks the signal IS RCD-coded with a specific
 * angle STOKER missed. ORC's add_manifestation tool calls this with
 * the founder's framing fields.
 *
 * Validates:
 *   - Parent signal exists in same org and is itself a parent
 *     (parentSignalId IS NULL).
 *   - Parent has run through STOKER already (status FANNED_OUT or
 *     STOKER_REFUSED) — pre-STOKER add doesn't make sense, the
 *     normal STOKER pass would produce manifestations.
 *   - Decade not already taken by an existing child manifestation
 *     (the (parent_signal_id, manifestation_decade) partial UNIQUE
 *     enforces this at DB level too — the early check makes the
 *     error message friendlier).
 *
 * Creates:
 *   - New child signal row with parent_signal_id + manifestation_decade
 *     SET, source 'stoker_manifestation', status IN_STOKER (founder
 *     gate — even force-added manifestations need explicit per-card
 *     approval before advancing to FURNACE).
 *   - Initial journey for the child (Phase 8 architecture).
 *   - STOKER agent_outputs row carrying the founder's framing,
 *     status PENDING, with metadata.forceAdded=true so the renderer
 *     can surface "founder force-added this — STOKER didn't produce it."
 */
export async function addStokerManifestation(opts: {
  parentSignalId: string;
  decade: "RCK" | "RCL" | "RCD";
  framingHook: string;
  tensionAxis: string;
  narrativeAngle: string;
  reason?: string;
}): Promise<{ ok: true; childShortcode: string; childSignalId: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Field validation — same length bounds as editStokerManifestation
  // so add and edit produce structurally consistent rows.
  const framingHook = opts.framingHook.trim();
  const tensionAxis = opts.tensionAxis.trim();
  const narrativeAngle = opts.narrativeAngle.trim();
  if (framingHook.length < 10 || framingHook.length > 150) {
    throw new Error("Framing hook must be 10-150 characters.");
  }
  if (tensionAxis.length < 10 || tensionAxis.length > 200) {
    throw new Error("Tension axis must be 10-200 characters.");
  }
  if (narrativeAngle.length < 50 || narrativeAngle.length > 800) {
    throw new Error("Narrative angle must be 50-800 characters.");
  }

  // Parent validation
  const [parent] = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      parentSignalId: signalsTable.parentSignalId,
      collectionId: signalsTable.collectionId,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.id, opts.parentSignalId),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!parent) throw new Error("Parent signal not found.");
  if (parent.parentSignalId !== null) {
    throw new Error(
      "Cannot add a manifestation to a signal that is itself a manifestation. Pass the original parent signal id.",
    );
  }
  if (
    parent.status !== "FANNED_OUT" &&
    parent.status !== "STOKER_REFUSED"
  ) {
    throw new Error(
      `Parent signal status is ${parent.status} — STOKER hasn't run yet, or hasn't produced its primary output. Force-add is only valid post-STOKER.`,
    );
  }

  // Decade availability check — friendly error before the DB unique
  // constraint kicks in.
  const [existingChild] = await db
    .select({ id: signalsTable.id, shortcode: signalsTable.shortcode })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.parentSignalId, parent.id),
        eq(signalsTable.manifestationDecade, opts.decade),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (existingChild) {
    throw new Error(
      `Parent already has a ${opts.decade} manifestation (${existingChild.shortcode}). To replace it, dismiss that one first or edit it via edit_manifestation_framing.`,
    );
  }

  // Resolve a unique child shortcode. Pattern: parent + decade
  // (e.g. VOTER-RCK). If parent has 99 collisions on this base
  // (won't happen in practice), resolveShortcode falls back to a
  // random suffix — see signals/resolve-shortcode.ts.
  const baseShortcode = `${parent.shortcode}-${opts.decade}`;
  const takenRows = await db
    .select({ shortcode: signalsTable.shortcode })
    .from(signalsTable)
    .where(eq(signalsTable.orgId, user.orgId));
  const taken = new Set(takenRows.map((r) => r.shortcode));
  const childShortcode = resolveShortcode(baseShortcode, taken);

  // Child working title + concept default to derived strings — the
  // founder can edit through the UI later. We don't ask the LLM to
  // refine these in 9G; the force-add path is intentionally lean.
  const workingTitle = framingHook.length <= 100 ? framingHook : framingHook.slice(0, 97) + "...";
  const concept = narrativeAngle.length <= 280 ? narrativeAngle : narrativeAngle.slice(0, 277) + "...";

  // Atomic: insert child signal + journey + STOKER agent_outputs row.
  // createInitialJourney accepts the transaction so all three writes
  // commit or roll back together — agent_outputs.journey_id is NOT NULL
  // so we MUST have the journey id before the agent_outputs insert.
  const result = await db.transaction(async (tx) => {
    const [childRow] = await tx
      .insert(signalsTable)
      .values({
        orgId: user.orgId,
        collectionId: parent.collectionId,
        shortcode: childShortcode,
        workingTitle,
        concept,
        source: "stoker_manifestation",
        rawText: null,
        rawMetadata: null,
        status: "IN_STOKER", // founder gate — even force-added manifestations need approval
        parentSignalId: parent.id,
        manifestationDecade: opts.decade,
      })
      .returning({ id: signalsTable.id });

    if (!childRow) {
      throw new Error("Child signal insert returned no row.");
    }

    // Initial journey for the child (Phase 8 architecture invariant —
    // every signal has at least one active journey). user.authId
    // doubles as users.id (matches auth.users.id by construction).
    const journey = await createInitialJourney(
      { signalId: childRow.id, createdBy: user.authId },
      tx,
    );

    // Mint the STOKER agent_outputs row carrying the founder's framing.
    // Content shape mirrors the inngest STOKER fan-out path
    // (src/lib/inngest/functions/stoker.ts) — same outputType, same
    // top-level keys — so the workspace renderer treats force-added
    // children identically to STOKER-generated ones. CR pass on PR #12
    // caught the original divergence (outputType="decade_resonance",
    // missing dimensionAlignment, missing parent ids) which would have
    // tripped the renderer's shape assertions.
    //
    // dimensionAlignment is the 7-dimension empty-string skeleton — the
    // founder's force-add input doesn't include per-dimension notes
    // (and we deliberately don't synthesise them in 9G; force-add is
    // lean). The renderer renders only non-empty dimensions, so empty
    // strings are a clean "no per-dimension note" tell.
    //
    // forceAdded provenance keys (forceAdded / addedBy / addReason) are
    // additive — they coexist with the canonical shape rather than
    // replacing it.
    await tx.insert(agentOutputs).values({
      signalId: childRow.id,
      journeyId: journey.id,
      agentName: "STOKER",
      outputType: "manifestation",
      status: "PENDING",
      content: {
        decade: opts.decade,
        // No STOKER score because STOKER didn't run — the founder
        // bypassed it. null is explicit; the renderer skips score chips
        // when score is null.
        resonanceScore: null,
        rationale:
          opts.reason ??
          "Founder force-added — STOKER did not generate this manifestation.",
        framingHook,
        tensionAxis,
        narrativeAngle,
        dimensionAlignment: {
          social: "",
          musical: "",
          cultural: "",
          career: "",
          responsibilities: "",
          expectations: "",
          sports: "",
        },
        parentSignalId: parent.id,
        parentShortcode: parent.shortcode,
        forceAdded: true,
        addedBy: user.authId,
        addReason: opts.reason ?? null,
      },
      revisions: [],
    });

    return { childId: childRow.id };
  });

  revalidatePath(`/engine-room/signals/${parent.shortcode}`);
  revalidatePath("/engine-room");

  return {
    ok: true,
    childShortcode,
    childSignalId: result.childId,
  };
}

// ─── Restart STOKER on a parent signal (Phase 9G) ────────────────

/**
 * Record the founder's intent to restart STOKER on a parent. Phase 9G
 * scope is INTENT-ONLY — does not actually re-trigger Inngest, does
 * not destroy existing manifestation rows. Why:
 *
 *   1. The (parent_signal_id, manifestation_decade) partial UNIQUE
 *      means we can't re-insert children for decades that already
 *      have one. To genuinely restart, we'd either DELETE existing
 *      children (destroys audit) or add a journey_id column to the
 *      unique index (schema migration out of scope for 9G).
 *   2. Either path needs explicit founder confirmation per
 *      ORC-mutation-gate semantics, AND a UI surface for confirming
 *      destructive operations. Neither exists yet.
 *
 * What 9G does instead:
 *   - Records a decision_history entry "restart_requested" with the
 *     reason. ORC can recall this later via cross-signal memory.
 *   - Returns a structured message instructing the founder how to
 *     manually clear and re-run STOKER (dismiss existing manifestations
 *     via dismiss_manifestation, then re-approve the parent on Bridge).
 *   - Future patch (post-Phase-10 likely) implements the auto-restart
 *     once the schema + UI affordances exist.
 */
export async function restartStokerProcess(opts: {
  parentSignalId: string;
  reason: string;
}): Promise<{
  ok: true;
  message: string;
  manualSteps: string[];
}> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (opts.reason.trim().length < 4 || opts.reason.trim().length > 500) {
    throw new Error("Reason must be 4-500 characters.");
  }

  const [parent] = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      parentSignalId: signalsTable.parentSignalId,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.id, opts.parentSignalId),
        eq(signalsTable.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!parent) throw new Error("Parent signal not found.");
  if (parent.parentSignalId !== null) {
    throw new Error(
      "Cannot restart STOKER on a manifestation child — pass the original parent signal id.",
    );
  }
  if (
    parent.status !== "FANNED_OUT" &&
    parent.status !== "STOKER_REFUSED"
  ) {
    throw new Error(
      `Parent status is ${parent.status} — STOKER hasn't run yet (or hasn't produced its primary output). Restart is only valid post-STOKER.`,
    );
  }

  // Look up the parent's existing children to surface the manual
  // cleanup list to the founder.
  const existingChildren = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      manifestationDecade: signalsTable.manifestationDecade,
    })
    .from(signalsTable)
    .where(
      and(
        eq(signalsTable.parentSignalId, parent.id),
        eq(signalsTable.orgId, user.orgId),
      ),
    );
  const liveChildren = existingChildren.filter((c) => c.status !== "DISMISSED");

  // Look up the parent's active journey for the decision_history FK.
  // If none found, skip the decision row rather than fail — better to
  // record intent partially than not at all.
  const { journeys } = await import("@/db/schema");
  const [activeJourney] = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      and(
        eq(journeys.signalId, parent.id),
        eq(journeys.status, "active"),
      ),
    )
    .limit(1);

  if (activeJourney) {
    await db.insert(decisionHistory).values({
      orgId: user.orgId,
      signalId: parent.id,
      journeyId: activeJourney.id,
      agentName: "STOKER",
      decision: "restart_requested",
      reason: opts.reason,
      decidedBy: user.authId,
    });
  }

  const manualSteps: string[] = [];
  if (liveChildren.length > 0) {
    manualSteps.push(
      `Dismiss the ${liveChildren.length} existing manifestation(s): ${liveChildren
        .map((c) => `${c.shortcode} (${c.manifestationDecade})`)
        .join(", ")}. Use ORC's dismiss_manifestation tool with cascade if any have advanced past STOKER.`,
    );
  }
  manualSteps.push(
    `Once all decades are clear, re-approve the parent ${parent.shortcode} on Bridge to re-trigger STOKER. The Inngest stoker-process function will pick it up.`,
  );

  return {
    ok: true,
    message: `Restart intent recorded for ${parent.shortcode}. Auto-restart isn't wired yet (Phase 9G is intent-only) — follow the manual steps below.`,
    manualSteps,
  };
}
