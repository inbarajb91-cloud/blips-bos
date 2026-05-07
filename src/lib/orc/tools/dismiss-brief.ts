import { tool } from "ai";
import { z } from "zod";
import { dismissBrief } from "@/lib/actions/furnace";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * dismiss_brief — Phase 10E mutation tool.
 *
 * Founder rejects the brief. Sets agent_outputs.status='REJECTED' +
 * records a decision_history entry. Manifestation stays at IN_FURNACE
 * (founder can ask ORC to regenerate_full_brief OR dismiss the
 * manifestation entirely on its STOKER tab).
 *
 * Different from regenerate — dismiss is "this brief direction is wrong,
 * stop." Regenerate is "redo with feedback."
 */
export function dismissBriefTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Dismiss a FURNACE brief — founder rejects it. Brief moves to REJECTED status; manifestation stays at IN_FURNACE for re-run via regenerate_full_brief OR dismissal of the whole manifestation. Only call after Inba has explicitly said in the current turn to dismiss / reject the brief.",
    inputSchema: z.object({
      briefAgentOutputId: z
        .string()
        .uuid()
        .describe("The agent_outputs id of the FURNACE brief."),
      reason: z
        .string()
        .min(4)
        .max(500)
        .describe(
          "Why the brief is being dismissed. 4-500 chars. Recorded in decision_history audit trail.",
        ),
    }),
    execute: async ({ briefAgentOutputId, reason }) => {
      const result = await dismissBrief({
        briefId: briefAgentOutputId,
        reason,
      });

      try {
        const [row] = await db
          .select({
            shortcode: signals.shortcode,
            decade: signals.manifestationDecade,
          })
          .from(agentOutputs)
          .innerJoin(signals, eq(agentOutputs.signalId, signals.id))
          .where(
            and(
              eq(agentOutputs.id, briefAgentOutputId),
              eq(signals.orgId, ctx.orgId),
            ),
          )
          .limit(1);
        if (row) {
          const memory = await getMemoryBackend();
          await memory.remember({
            orgId: ctx.orgId,
            container: "events",
            kind: "decision",
            content: `Dismissed FURNACE brief for ${row.shortcode} (${row.decade}). Reason: ${reason}`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "dismiss_brief",
              shortcode: row.shortcode,
              decade: row.decade,
            },
          });
        }
      } catch (err) {
        console.warn("[dismiss_brief] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        manifestationShortcode: result.manifestationShortcode,
        message: `Brief dismissed for ${result.manifestationShortcode}. Manifestation stays at IN_FURNACE — ask the founder if they want to regenerate (with feedback) or dismiss the manifestation entirely.`,
      };
    },
  });
}
