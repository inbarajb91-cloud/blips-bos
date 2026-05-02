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

/**
 * FURNACE server actions — Phase 10D.
 *
 * Per-brief actions invoked from the workspace's FURNACE tab renderer
 * (and ORC tools in Phase 10E). The brief lives as one agent_outputs
 * row on the manifestation child signal: agent_name='FURNACE',
 * output_type='brief', content=<brief sections JSONB>, status=PENDING
 * until founder approval flow promotes it to APPROVED (which fires
 * boiler.ready for Phase 11).
 *
 * Approval flow (two paths, both end at APPROVED):
 *   1. Per-section: founder approves sections individually via
 *      approveBriefSection. When all required sections are approved
 *      (10 visual sections), the brief auto-promotes to APPROVED.
 *   2. One-shot: founder uses approveFullBrief to skip the per-section
 *      flow and approve everything at once.
 *
 * Either path: status flips to APPROVED, manifestation status flips
 * IN_FURNACE → IN_BOILER, boiler.ready event fires (Phase 11 picks up).
 *
 * Cascade flag (Phase 10F adds the cascade detection on the renderer
 * side): when brief edits land after BOILER has rendered (status past
 * IN_BOILER), edits set cascade: true on the revisions array. Downstream
 * BOILER detects this on render and surfaces a "regenerate?" banner.
 *
 * RLS: every action scopes by the brief's org via the parent
 * manifestation's orgId. The agent_outputs row's org_id constraint is
 * indirect — joined to signals.org_id at query time.
 */

// Required sections for granular approval flow. When all 10 are
// individually approved, the brief auto-promotes to APPROVED.
// brandFitRationale is informational (not gated for approval) since
// it's the score's justification, not a design decision.
const REQUIRED_SECTIONS = [
  "designDirection",
  "tactileIntent",
  "moodAndTone",
  "compositionApproach",
  "colorTreatment",
  "typographicTreatment",
  "artDirection",
  "referenceAnchors",
  "placementIntent",
  "voiceInVisual",
] as const;

type SectionName = (typeof REQUIRED_SECTIONS)[number];

const SECTION_BOUNDS: Record<SectionName, { min: number; max: number }> = {
  designDirection: { min: 200, max: 700 },
  tactileIntent: { min: 100, max: 500 },
  moodAndTone: { min: 80, max: 400 },
  compositionApproach: { min: 80, max: 400 },
  colorTreatment: { min: 80, max: 450 },
  typographicTreatment: { min: 100, max: 500 },
  artDirection: { min: 100, max: 500 },
  referenceAnchors: { min: 100, max: 500 },
  placementIntent: { min: 60, max: 300 },
  voiceInVisual: { min: 80, max: 400 },
};

interface BriefRow {
  id: string;
  signalId: string;
  status: string;
  content: Record<string, unknown>;
  sectionApprovals: Record<string, { approved: boolean; approvedAt: string; approvedBy: string }>;
  revisions: Array<Record<string, unknown>>;
  childShortcode: string;
  parentSignalId: string | null;
  childStatus: string;
}

/** Load the brief row + manifestation context, scoped to the user's org. */
async function loadBriefScoped(opts: {
  briefId: string;
  orgId: string;
}): Promise<BriefRow> {
  const [row] = await db
    .select({
      id: agentOutputs.id,
      signalId: agentOutputs.signalId,
      status: agentOutputs.status,
      content: agentOutputs.content,
      sectionApprovals: agentOutputs.sectionApprovals,
      revisions: agentOutputs.revisions,
      childShortcode: signalsTable.shortcode,
      parentSignalId: signalsTable.parentSignalId,
      childStatus: signalsTable.status,
    })
    .from(agentOutputs)
    .innerJoin(signalsTable, eq(agentOutputs.signalId, signalsTable.id))
    .where(
      and(
        eq(agentOutputs.id, opts.briefId),
        eq(agentOutputs.agentName, "FURNACE"),
        eq(signalsTable.orgId, opts.orgId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error("Brief not found.");
  }
  return {
    id: row.id,
    signalId: row.signalId,
    status: row.status,
    content: (row.content ?? {}) as Record<string, unknown>,
    sectionApprovals: (row.sectionApprovals ?? {}) as Record<
      string,
      { approved: boolean; approvedAt: string; approvedBy: string }
    >,
    revisions: Array.isArray(row.revisions)
      ? (row.revisions as Array<Record<string, unknown>>)
      : [],
    childShortcode: row.childShortcode,
    parentSignalId: row.parentSignalId,
    childStatus: row.childStatus,
  };
}

/** Revalidate the manifestation + Bridge + parent paths after a write. */
async function revalidateBriefPaths(brief: BriefRow): Promise<void> {
  revalidatePath(`/engine-room/signals/${brief.childShortcode}`);
  revalidatePath("/engine-room");
  if (brief.parentSignalId) {
    const [parent] = await db
      .select({ shortcode: signalsTable.shortcode })
      .from(signalsTable)
      .where(eq(signalsTable.id, brief.parentSignalId))
      .limit(1);
    if (parent) revalidatePath(`/engine-room/signals/${parent.shortcode}`);
  }
}

/** Promote brief to APPROVED + advance manifestation to BOILER + fire event. */
async function promoteBriefToApproved(opts: {
  brief: BriefRow;
  user: { authId: string; orgId: string };
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(agentOutputs)
      .set({
        status: "APPROVED",
        approvedBy: opts.user.authId,
        approvedAt: new Date(),
      })
      .where(eq(agentOutputs.id, opts.brief.id));
    await tx
      .update(signalsTable)
      .set({ status: "IN_BOILER", updatedAt: new Date() })
      .where(eq(signalsTable.id, opts.brief.signalId));
  });

  // Fire boiler.ready — Phase 11's BOILER handler will pick this up
  // when it ships. Best-effort send; brief is APPROVED in DB regardless.
  try {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "furnace.brief.approved",
      data: {
        orgId: opts.user.orgId,
        manifestationSignalId: opts.brief.signalId,
        briefId: opts.brief.id,
      },
    });
  } catch (err) {
    console.warn(
      "[promoteBriefToApproved] inngest.send failed (brief still APPROVED in DB; BOILER can be triggered manually):",
      err,
    );
  }
}

