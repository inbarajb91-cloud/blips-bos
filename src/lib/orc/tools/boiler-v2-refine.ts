/**
 * Phase 11D.3c — boiler_v2_refine.
 *
 * Refine the currently-active BOILER design with a specific instruction.
 * Triggers boiler.v2.generate event with mode=refine. The Inngest handler
 * fetches the parent image's bytes, sends to /v1/images/edits along with
 * the instruction, gpt-image-1 produces a modified version.
 *
 * Tier defaults to 'medium' — refinements are typically the iteration sweet
 * spot. Founder can override to 'low' for cheap rapid iteration or 'high'
 * for canonical-quality refinement.
 *
 * Requires an active version in boiler_state. Refuses if none exists (need
 * to call generate_design first).
 */

import { tool } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { boilerState } from "@/db/schema";
import { inngest } from "@/lib/inngest/client";
import { tierSchema, type Tier } from "@/db/zod";
import type { OrcToolContext } from "./types";

export function boilerV2RefineTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Refine the currently-active BOILER design with a specific instruction. The instruction should be concrete and actionable (e.g. 'tighten the front text tracking', 'push the square down 5 units', 'drop the inner glow intensity 30%'). gpt-image-1 sees the parent image and modifies only what's requested. Requires an active version — call generate_design first if there's nothing on the canvas. Tier defaults to 'medium' ($0.053).",
    inputSchema: z.object({
      instruction: z
        .string()
        .min(8)
        .max(800)
        .describe(
          "Concrete refinement to apply. Be specific about which element + what change. E.g. 'tighten the front text letter-spacing to roughly half the current value' is better than 'make the text tighter'.",
        ),
      tier: tierSchema
        .default("medium")
        .describe(
          "Quality tier. low=$0.006 (cheap rapid iteration), medium=$0.053 (default), high=$0.211 (canonical refinement).",
        ),
    }),
    execute: async ({
      instruction,
      tier,
    }: {
      instruction: string;
      tier: Tier;
    }) => {
      // Look up the active version
      const [state] = await db
        .select()
        .from(boilerState)
        .where(
          and(
            eq(boilerState.signalId, ctx.signalId),
            eq(boilerState.journeyId, ctx.journeyId),
          ),
        )
        .limit(1);

      if (!state?.activeVersionId) {
        return {
          success: false as const,
          message:
            "No active BOILER design to refine. Call generate_design first to produce the first draft.",
        };
      }

      const send = await inngest.send({
        name: "boiler.v2.generate",
        data: {
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          tier,
          mode: "refine",
          parentVersionId: state.activeVersionId,
          refinementInstruction: instruction,
          retryDepth: 0,
          triggeredBy: ctx.userId,
        },
      });

      return {
        success: true as const,
        mode: "refine" as const,
        tier,
        parentVersionId: state.activeVersionId,
        message: `Refinement fired at tier=${tier}. gpt-image-1 sees the parent + applies: "${instruction.slice(0, 80)}${instruction.length > 80 ? "…" : ""}". New version in ${tier === "low" ? "15-25s" : tier === "medium" ? "30-60s" : "60-120s"}.`,
        inngestEventIds: send.ids,
      };
    },
  });
}
