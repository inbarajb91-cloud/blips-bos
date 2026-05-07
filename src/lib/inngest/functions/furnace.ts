import { and, eq, ilike, sql, desc } from "drizzle-orm";
import { inngest } from "../client";
import {
  db,
  signals as signalsTable,
  agentOutputs,
  knowledgeDocuments,
} from "@/db";
import { runSkill } from "@/lib/orc/orchestrator";
import { getMemoryBackend } from "@/lib/orc/memory";
import "@/skills"; // ensure skill registry is populated
import type { FurnaceInput, FurnaceOutput } from "@/skills/furnace";

type DecadeKey = "RCK" | "RCL" | "RCD";

/**
 * FURNACE Inngest function — Phase 10C.
 *
 * Triggered by `stoker.manifestation.approved` (fired from
 * `approveStokerManifestation` server action when founder approves a
 * STOKER manifestation card). Orchestrates the FURNACE pipeline stage
 * end-to-end:
 *
 *   1. Load the manifestation child signal + verify it's at IN_FURNACE
 *      (status the approve action sets) + load the parent signal context
 *      + load the manifestation's STOKER agent_outputs row (the framing
 *      hook + tension + angle + dimensionAlignment)
 *   2. Recall knowledge context: the manifestation's decade playbook +
 *      BRAND.md + MATERIALS.md from knowledge_documents (fall through
 *      to empty strings when not yet authored — system prompt has
 *      fallback path)
 *   3. Recall up to 3 past briefs for this decade from the events
 *      container (Tier 3 visual consistency learning) — best-effort,
 *      empty array on cold start
 *   4. Run FURNACE skill via runSkill (one LLM call, one agent_outputs
 *      row on the manifestation child — outputType='brief')
 *   5. If refused: flip manifestation status IN_FURNACE → FURNACE_REFUSED.
 *      Otherwise: leave at IN_FURNACE (founder reviews + approves to
 *      advance to BOILER via the approve_full_brief tool / UI button)
 *   6. Best-effort write a furnace.complete event to the supermemory
 *      events container (Tier 3 — every brief contributes to BLIPS's
 *      learned visual patterns over time)
 *
 * Design alignment with Model 3 (agents/FURNACE.md):
 *   - Brief lives as agent_outputs row on the manifestation signal —
 *     no new tables, no separate briefs table.
 *   - Founder gate uses the existing pattern: agent_outputs.status='PENDING'
 *     means "awaiting founder review of the brief." Per-section approval
 *     (sectionApprovals JSONB) provides granular flow.
 *
 * Failure handling: each step uses Inngest's step.run() so transient
 * failures retry independently. If runSkill itself fails (LLM error,
 * fallback chain exhausted), the function fails and Inngest retries
 * per its default backoff. Manifestation stays at IN_FURNACE until the
 * retry succeeds or the function gives up. Founder can re-trigger via
 * ORC's regenerate_full_brief tool when needed.
 */
