import { tool } from "ai";
import { z } from "zod";
import { addBriefAddendum } from "@/lib/actions/furnace";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * add_brief_addendum — Phase 10E mutation tool.
 *
 * Direct add of an addendum to a brief's addenda[] array. Used after
 * `propose_brief_addendum` chip was approved by founder, OR when
 * founder asks ORC to "add this addendum" with explicit content.
 *
 * Addenda are extensions to the core 11 sections — hangtag content,
 * special instructions, etc. BOILER reads them as supplementary context.
 */
export function addBriefAddendumTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Add an addendum (extra labelled section) to a FURNACE brief's addenda[] array. Use when founder explicitly asks to add a specific addendum with label + content. The addendum is recorded as added by ORC; founder also sees it in the renderer's addenda list. Only call after Inba has explicitly said in the current turn to add this addendum with specific content.",
    inputSchema: z.object({
      briefAgentOutputId: z.string().uuid(),
      label: z
        .string()
        .min(5)
        .max(50)
        .describe("Short label for the addendum (e.g. 'Hangtag content', 'Inside-neck print'). 5-50 chars."),
      content: z
        .string()
        .min(50)
        .max(500)
        .describe("The addendum's content. 50-500 chars."),
      reason: z
        .string()
        .min(50)
        .max(300)
        .describe("Why this addendum is being added — what gap in the core 11 sections it fills. 50-300 chars."),
    }),
    execute: async ({ briefAgentOutputId, label, content, reason }) => {
      const result = await addBriefAddendum({
        briefId: briefAgentOutputId,
        label,
        content,
        reason,
        addedByOrc: true,
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
            content: `Added addendum '${label}' to brief on ${row.shortcode} (${row.decade}). Reason: ${reason}`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "add_brief_addendum",
              label,
              shortcode: row.shortcode,
              decade: row.decade,
            },
          });
        }
      } catch (err) {
        console.warn("[add_brief_addendum] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        label,
        addendaCount: result.addendaCount,
        message: `Addendum '${label}' added. Brief now has ${result.addendaCount} addendum(s). BOILER will read this as supplementary context.`,
      };
    },
  });
}
