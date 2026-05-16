/**
 * Phase 11D.3c — boiler_v2_branch.
 *
 * Fork a new design lineage from a historical version. Same gpt-image-1
 * input shape as refine (parent image goes to /v1/images/edits), but no
 * refinement instruction — the prompt asks for a "parallel exploration"
 * rather than a directed change.
 *
 * Useful when the founder wants to:
 *   - Compare alternative directions from a known-good version
 *   - Recover a discarded thread (branch off an older parent, get a fresh path)
 *   - A/B explore from the same starting point
 *
 * Branching does NOT change the active version — the new version becomes
 * active automatically (handler updates boiler_state.active_version_id),
 * but the original parent stays in history.
 */

import { tool } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { designVersions } from "@/db/schema";
import { inngest } from "@/lib/inngest/client";
import { tierSchema, type Tier } from "@/db/zod";
import type { OrcToolContext } from "./types";

export function boilerV2BranchTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Fork a new design line from a historical version (parallel exploration). gpt-image-1 sees the parent image and produces an alternative variation within the same palette + composition rules. Useful when the founder wants to compare directions or recover from a thread that went sideways. Different from refine: no specific instruction, model freely explores alternatives.",
    inputSchema: z.object({
      fromVersionId: z
        .string()
        .uuid()
        .describe(
          "The design_versions row to fork from. Look up via get_stage_output('BOILER') for the history strip.",
        ),
      tier: tierSchema
        .default("medium")
        .describe(
          "Quality tier. Branching is typically medium ($0.053) — exploring alternatives at low quality wastes the comparison.",
        ),
    }),
    execute: async ({
      fromVersionId,
      tier,
    }: {
      fromVersionId: string;
      tier: Tier;
    }) => {
      // Validate the parent exists + isn't discarded
      const [parent] = await db
        .select()
        .from(designVersions)
        .where(
          and(
            eq(designVersions.id, fromVersionId),
            eq(designVersions.orgId, ctx.orgId),
            eq(designVersions.signalId, ctx.signalId),
          ),
        )
        .limit(1);
      if (!parent) {
        return {
          success: false as const,
          message: `Source version ${fromVersionId} not found on this signal.`,
        };
      }
      if (parent.discarded) {
        return {
          success: false as const,
          message: `Source version ${fromVersionId} was discarded. Restore it via the UI history strip first or pick a different parent.`,
        };
      }
      if (!parent.flatArtworkUrl) {
        return {
          success: false as const,
          message: `Source version ${fromVersionId} has no flat artwork URL (likely a failed generation). Pick a successful parent to branch from.`,
        };
      }

      const send = await inngest.send({
        name: "boiler.v2.generate",
        data: {
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          tier,
          mode: "branch",
          parentVersionId: fromVersionId,
          retryDepth: 0,
          triggeredBy: ctx.userId,
        },
      });

      return {
        success: true as const,
        mode: "branch" as const,
        tier,
        fromVersionId,
        message: `Branching from version ${fromVersionId} at tier=${tier}. New parallel design in ${tier === "low" ? "15-25s" : tier === "medium" ? "30-60s" : "60-120s"}.`,
        inngestEventIds: send.ids,
      };
    },
  });
}
