import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, agentOutputs } from "@/db";
import type { OrcToolContext } from "./types";

/**
 * get_stage_output — fetches the latest agent_output row for a
 * specific stage. Used when ORC needs to reference what a prior stage
 * actually produced (e.g., "what did FURNACE score this at?").
 *
 * Phase 10.4.2 routing fix: post-STOKER stages (FURNACE / BOILER /
 * ENGINE / PROPELLER) live on manifestation child signals, not on the
 * parent. When the user is on a parent workspace viewing one of these
 * tabs with an active manifestation in the URL (?m=), this tool used
 * to query the parent's signalId — which never has post-STOKER outputs
 * — and report "not run yet" even though the manifestation's brief was
 * right in front of the user. Now: BUNKER/STOKER queries stay on the
 * parent; FURNACE+ queries route to ctx.activeManifestation when set.
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

const POST_STOKER_STAGES = new Set<(typeof STAGE_NAMES)[number]>([
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
]);

export function getStageOutput(ctx: OrcToolContext) {
  return tool({
    description:
      "Fetch the structured output from a specific pipeline stage for the current signal. Returns content, status (PENDING / APPROVED / REJECTED), and approval metadata if set. Returns null if the stage hasn't run yet. For post-STOKER stages (FURNACE / BOILER / ENGINE / PROPELLER), if the user is on a parent workspace with an active manifestation, this routes to that manifestation's child signal automatically — you don't need to specify which one.",
    inputSchema: z.object({
      stage: z
        .enum(STAGE_NAMES)
        .describe("Which pipeline stage's output to fetch"),
    }),
    execute: async ({ stage }) => {
      // Route to the active manifestation child for post-STOKER stages
      // when one is set. Parent fallback when not (e.g. user is on a
      // manifestation child's own URL — its signalId IS the child's,
      // ctx.activeManifestation is null).
      const isPostStoker = POST_STOKER_STAGES.has(stage);
      const useManifestation =
        isPostStoker && ctx.activeManifestation !== null;
      const targetSignalId = useManifestation
        ? ctx.activeManifestation!.signalId
        : ctx.signalId;
      const targetJourneyId = useManifestation
        ? ctx.activeManifestation!.journeyId
        : ctx.journeyId;

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
            eq(agentOutputs.signalId, targetSignalId),
            eq(agentOutputs.journeyId, targetJourneyId),
            eq(agentOutputs.agentName, stage),
          ),
        )
        .orderBy(desc(agentOutputs.createdAt))
        .limit(1);

      const scope = useManifestation
        ? {
            kind: "manifestation" as const,
            shortcode: ctx.activeManifestation!.shortcode,
            decade: ctx.activeManifestation!.decade,
          }
        : { kind: "parent" as const };

      if (!row) {
        const scopeNote = useManifestation
          ? ` on the ${ctx.activeManifestation!.shortcode} (${ctx.activeManifestation!.decade}) manifestation`
          : "";
        return {
          stage,
          status: "not_run" as const,
          message: `${stage} has not produced an output${scopeNote} on the active journey yet.`,
          scopedTo: scope,
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
        scopedTo: scope,
      };
    },
  });
}