export const furnaceProcess = inngest.createFunction(
  {
    id: "furnace-process",
    triggers: [{ event: "stoker.manifestation.approved" }],
    // FURNACE is bursty (founder approves manifestation cards). Keep
    // concurrency small per-org so a wave of approvals doesn't overload
    // the LLM provider — Phase 10G eval may bump this up after we see
    // production patterns.
    concurrency: { limit: 4, key: "event.data.orgId" },
    onFailure: async ({ event }) => {
      const data = (event.data as { event?: { data?: unknown } } | undefined)
        ?.event?.data;
      console.error(
        "[FURNACE] onFailure — function exhausted retries:",
        JSON.stringify(data),
      );
    },
  },
  async ({ event, step }) => {
    const { orgId, manifestationSignalId } = event.data as {
      orgId: string;
      manifestationSignalId: string;
    };

    // ─── 1. Load manifestation + parent + STOKER context ────────
    const context = await step.run("load-manifestation-context", async () => {
      // Manifestation child signal
      const [child] = await db
        .select({
          id: signalsTable.id,
          shortcode: signalsTable.shortcode,
          workingTitle: signalsTable.workingTitle,
          concept: signalsTable.concept,
          status: signalsTable.status,
          parentSignalId: signalsTable.parentSignalId,
          manifestationDecade: signalsTable.manifestationDecade,
        })
        .from(signalsTable)
        .where(
          and(
            eq(signalsTable.id, manifestationSignalId),
            eq(signalsTable.orgId, orgId),
          ),
        )
        .limit(1);
      if (!child) {
        throw new Error(
          `[FURNACE] Manifestation signal ${manifestationSignalId} not found for org ${orgId}.`,
        );
      }
      if (child.parentSignalId === null) {
        throw new Error(
          `[FURNACE] Signal ${manifestationSignalId} is not a manifestation child (parent_signal_id IS NULL). FURNACE only runs on STOKER-produced children.`,
        );
      }
      if (child.manifestationDecade === null) {
        throw new Error(
          `[FURNACE] Signal ${manifestationSignalId} has parent_signal_id but null manifestation_decade — schema invariant violation.`,
        );
      }
      // IN_FURNACE is the expected state (the approve action sets it).
      // Allow IN_BOILER too as an idempotent retry path — if the function
      // partially completed and the brief was already written + advanced,
      // a re-run shouldn't blow up. Skip silently on those.
      if (child.status !== "IN_FURNACE" && child.status !== "IN_BOILER") {
        throw new Error(
          `[FURNACE] Manifestation ${child.shortcode} status is ${child.status}, expected IN_FURNACE. Approve action may not have completed.`,
        );
      }

      // Parent signal (for parentShortcode in skill input)
      const [parent] = await db
        .select({
          id: signalsTable.id,
          shortcode: signalsTable.shortcode,
        })
        .from(signalsTable)
        .where(eq(signalsTable.id, child.parentSignalId!))
        .limit(1);
      if (!parent) {
        throw new Error(
          `[FURNACE] Parent signal ${child.parentSignalId} not found — manifestation is orphaned.`,
        );
      }

      // STOKER agent_outputs row on the manifestation (carries the
      // framing hook + tension + angle + dimensionAlignment that FURNACE
      // reads as primary input)
      const [stokerOutput] = await db
        .select({
          content: agentOutputs.content,
        })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, child.id),
            eq(agentOutputs.agentName, "STOKER"),
          ),
        )
        .limit(1);
      if (!stokerOutput) {
        throw new Error(
          `[FURNACE] STOKER output row not found on manifestation ${child.shortcode}. Cannot derive brief without STOKER framing.`,
        );
      }

      return {
        child,
        parent,
        stokerContent: stokerOutput.content as Record<string, unknown>,
      };
    });

    const decade = context.child.manifestationDecade as DecadeKey;

    // ─── 2. Recall knowledge context ────────────────────────────
    // Title-based lookup (case-insensitive). Phase 9H seeds three decade
    // playbooks + BRAND.md; Phase 10 scaffolds MATERIALS.md. Missing docs
    // return empty strings; FURNACE's prompt has a "(not yet authored —
    // fall back to system prompt)" path for empty bodies.
    const knowledgeContext = await step.run(
      "fetch-knowledge-context",
      async () => {
        const playbookTitles: Record<DecadeKey, string> = {
          RCK: "RCK Decade Playbook",
          RCL: "RCL Decade Playbook",
          RCD: "RCD Decade Playbook",
        };

        const fetchByTitle = async (title: string): Promise<string> => {
          const [doc] = await db
            .select({ content: knowledgeDocuments.content })
            .from(knowledgeDocuments)
            .where(
              and(
                eq(knowledgeDocuments.orgId, orgId),
                eq(knowledgeDocuments.status, "active"),
                ilike(knowledgeDocuments.title, title),
              ),
            )
            .limit(1);
          return doc?.content ?? "";
        };

        const [decadePlaybook, brandIdentity, materialsVocabulary] =
          await Promise.all([
            fetchByTitle(playbookTitles[decade]),
            fetchByTitle("BLIPS Brand Identity"),
            fetchByTitle("BLIPS Materials Playbook"),
          ]);

        return { decadePlaybook, brandIdentity, materialsVocabulary };
      },
    );

    // ─── 3. Recall past briefs for this decade (Tier 3 learning) ─
    // Best-effort. Cold start (no past briefs) is fine — empty array.
    // We pull from agent_outputs directly rather than supermemory because
    // the structured fields (designDirection, tactileIntent) are easier
    // to extract from JSONB than from semantic-search summaries. Limit
    // to 3 most-recent APPROVED briefs to keep prompt bounded.
    const pastBriefs = await step.run(
      "recall-past-briefs",
      async () => {
        const rows = await db
          .select({
            content: agentOutputs.content,
            shortcode: signalsTable.shortcode,
            workingTitle: signalsTable.workingTitle,
            approvedAt: agentOutputs.approvedAt,
          })
          .from(agentOutputs)
          .innerJoin(
            signalsTable,
            eq(agentOutputs.signalId, signalsTable.id),
          )
          .where(
            and(
              eq(agentOutputs.agentName, "FURNACE"),
              eq(agentOutputs.status, "APPROVED"),
              eq(signalsTable.orgId, orgId),
              eq(signalsTable.manifestationDecade, decade),
              // Don't include ourselves if this is a re-run (idempotent
              // retry after a partial completion).
              sql`${signalsTable.id} <> ${context.child.id}`,
            ),
          )
          .orderBy(desc(agentOutputs.approvedAt))
          .limit(3);

        return rows
          .map((row) => {
            const c = row.content as {
              designDirection?: string | null;
              tactileIntent?: string | null;
            };
            // Only include briefs with non-null core sections (skip
            // refused briefs even if somehow APPROVED — defensive)
            if (!c.designDirection || !c.tactileIntent) return null;
            return {
              shortcode: row.shortcode,
              workingTitle: row.workingTitle,
              designDirection: c.designDirection,
              tactileIntent: c.tactileIntent,
              approvedAt: row.approvedAt?.toISOString() ?? "",
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
      },
    );

    // ─── 4. Build FURNACE skill input + run ─────────────────────
    const stokerContent = context.stokerContent as {
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
      !stokerContent.framingHook ||
      !stokerContent.tensionAxis ||
      !stokerContent.narrativeAngle ||
      !stokerContent.dimensionAlignment
    ) {
      throw new Error(
        `[FURNACE] STOKER content on manifestation ${context.child.shortcode} is malformed — missing framingHook / tensionAxis / narrativeAngle / dimensionAlignment.`,
      );
    }

    const skillInput: FurnaceInput = {
      signalId: context.child.id,
      shortcode: context.child.shortcode,
      workingTitle: context.child.workingTitle,
      concept: context.child.concept ?? "",
      manifestationDecade: decade,
      parentSignalId: context.parent.id,
      parentShortcode: context.parent.shortcode,
      manifestation: {
        framingHook: stokerContent.framingHook,
        tensionAxis: stokerContent.tensionAxis,
        narrativeAngle: stokerContent.narrativeAngle,
        dimensionAlignment: stokerContent.dimensionAlignment,
      },
      knowledgeContext,
      pastBriefsForDecade: pastBriefs,
    };

    const result = await step.run("run-furnace-skill", async () => {
      return runSkill<FurnaceInput, FurnaceOutput>({
        agentKey: "FURNACE",
        orgId,
        signalId: context.child.id,
        input: skillInput,
      });
    });

    const briefOutput = result.output;

    // ─── 5. Update manifestation status if refused ──────────────
    if (briefOutput.refused) {
      await step.run("flip-manifestation-furnace-refused", async () => {
        await db
          .update(signalsTable)
          .set({ status: "FURNACE_REFUSED", updatedAt: new Date() })
          .where(eq(signalsTable.id, context.child.id));
      });
    }
    // When not refused: manifestation stays at IN_FURNACE.
    // Founder reviews the brief + approves via UI/ORC tool, which advances
    // status to IN_BOILER (and fires boiler.ready in Phase 11).

    // ─── 6. Best-effort memory write (Tier 3 learning hook) ─────
    // furnace.complete event lands in the supermemory events container
    // scoped by (signalId, orgId). Cross-signal recall can then surface
    // patterns ("we've used heavyweight cotton + indigo on 4 of last 5
    // RCD heavyweight signals"). Best-effort because supermemory is a
    // hosted dependency — transient failures must not extend this
    // Inngest step's runtime or surface as function failures.
    //
    // NOTE: this is in addition to the Phase 8K stage_completion hook
    // that runSkill already writes. This event is FURNACE-specific
    // (brief metadata) for richer recall later.
    void (async () => {
      try {
        const memory = await getMemoryBackend();
        const refusedSummary = briefOutput.refused
          ? `REFUSED · ${briefOutput.refusalReason ?? "(no rationale)"}`
          : `APPROVED-PENDING · ${briefOutput.designDirection?.slice(0, 200) ?? "(no direction)"}`;

        await memory.remember({
          orgId,
          container: "events",
          kind: "stage_completion",
          content: `FURNACE generated a brief for ${context.child.shortcode} (${decade}). brand-fit ${briefOutput.brandFitScore}/100. ${refusedSummary}. tactileIntent: ${briefOutput.tactileIntent?.slice(0, 200) ?? "(none — refused)"}`,
          signalId: context.child.id,
          metadata: {
            stage: "furnace",
            decade,
            shortcode: context.child.shortcode,
            brandFitScore: briefOutput.brandFitScore,
            refused: briefOutput.refused,
            parentShortcode: context.parent.shortcode,
          },
        });
      } catch (err) {
        console.warn(
          "[FURNACE] memory.remember failed (best-effort, brief still in DB):",
          err,
        );
      }
    })();

    return {
      manifestationSignalId: context.child.id,
      manifestationShortcode: context.child.shortcode,
      decade,
      furnaceOutputId: result.outputId,
      brandFitScore: briefOutput.brandFitScore,
      refused: briefOutput.refused,
      finalStatus: briefOutput.refused ? "FURNACE_REFUSED" : "IN_FURNACE",
    };
  },
);
