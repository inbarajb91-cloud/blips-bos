"use server";

import { and, eq, sql } from "drizzle-orm";
import { appendCappedRevisions } from "@/lib/db/append-capped-revisions";
import { revalidatePath } from "next/cache";
import {
  db,
  signals as signalsTable,
  agentOutputs,
  decisionHistory,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import {
  REQUIRED_SECTIONS,
  SECTION_BOUNDS,
  type SectionName,
} from "./furnace-shared";

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

// REQUIRED_SECTIONS, SECTION_BOUNDS, SectionName are now imported from
// `./furnace-shared` — Next.js App Router doesn't allow non-function
// exports in `"use server"` files. The constants are shared between this
// server-actions module and the client renderer (FurnaceBrief) so they
// MUST live in a non-server module.

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
      revisions: appendCappedRevisions(agentOutputs.revisions, revisionEntry),
    })
    .where(eq(agentOutputs.id, brief.id));

  await revalidateBriefPaths(brief);
  return { ok: true, revisionsCount: brief.revisions.length + 1 };
}

// ─── Regenerate the whole brief (LLM call with founder feedback) ─

export async function regenerateFullBrief(opts: {
  briefId: string;
  reason: string;
}): Promise<{
  ok: true;
  manifestationShortcode: string;
  brandFitScore: number;
  refused: boolean;
}> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (opts.reason.trim().length < 4 || opts.reason.trim().length > 600) {
    throw new Error("Reason must be 4-600 characters.");
  }

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  if (brief.status === "APPROVED") {
    throw new Error(
      "Brief is APPROVED. Regenerating an approved brief would orphan downstream BOILER output. Use cascade-aware edits instead.",
    );
  }

  // Load full context — same shape the Inngest handler builds.
  const { signals, knowledgeDocuments, agentOutputs: ao } = await import(
    "@/db/schema"
  );
  const { ilike, sql: drizzleSql, desc } = await import("drizzle-orm");
  const { getMemoryBackend } = await import("@/lib/orc/memory");

  const [child] = await db
    .select({
      id: signals.id,
      shortcode: signals.shortcode,
      workingTitle: signals.workingTitle,
      concept: signals.concept,
      parentSignalId: signals.parentSignalId,
      manifestationDecade: signals.manifestationDecade,
    })
    .from(signals)
    .where(
      and(eq(signals.id, brief.signalId), eq(signals.orgId, user.orgId)),
    )
    .limit(1);
  if (!child || !child.parentSignalId || !child.manifestationDecade) {
    throw new Error("Manifestation context not loadable for regen.");
  }

  // Load STOKER content
  const [stokerRow] = await db
    .select({ content: ao.content })
    .from(ao)
    .where(
      and(eq(ao.signalId, child.id), eq(ao.agentName, "STOKER")),
    )
    .limit(1);
  if (!stokerRow) throw new Error("STOKER context missing — can't regen.");
  const stoker = stokerRow.content as {
    framingHook?: string;
    tensionAxis?: string;
    narrativeAngle?: string;
    dimensionAlignment?: {
      social: string;
      musical: string;
      cultural: string;
      career: string;
      responsibilities: string;
      expectations: string;
      sports: string;
    };
  };
  if (
    !stoker.framingHook ||
    !stoker.tensionAxis ||
    !stoker.narrativeAngle ||
    !stoker.dimensionAlignment
  ) {
    throw new Error("STOKER content malformed.");
  }

  // Load parent
  const [parent] = await db
    .select({ id: signals.id, shortcode: signals.shortcode })
    .from(signals)
    .where(eq(signals.id, child.parentSignalId))
    .limit(1);
  if (!parent) throw new Error("Parent signal missing.");

  // Load knowledge context (decade playbook + BRAND.md + MATERIALS.md)
  const decade = child.manifestationDecade as "RCK" | "RCL" | "RCD";
  const fetchByTitle = async (title: string): Promise<string> => {
    const [doc] = await db
      .select({ content: knowledgeDocuments.content })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.orgId, user.orgId),
          eq(knowledgeDocuments.status, "active"),
          ilike(knowledgeDocuments.title, title),
        ),
      )
      .limit(1);
    return doc?.content ?? "";
  };
  const playbookTitles: Record<string, string> = {
    RCK: "RCK Decade Playbook",
    RCL: "RCL Decade Playbook",
    RCD: "RCD Decade Playbook",
  };
  const [decadePlaybook, brandIdentity, materialsVocabulary] =
    await Promise.all([
      fetchByTitle(playbookTitles[decade]),
      fetchByTitle("BLIPS Brand Identity"),
      fetchByTitle("BLIPS Materials Playbook"),
    ]);

  // Past briefs for Tier 3 visual consistency
  const pastRows = await db
    .select({
      content: ao.content,
      shortcode: signals.shortcode,
      workingTitle: signals.workingTitle,
      approvedAt: ao.approvedAt,
    })
    .from(ao)
    .innerJoin(signals, eq(ao.signalId, signals.id))
    .where(
      and(
        eq(ao.agentName, "FURNACE"),
        eq(ao.status, "APPROVED"),
        eq(signals.orgId, user.orgId),
        eq(signals.manifestationDecade, decade),
        drizzleSql`${signals.id} <> ${child.id}`,
      ),
    )
    .orderBy(desc(ao.approvedAt))
    .limit(3);
  const pastBriefs = pastRows
    .map((r) => {
      const c = r.content as {
        designDirection?: string | null;
        tactileIntent?: string | null;
      };
      if (!c.designDirection || !c.tactileIntent) return null;
      return {
        shortcode: r.shortcode,
        workingTitle: r.workingTitle,
        designDirection: c.designDirection,
        tactileIntent: c.tactileIntent,
        approvedAt: r.approvedAt?.toISOString() ?? "",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Load FURNACE skill + run with feedback prefix in prompt
  await import("@/skills"); // populate registry
  const { furnaceSkill } = await import("@/skills/furnace");
  const baseInput = {
    signalId: child.id,
    shortcode: child.shortcode,
    workingTitle: child.workingTitle,
    concept: child.concept ?? "",
    manifestationDecade: decade,
    parentSignalId: parent.id,
    parentShortcode: parent.shortcode,
    manifestation: {
      framingHook: stoker.framingHook,
      tensionAxis: stoker.tensionAxis,
      narrativeAngle: stoker.narrativeAngle,
      dimensionAlignment: stoker.dimensionAlignment,
    },
    knowledgeContext: { decadePlaybook, brandIdentity, materialsVocabulary },
    pastBriefsForDecade: pastBriefs,
  };

  // Inject the founder's feedback as a regen directive prepended to the
  // standard prompt. The skill's system prompt unchanged; per-call
  // user message prepends a "REGENERATION REQUEST" header.
  const standardPrompt = furnaceSkill.buildPrompt(baseInput);
  const promptWithFeedback = `REGENERATION REQUEST — founder asked to redo this brief with the following feedback:

"${opts.reason}"

The previous brief (id ${brief.id}) is being replaced. Re-read the manifestation context and address the founder's feedback in your new output. Don't repeat the previous brief's exact framing if the feedback indicates a direction change.

---

${standardPrompt}`;

  const { generateStructured } = await import("@/lib/ai/generate");
  const result = await generateStructured({
    orgId: user.orgId,
    agentKey: "FURNACE",
    system: furnaceSkill.systemPrompt,
    prompt: promptWithFeedback,
    schema: furnaceSkill.outputSchema,
  });

  const newContent = result.object as Record<string, unknown>;

  // Update existing brief row + append revision entry. Section
  // approvals reset (regen invalidates all prior approvals). Status
  // stays PENDING — founder reviews fresh.
  const revisionEntry = {
    ts: new Date().toISOString(),
    section: null as string | null,
    oldContent: brief.content,
    newContent,
    editor: { authId: user.authId, kind: "orc" as const },
    reason: opts.reason,
    trigger: "regenerate_full" as const,
  };

  await db
    .update(agentOutputs)
    .set({
      content: newContent,
      status: "PENDING",
      sectionApprovals: {},
      revisions: appendCappedRevisions(agentOutputs.revisions, revisionEntry),
    })
    .where(eq(agentOutputs.id, brief.id));

  // Best-effort memory write for Tier 3 learning
  void (async () => {
    try {
      const memory = await getMemoryBackend();
      await memory.remember({
        orgId: user.orgId,
        container: "events",
        kind: "stage_completion",
        content: `FURNACE brief regenerated for ${child.shortcode} (${decade}). brand-fit ${newContent.brandFitScore}/100. Founder feedback: ${opts.reason}`,
        signalId: child.id,
        metadata: {
          stage: "furnace",
          decade,
          shortcode: child.shortcode,
          brandFitScore: newContent.brandFitScore,
          refused: newContent.refused,
          regenerated: true,
        },
      });
    } catch (err) {
      console.warn("[regenerateFullBrief] memory write failed (best-effort):", err);
    }
  })();

  await revalidateBriefPaths(brief);

  return {
    ok: true,
    manifestationShortcode: brief.childShortcode,
    brandFitScore: newContent.brandFitScore as number,
    refused: newContent.refused as boolean,
  };
}

// ─── Regenerate ONE section (LLM call constrained to one field) ──

export async function regenerateBriefSection(opts: {
  briefId: string;
  section: SectionName;
  reason: string;
}): Promise<{
  ok: true;
  section: SectionName;
  revisionsCount: number;
}> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  if (!REQUIRED_SECTIONS.includes(opts.section)) {
    throw new Error(`Section '${opts.section}' is not regenerable.`);
  }
  if (opts.reason.trim().length < 4 || opts.reason.trim().length > 600) {
    throw new Error("Reason must be 4-600 characters.");
  }

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  if (brief.status === "APPROVED") {
    throw new Error("Brief is APPROVED. Section regen blocked on approved briefs.");
  }

  // Build a focused single-section prompt + tight schema. The LLM
  // only writes ONE field; rest of brief stays intact.
  const { z: zod } = await import("zod");
  const { generateStructured } = await import("@/lib/ai/generate");
  const bounds = SECTION_BOUNDS[opts.section];

  const sectionSchema = zod.object({
    content: zod
      .string()
      .min(bounds.min)
      .max(bounds.max)
      .describe(
        `Replacement content for the ${opts.section} section (${bounds.min}-${bounds.max} chars).`,
      ),
  });

  const briefContext = JSON.stringify(brief.content, null, 2).slice(0, 4000);
  const sectionPrompt = `You are FURNACE — BLIPS's visual design brief generator.

REGENERATE ONE SECTION request: rewrite the '${opts.section}' section of an existing brief based on founder feedback.

EXISTING BRIEF (for context — do NOT change other sections, only return the new ${opts.section}):
${briefContext}

FOUNDER FEEDBACK (what's wrong with the current ${opts.section}):
"${opts.reason}"

Produce a replacement for the '${opts.section}' section ONLY. Character bounds: ${bounds.min}-${bounds.max}. Stay consistent with the rest of the brief; address the founder's specific feedback. Return JSON: {"content": "<the new section text>"}.`;

  const result = await generateStructured({
    orgId: user.orgId,
    agentKey: "FURNACE",
    system:
      "You are FURNACE editing one section of an existing visual design brief. Stay tight to the founder's feedback. Match the brief's existing voice + register. No commentary.",
    prompt: sectionPrompt,
    schema: sectionSchema,
  });

  const newSectionContent = result.object.content;
  const oldSectionContent = brief.content[opts.section];

  // Update brief content + invalidate section approval + append revision
  const updatedContent = { ...brief.content, [opts.section]: newSectionContent };
  const updatedApprovals = { ...brief.sectionApprovals };
  delete updatedApprovals[opts.section];

  const revisionEntry = {
    ts: new Date().toISOString(),
    section: opts.section,
    oldContent: oldSectionContent,
    newContent: newSectionContent,
    editor: { authId: user.authId, kind: "orc" as const },
    reason: opts.reason,
    trigger: "regenerate" as const,
  };

  await db
    .update(agentOutputs)
    .set({
      content: updatedContent,
      sectionApprovals: updatedApprovals,
      revisions: appendCappedRevisions(agentOutputs.revisions, revisionEntry),
    })
    .where(eq(agentOutputs.id, brief.id));

  await revalidateBriefPaths(brief);
  return {
    ok: true,
    section: opts.section,
    revisionsCount: brief.revisions.length + 1,
  };
}

// ─── Add an addendum to a brief ──────────────────────────────────

export async function addBriefAddendum(opts: {
  briefId: string;
  label: string;
  content: string;
  reason: string;
  addedByOrc?: boolean;
}): Promise<{ ok: true; addendaCount: number }> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const trimmedLabel = opts.label.trim();
  const trimmedContent = opts.content.trim();
  if (trimmedLabel.length < 5 || trimmedLabel.length > 50) {
    throw new Error("Label must be 5-50 characters.");
  }
  if (trimmedContent.length < 50 || trimmedContent.length > 500) {
    throw new Error("Content must be 50-500 characters.");
  }
  if (opts.reason.trim().length < 50 || opts.reason.trim().length > 300) {
    throw new Error("Reason must be 50-300 characters.");
  }

  const brief = await loadBriefScoped({
    briefId: opts.briefId,
    orgId: user.orgId,
  });

  const existingAddenda = (brief.content.addenda as unknown[]) ?? [];
  const newAddendum = {
    label: trimmedLabel,
    content: trimmedContent,
    addedBy: opts.addedByOrc ? "orc" : "founder",
    addedAt: new Date().toISOString(),
    reason: opts.reason.trim(),
  };
  const updatedContent = {
    ...brief.content,
    addenda: [...existingAddenda, newAddendum],
  };

  const revisionEntry = {
    ts: new Date().toISOString(),
    section: "addenda",
    oldContent: existingAddenda,
    newContent: updatedContent.addenda,
    editor: { authId: user.authId, kind: opts.addedByOrc ? "orc" : "founder" },
    reason: opts.reason,
    trigger: "addendum_add" as const,
  };

  await db
    .update(agentOutputs)
    .set({
      content: updatedContent,
      revisions: appendCappedRevisions(agentOutputs.revisions, revisionEntry),
    })
    .where(eq(agentOutputs.id, brief.id));

  await revalidateBriefPaths(brief);
  return {
    ok: true,
    addendaCount: existingAddenda.length + 1,
  };
}

// REQUIRED_SECTIONS / SECTION_BOUNDS / SectionName are exported from
// `./furnace-shared` directly. Don't re-export from here — "use server"
// files can only export async functions.
