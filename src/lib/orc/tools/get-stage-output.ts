import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, agentOutputs } from "@/db";
import type { OrcToolContext } from "./types";

/**
 * get_stage_output — fetches the latest agent_output row for a
 * specific stage, scoped to the current signal's active journey.
 * Used when ORC needs to reference what a prior stage actually
 * produced (e.g., "what did FURNACE score this at?").
 *
 * Returns the latest row when multiple outputs exist for the same
 * stage (shouldn't happen in Phase 8 — one output per stage per
 * journey — but defensive ordering handles future variations).
 */

const STAGE_NAMES = [
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
] as const;

export function getStageOutput(ctx: OrcToolContext) {
  return tool({
    description:
      "Fetch the structured output from a specific pipeline stage for the current signal. Returns content, status (PENDING / APPROVED / REJECTED), and approval metadata if set. Returns null if the stage hasn't run yet on the current journey.",
    inputSchema: z.object({
      stage: z
        .enum(STAGE_NAMES)
        .describe("Which pipeline stage's output to fetch"),
    }),
    execute: async ({ stage }) => {
      const [row] = await db
        .select({
          id: agentOutputs.id,
          outputType: agentOutputs.outputType,
          content: agentOutputs.content,
          status: agentOutputs.status,
          approvedAt: agentOutputs.approvedAt,
          createdAt: agentOutputs.createdAt,
        })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, ctx.signalId),
            eq(agentOutputs.journeyId, ctx.journeyId),
            eq(agentOutputs.agentName, stage),
          ),
        )
        .orderBy(desc(agentOutputs.createdAt))
        .limit(1);

      if (!row) {
        return {
          stage,
          status: "not_run" as const,
          message: `${stage} has not produced an output on the active journey yet.`,
        };
      }

      return {
        stage,
        status: row.status,
        outputId: row.id,
        outputType: row.outputType,
        content: row.content,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    },
  });
}