// ─── Approve a single brief section ──────────────────────────────

export async function approveBriefSection(opts: {
  briefId: string;
  section: SectionName;
}): Promise<{ ok: true; allSectionsApproved: boolean }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (!REQUIRED_SECTIONS.includes(opts.section)) {
    throw new Error(
      `Section '${opts.section}' is not a required section. Approvable sections: ${REQUIRED_SECTIONS.join(", ")}.`,
    );
  }

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  if (brief.status !== "PENDING") {
    throw new Error(
      `Brief is at status ${brief.status} — section approval is only valid at PENDING. Use ORC to dismiss + re-run if you need to revise an APPROVED brief.`,
    );
  }

  // Verify the section has content (refused briefs have null sections —
  // approving an empty section is meaningless)
  const sectionContent = brief.content[opts.section];
  if (sectionContent === null || sectionContent === undefined) {
    throw new Error(
      `Section '${opts.section}' is null on this brief (likely a refusal). Cannot approve an empty section.`,
    );
  }

  // Update sectionApprovals — append/overwrite this section's entry
  const updatedApprovals = {
    ...brief.sectionApprovals,
    [opts.section]: {
      approved: true,
      approvedAt: new Date().toISOString(),
      approvedBy: user.authId,
    },
  };

  // Check if ALL required sections are now approved → auto-promote brief
  const allApproved = REQUIRED_SECTIONS.every(
    (s) => updatedApprovals[s]?.approved === true,
  );

  await db
    .update(agentOutputs)
    .set({ sectionApprovals: updatedApprovals })
    .where(eq(agentOutputs.id, brief.id));

  if (allApproved) {
    await promoteBriefToApproved({
      brief: { ...brief, sectionApprovals: updatedApprovals },
      user: { authId: user.authId, orgId: user.orgId },
    });
  }

  await revalidateBriefPaths(brief);
  return { ok: true, allSectionsApproved: allApproved };
}

// ─── Approve the whole brief in one shot ────────────────────────

export async function approveFullBrief(opts: {
  briefId: string;
}): Promise<{ ok: true; manifestationShortcode: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  if (brief.status !== "PENDING") {
    throw new Error(
      `Brief is at status ${brief.status} — approval is only valid at PENDING.`,
    );
  }

  // Verify all required sections are populated (refused briefs have null
  // sections — can't approve a refusal as if it were a complete brief)
  const missingSections = REQUIRED_SECTIONS.filter(
    (s) =>
      brief.content[s] === null ||
      brief.content[s] === undefined ||
      brief.content[s] === "",
  );
  if (missingSections.length > 0) {
    throw new Error(
      `Cannot approve a brief with missing sections: ${missingSections.join(", ")}. The brief may be refused — use force-advance via ORC if you want to push it through.`,
    );
  }

  // Mark all required sections approved + promote brief
  const now = new Date().toISOString();
  const updatedApprovals = REQUIRED_SECTIONS.reduce<typeof brief.sectionApprovals>(
    (acc, s) => ({
      ...acc,
      [s]: { approved: true, approvedAt: now, approvedBy: user.authId },
    }),
    {},
  );

  await db
    .update(agentOutputs)
    .set({ sectionApprovals: updatedApprovals })
    .where(eq(agentOutputs.id, brief.id));

  await promoteBriefToApproved({
    brief: { ...brief, sectionApprovals: updatedApprovals },
    user: { authId: user.authId, orgId: user.orgId },
  });

  await revalidateBriefPaths(brief);
  return { ok: true, manifestationShortcode: brief.childShortcode };
}

