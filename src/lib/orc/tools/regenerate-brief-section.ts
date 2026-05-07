import { tool } from "ai";
import { z } from "zod";
import { regenerateBriefSection } from "@/lib/actions/furnace";
import { REQUIRED_SECTIONS } from "@/lib/actions/furnace-shared";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * regenerate_brief_section — Phase 10E mutation tool.
 *
 * Scoped LLM-driven regen of ONE section based on founder feedback.
 * ~10-15% the cost of full-brief regen because the LLM only writes
 * the one section. Section approval invalidates on regen — needs
 * re-approval after.
 */
export function regenerateBriefSectionTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Regenerate a single FURNACE brief section with founder feedback (LLM call, ~10-15% the cost of full regen). Other sections stay intact. The section's prior approval (if any) is invalidated. Only call after Inba has explicitly said in the current turn to redo this specific section with specific feedback.",
    inputSchema: z.object({
      briefAgentOutputId: z.string().uuid(),
      section: z.enum(REQUIRED_SECTIONS).describe("Which section to regenerate."),
      reason: z
        .string()
        .min(4)
        .max(600)
        .describe(
          "What's wrong with the current section + the direction the founder wants. The LLM uses this to shape the new content. Be specific — vague feedback produces vague regens.",
        ),
    }),
    execute: async ({ briefAgentOutputId, section, reason }) => {
      const result = await regenerateBriefSection({
        briefId: briefAgentOutputId,
        section,
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
            content: `Regenerated brief section '${section}' on ${row.shortcode} (${row.decade}). Reason: ${reason}`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "regenerate_brief_section",
              section,
              shortcode: row.shortcode,
              decade: row.decade,
            },
          });
        }
      } catch (err) {
        console.warn("[regenerate_brief_section] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        section,
        revisionsCount: result.revisionsCount,
        message: `Section '${section}' regenerated with founder feedback. Revision ${result.revisionsCount} recorded. Section's prior approval is invalidated — founder needs to re-approve.`,
      };
    },
  });
}
