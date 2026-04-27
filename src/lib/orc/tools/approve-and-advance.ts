import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, agentOutputs, decisionHistory, signals } from "@/db";
import { getMemoryBackend } from "@/lib/orc/memory";
import type { OrcToolContext } from "./types";

/**
 * approve_and_advance — side-effect tool. Approves the most recent
 * PENDING agent_output on the current signal's active journey, which
 * signals the human gate and lets the pipeline advance to the next
 * stage.
 *
 * Same voice-level guard as dismiss: the system prompt requires Inba's
 * explicit word in the current turn before ORC calls this.
 *
 * Phase 8 reality: at the time of this phase, no pipeline stages
 * past BUNKER write to agent_outputs (STOKER is Phase 9+). So
 * approve_and_advance will typically find no PENDING output and
 * return a descriptive no-op. Once STOKER ships and produces outputs
 * gated on human approval, this tool becomes functional end-to-end.
 *
 * The `advance` part of the name is aspirational for Phase 9 —
 * approving a stage's output should also flip the signal.status to
 * the next stage and fire the Inngest event that triggers it. The
 * mechanics for that live in the Phase 9 stage-progression action;
 * this tool currently just marks the approval.
 */

export function approveAndAdvance(ctx: OrcToolContext) {
  return tool({
    description:
      "Approve the current pending stage output and advance the signal to the next stage. Only call after Inba has explicitly said in the current turn to approve it. No-ops gracefully when there's no pending output to approve (e.g., signal is still at BUNKER which approves via the Bridge triage queue, not here).",
    inputSchema: z.object({
      reason: z
        .string()
        .min(4)
        .max(500)
        .optional()
        .describe(
          "Optional note about why approving — what reads right. Recorded on the decision_history row.",
        ),
    }),
    execute: async ({ reason }) => {
      // Load signal context once — used by both decision_history (for
      // the in-DB trail) and the memory write below (for cross-signal
      // pattern recall later). Done outside the transaction since
      // signal metadata is read-only here.
      const [signalRow] = await db
        .select({
          shortcode: signals.shortcode,
          workingTitle: signals.workingTitle,
          concept: signals.concept,
        })
        .from(signals)
        .where(
          and(eq(signals.id, ctx.signalId), eq(signals.orgId, ctx.orgId)),
        )
        .limit(1);

      // Atomic select-and-claim inside one transaction. Pre-CodeRabbit-
      // pass-1, the SELECT and UPDATE were separate statements, leaving
      // a window where two concurrent approve_and_advance calls could
      // both find the same PENDING output and each fire decision_history
      // + memory writes. Now the UPDATE includes status='PENDING' in
      // its WHERE so only one approver wins; the loser sees RETURNING
      // empty and the transaction returns null, which we surface as a
      // clean "no pending output" message instead of double-committing.
      const approval = await db.transaction(async (tx) => {
        const [pending] = await tx
          .select({
            id: agentOutputs.id,
            agentName: agentOutputs.agentName,
          })
          .from(agentOutputs)
          .where(
            and(
              eq(agentOutputs.signalId, ctx.signalId),
              eq(agentOutputs.journeyId, ctx.journeyId),
              eq(agentOutputs.status, "PENDING"),
            ),
          )
          .orderBy(desc(agentOutputs.createdAt))
          .limit(1);

        if (!pending) return null;

        const [approved] = await tx
          .update(agentOutputs)
          .set({
            status: "APPROVED",
            approvedAt: new Date(),
            approvedBy: ctx.userId,
          })
          .where(
            and(
              eq(agentOutputs.id, pending.id),
              eq(agentOutputs.status, "PENDING"),
            ),
          )
          .returning({ id: agentOutputs.id });

        if (!approved) return null; // someone else won the race

        await tx.insert(decisionHistory).values({
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          agentName: pending.agentName,
          decision: "approved",
          reason: reason ?? null,
          decidedBy: ctx.userId,
        });

        return pending;
      });

      if (!approval) {
        return {
          success: false as const,
          message:
            "No pending stage output to approve. It may have just been approved by another request, or this signal's current stage approves through a different surface (e.g., BUNKER approval happens on the Bridge triage queue).",
        };
      }

      // Memory write — Phase 8K hook. Runs AFTER the transaction so a
      // memory backend hiccup never rolls back the approval. The
      // wrapper swallows errors internally (returns {id:''}) so this
      // call is best-effort by design. Explicit container='events'
      // so it's clear this is auto-written event data, not curated
      // knowledge or test data.
      if (signalRow) {
        const memory = await getMemoryBackend();
        await memory.remember({
          orgId: ctx.orgId,
          container: "events",
          kind: "decision",
          content:
            `Approved ${approval.agentName} output on signal ${signalRow.shortcode} "${signalRow.workingTitle}". ` +
            `Concept: ${signalRow.concept ?? "(none yet)"}. ` +
            `Reason: ${reason ?? "(no reason given)"}.`,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          metadata: {
            decision: "approved",
            stage: approval.agentName,
            shortcode: signalRow.shortcode,
          },
        });
      }

      // Phase 9+ will fire the next-stage Inngest event here.
      // For Phase 8, marking the approval is enough — no downstream
      // stage exists yet to receive the event.
      return {
        success: true as const,
        stage: approval.agentName,
        outputId: approval.id,
        message: `Approved the pending ${approval.agentName} output. Pipeline advance wires when the next stage ships.`,
      };
    },
  });
}
