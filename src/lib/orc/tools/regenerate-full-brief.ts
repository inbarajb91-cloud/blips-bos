import { tool } from "ai";
import { z } from "zod";
import { regenerateFullBrief } from "@/lib/actions/furnace";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * regenerate_full_brief — Phase 10E mutation tool.
 *
 * Full LLM regeneration of the entire brief. Higher cost than section
 * regen — use when the brief's premise is wrong, not just one section.
 * All section approvals reset to none. Brief's revision history records
 * the full-brief regen with the founder's feedback.
 */
export function regenerateFullBriefTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Regenerate the WHOLE FURNACE brief with founder feedback (LLM call, full cost). All sections re-written. All section approvals reset. Use only when the brief's premise is wrong — not for one-section fixes (use regenerate_brief_section for those). Only call after Inba has explicitly said in the current turn to redo the full brief.",
    inputSchema: z.object({
      briefAgentOutputId: z.string().uuid(),
      reason: z
        .string()
        .min(4)
        .max(600)
        .describe(
          "What's wrong with the current brief + the direction the founder wants. The LLM reads this as a regeneration directive. Be specific.",
        ),
    }),
    execute: async ({ briefAgentOutputId, reason }) => {
      const result = await regenerateFullBrief({
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
            content: `Regenerated FULL brief on ${row.shortcode} (${row.decade}). New brand-fit ${result.brandFitScore}/100, refused=${result.refused}. Reason: ${reason}`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "regenerate_full_brief",
              shortcode: row.shortcode,
              decade: row.decade,
              brandFitScore: result.brandFitScore,
              refused: result.refused,
            },
          });
        }
      } catch (err) {
        console.warn("[regenerate_full_brief] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        manifestationShortcode: result.manifestationShortcode,
        brandFitScore: result.brandFitScore,
        refused: result.refused,
        message: result.refused
          ? `Brief regenerated and FURNACE refused (brand-fit ${result.brandFitScore}/100). Founder may force-advance via dismiss_brief or accept the refusal.`
          : `Brief regenerated with new brand-fit ${result.brandFitScore}/100. All section approvals reset — founder reviews fresh.`,
      };
    },
  });
}
