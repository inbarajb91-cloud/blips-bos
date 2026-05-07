import { tool } from "ai";
import { z } from "zod";
import { approveBriefSection } from "@/lib/actions/furnace";
import { REQUIRED_SECTIONS } from "@/lib/actions/furnace-shared";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * approve_brief_section — Phase 10E mutation tool.
 *
 * Wraps approveBriefSection so ORC can mark a single brief section
 * approved when the founder says so. When all 10 required sections are
 * approved, the brief auto-promotes to APPROVED and the manifestation
 * advances to IN_BOILER.
 *
 * Same voice gate as Phase 9G: system prompt requires Inba's explicit
 * word in the current turn. Runtime gate (allowMutation in route.ts)
 * is defense-in-depth.
 */
export function approveBriefSectionTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Approve a single section of a FURNACE brief (designDirection / tactileIntent / moodAndTone / etc.). When all 10 required sections are approved, the brief auto-promotes to APPROVED + advances the manifestation to BOILER. Only call after Inba has explicitly said in the current turn to approve this section.",
    inputSchema: z.object({
      briefAgentOutputId: z
        .string()
        .uuid()
        .describe(
          "The agent_outputs id of the FURNACE brief. Look it up via get_stage_output('furnace') if you don't have it.",
        ),
      section: z
        .enum(REQUIRED_SECTIONS)
        .describe("Which section to approve. One of the 10 required visual sections."),
    }),
    execute: async ({ briefAgentOutputId, section }) => {
      const result = await approveBriefSection({
        briefId: briefAgentOutputId,
        section,
      });

      // Best-effort memory write — Phase 8K hook pattern. Records the
      // section approval so cross-signal recall can surface "we approve
      // tactileIntent on RCD heavyweight signals 80% of the time on first
      // pass." High-signal pattern data over time.
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
            content: `Approved brief section '${section}' on ${row.shortcode} (${row.decade}).${result.allSectionsApproved ? " All sections approved → brief promoted to APPROVED, manifestation advanced to BOILER." : ""}`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "approve_brief_section",
              section,
              shortcode: row.shortcode,
              decade: row.decade,
              briefPromoted: result.allSectionsApproved,
            },
          });
        }
      } catch (err) {
        console.warn("[approve_brief_section] memory write failed (best-effort):", err);
      }

      return {
        success: true as const,
        section,
        allSectionsApproved: result.allSectionsApproved,
        message: result.allSectionsApproved
          ? `Section '${section}' approved → all 10 sections complete → brief APPROVED, manifestation advancing to BOILER.`
          : `Section '${section}' approved.`,
      };
    },
  });
}
