import { tool } from "ai";
import { z } from "zod";
import { editBriefSection } from "@/lib/actions/furnace";
import { REQUIRED_SECTIONS, SECTION_BOUNDS } from "@/lib/actions/furnace-shared";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * edit_brief_section — Phase 10E mutation tool.
 *
 * Direct content edit on a brief section. No LLM call — ORC passes
 * through the founder's typed content. Validates against the section's
 * character bounds. Appends a revisions entry.
 *
 * Cascade flag (Phase 10F downstream consumption): set true when the
 * brief is past IN_FURNACE (i.e. BOILER has rendered). The revisions
 * entry records cascade=true so BOILER's renderer can surface a
 * "regenerate?" prompt. Same pattern as Phase 9G STOKER cascade.
 */
export function editBriefSectionTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Edit a FURNACE brief section's content directly (founder typed the new text, no LLM). Validates against the section's character bounds. For past-gate edits (manifestation past IN_FURNACE), pass cascade=true. Only call after Inba has explicitly said in the current turn to edit this section with specific new text.",
    inputSchema: z.object({
      briefAgentOutputId: z.string().uuid(),
      section: z.enum(REQUIRED_SECTIONS).describe("Which section to edit."),
      newContent: z
        .string()
        .min(60)
        .max(700)
        .describe(
          "The new content. Character bounds vary by section: designDirection 200-700, tactileIntent 100-500, moodAndTone 80-400, compositionApproach 80-400, colorTreatment 80-450, typographicTreatment 100-500, artDirection 100-500, referenceAnchors 100-500, placementIntent 60-300, voiceInVisual 80-400.",
        ),
      reason: z
        .string()
        .min(4)
        .max(500)
        .optional()
        .describe("Why the edit. Recorded in the revision history."),
      cascade: z
        .boolean()
        .optional()
        .describe(
          "Set true to allow editing past the IN_FURNACE gate (manifestation has advanced to BOILER+). Without this, the action throws on non-IN_FURNACE status. Future BOILER detects the cascade flag and surfaces a regenerate prompt.",
        ),
    }),
    execute: async ({ briefAgentOutputId, section, newContent, reason, cascade }) => {
      // Pre-validate against section-specific bounds — friendlier error
      // here so ORC can retry with shorter content vs failing with a
      // generic "Provide at least one of..." message.
      const bounds = SECTION_BOUNDS[section];
      const trimmedLen = newContent.trim().length;
      if (trimmedLen < bounds.min || trimmedLen > bounds.max) {
        return {
          success: false as const,
          message: `Section '${section}' must be ${bounds.min}-${bounds.max} characters (got ${trimmedLen}). Reword and call again.`,
        };
      }

      const result = await editBriefSection({
        briefId: briefAgentOutputId,
        section,
        newContent,
        reason,
        cascade,
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
            content:
              `Edited brief section '${section}' on ${row.shortcode} (${row.decade}). ` +
              (cascade ? "Past-gate edit with cascade. " : "Pre-gate edit. ") +
              `Reason: ${reason ?? "(no reason given)"}.`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "edit_brief_section",
              section,
              shortcode: row.shortcode,
              decade: row.decade,
              cascade: cascade === true,
            },
          });
        }
      } catch (err) {
        console.warn("[edit_brief_section] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        section,
        revisionsCount: result.revisionsCount,
        message: `Section '${section}' updated. Revision ${result.revisionsCount} recorded.${cascade ? " Cascade flag set — downstream BOILER will see this as past-gate." : ""} Section's prior approval (if any) is now invalidated and needs re-approval.`,
      };
    },
  });
}
