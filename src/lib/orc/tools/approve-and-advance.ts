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
      // Find the latest PENDING agent_output on the active journey
      const [pending] = await db
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

      if (!pending) {
        return {
          success: false as const,
          message:
            "No pending stage output to approve. This signal's current stage may approve through a different surface (e.g., BUNKER approval happens on the Bridge triage queue), or all stage outputs are already approved.",
        };
      }

      // Load signal context once — used by both decision_history (for
      // the in-DB trail) and the memory write below (for cross-signal
      // pattern recall later).
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

      await db.transaction(async (tx) => {
        await tx
          .update(agentOutputs)
          .set({
            status: "APPROVED",
            approvedAt: new Date(),
            approvedBy: ctx.userId,
          })
          .where(eq(agentOutputs.id, pending.id));

        await tx.insert(decisionHistory).values({
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          agentName: pending.agentName,
          decision: "approved",
          reason: reason ?? null,
          decidedBy: ctx.userId,
        });
      });

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
            `Approved ${pending.agentName} output on signal ${signalRow.shortcode} "${signalRow.workingTitle}". ` +
            `Concept: ${signalRow.concept ?? "(none yet)"}. ` +
            `Reason: ${reason ?? "(no reason given)"}.`,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          metadata: {
            decision: "approved",
            stage: pending.agentName,
            shortcode: signalRow.shortcode,
          },
        });
      }

      // Phase 9+ will fire the next-stage Inngest event here.
      // For Phase 8, marking the approval is enough — no downstream
      // stage exists yet to receive the event.
      return {
        success: true as const,
        stage: pending.agentName,
        outputId: pending.id,
        message: `Approved the pending ${pending.agentName} output. Pipeline advance wires when the next stage ships.`,
      };
    },
  });
}
