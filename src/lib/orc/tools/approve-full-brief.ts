import { tool } from "ai";
import { z } from "zod";
import { approveFullBrief } from "@/lib/actions/furnace";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * approve_full_brief — Phase 10E mutation tool.
 *
 * One-shot whole-brief approve. Marks all 10 required sections approved,
 * promotes brief to APPROVED, advances manifestation IN_FURNACE → IN_BOILER,
 * fires furnace.brief.approved event for Phase 11 BOILER pickup.
 *
 * Use when founder says "approve the brief" / "ship it" / "advance to BOILER"
 * without going section-by-section.
 */
export function approveFullBriefTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Approve the WHOLE brief in one shot. Marks all 10 required sections approved + promotes brief to APPROVED + advances the manifestation from IN_FURNACE to IN_BOILER + fires the boiler.ready event. Only call after Inba has explicitly said in the current turn to approve the full brief / advance to BOILER.",
    inputSchema: z.object({
      briefAgentOutputId: z
        .string()
        .uuid()
        .describe("The agent_outputs id of the FURNACE brief."),
    }),
    execute: async ({ briefAgentOutputId }) => {
      const result = await approveFullBrief({ briefId: briefAgentOutputId });

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
            content: `Approved FURNACE brief in full for ${row.shortcode} (${row.decade}). Manifestation advancing IN_FURNACE → IN_BOILER. boiler.ready fired.`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "approve_full_brief",
              shortcode: row.shortcode,
              decade: row.decade,
            },
          });
        }
      } catch (err) {
        console.warn("[approve_full_brief] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        manifestationShortcode: result.manifestationShortcode,
        message: `Brief APPROVED for ${result.manifestationShortcode}. Manifestation advancing to BOILER.`,
      };
    },
  });
}
