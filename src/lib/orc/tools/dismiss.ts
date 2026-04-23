import { tool } from "ai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, signals, decisionHistory } from "@/db";
import type { OrcToolContext } from "./types";

/**
 * dismiss — side-effect tool. Marks the current signal as dismissed.
 * Sets signals.status = 'DISMISSED' and writes a decision_history
 * row with the reason. The system prompt forbids ORC from calling
 * this without Inba's explicit word in the current turn — the guard
 * is voice-level, not mechanical. The LLM obeys via the prompt; we
 * additionally record the decision so there's always a trail.
 *
 * Scoped to the current active journey. If a later journey is reset
 * from an earlier stage, its outputs survive under the archived
 * journey; dismissal applies to the whole signal, not a single
 * attempt.
 */

export function dismissSignal(ctx: OrcToolContext) {
  return tool({
    description:
      "Dismiss the current signal. Only call after Inba has explicitly said in the current turn to dismiss it. The reason gets recorded in the signal's decision history.",
    inputSchema: z.object({
      reason: z
        .string()
        .min(4)
        .max(500)
        .describe(
          "Short reason for dismissing — why this signal doesn't merit pipeline work. Will be recorded in decision_history.",
        ),
    }),
    execute: async ({ reason }) => {
      // Atomic: update signal status + write decision_history in one
      // transaction. Either both land or neither does.
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(signals)
          .set({ status: "DISMISSED", updatedAt: new Date() })
          .where(
            and(eq(signals.id, ctx.signalId), eq(signals.orgId, ctx.orgId)),
          )
          .returning({ id: signals.id });

        if (!updated) {
          throw new Error(
            "Signal not found or not in your org. Dismissal aborted.",
          );
        }

        await tx.insert(decisionHistory).values({
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          agentName: "ORC",
          decision: "dismissed",
          reason,
          decidedBy: ctx.userId,
        });
      });

      return {
        success: true as const,
        message: "Signal dismissed. It will no longer appear in the active pipeline.",
      };
    },
  });
}