// ─── Dismiss a brief (founder rejects FURNACE's output) ─────────

export async function dismissBrief(opts: {
  briefId: string;
  reason: string;
}): Promise<{ ok: true; manifestationShortcode: string }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (opts.reason.trim().length < 4 || opts.reason.trim().length > 500) {
    throw new Error("Reason must be 4-500 characters.");
  }

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  if (brief.status === "APPROVED") {
    throw new Error(
      "Brief is already APPROVED. To revise, use ORC's regenerate_full_brief tool — dismissing an approved brief would orphan downstream BOILER output.",
    );
  }

  // Look up the active journey for the manifestation — decisionHistory
  // requires journeyId. If no active journey found (defensive — every
  // signal should have one per Phase 8 architecture), skip the
  // decision history write. The brief still gets REJECTED.
  const { journeys } = await import("@/db/schema");
  const [activeJourney] = await db
    .select({ id: journeys.id })
    .from(journeys)
    .where(
      and(eq(journeys.signalId, brief.signalId), eq(journeys.status, "active")),
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
      .where(eq(agentOutputs.id, brief.id));

    if (activeJourney) {
      await tx.insert(decisionHistory).values({
        orgId: user.orgId,
        signalId: brief.signalId,
        journeyId: activeJourney.id,
        agentName: "FURNACE",
        decision: "brief_dismissed",
        reason: opts.reason,
        decidedBy: user.authId,
      });
    }
  });

  await revalidateBriefPaths(brief);
  return { ok: true, manifestationShortcode: brief.childShortcode };
}

// ─── Edit a brief section in place (founder direct edit, no LLM) ─

export async function editBriefSection(opts: {
  briefId: string;
  section: SectionName;
  newContent: string;
  reason?: string;
  /** Phase 10F — when true, allow editing past the IN_BOILER gate.
   *  ORC's edit_brief_section tool sets this on past-gate edits.
   *  Without cascade, the action throws on any childStatus other
   *  than IN_FURNACE. With cascade, the edit lands and the revision
   *  history records cascade=true so BOILER (Phase 11) can detect
   *  "brief framing changed past my gate" and surface a regenerate
   *  prompt. Same pattern as Phase 9G STOKER cascade. */
  cascade?: boolean;
}): Promise<{ ok: true; revisionsCount: number }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (!REQUIRED_SECTIONS.includes(opts.section)) {
    throw new Error(
      `Section '${opts.section}' is not editable. Editable sections: ${REQUIRED_SECTIONS.join(", ")}.`,
    );
  }

  const trimmed = opts.newContent.trim();
  const bounds = SECTION_BOUNDS[opts.section];
  if (trimmed.length < bounds.min || trimmed.length > bounds.max) {
    throw new Error(
      `Section '${opts.section}' must be ${bounds.min}-${bounds.max} characters (got ${trimmed.length}).`,
    );
  }

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  // Status gate — cascade bypasses
  if (
    brief.childStatus !== "IN_FURNACE" &&
    brief.status !== "PENDING" &&
    !opts.cascade
  ) {
    throw new Error(
      `Past-gate edits require cascade=true. Use ORC's edit_brief_section tool with cascade enabled. Manifestation status: ${brief.childStatus}, brief status: ${brief.status}.`,
    );
  }

  const oldContent = brief.content[opts.section];
  const updatedContent = { ...brief.content, [opts.section]: trimmed };

  // Edit invalidates this section's prior approval (if any)
  const updatedApprovals = { ...brief.sectionApprovals };
  delete updatedApprovals[opts.section];

  const revisionEntry = {
    ts: new Date().toISOString(),
    section: opts.section,
    oldContent,
    newContent: trimmed,
    editor: { authId: user.authId, kind: "founder" as const },
    reason: opts.reason ?? null,
    cascade: opts.cascade && brief.childStatus !== "IN_FURNACE" ? true : undefined,
    statusAtEdit: brief.childStatus,
    trigger: "edit" as const,
  };

  await db
    .update(agentOutputs)
    .set({
      content: updatedContent,
      sectionApprovals: updatedApprovals,
      revisions: sql`${agentOutputs.revisions} || ${JSON.stringify([revisionEntry])}::jsonb`,
    })
    .where(eq(agentOutputs.id, brief.id));

  await revalidateBriefPaths(brief);
  return { ok: true, revisionsCount: brief.revisions.length + 1 };
}

// Re-export the section-name + bounds for renderer use.
export { REQUIRED_SECTIONS, SECTION_BOUNDS };
export type { SectionName };
