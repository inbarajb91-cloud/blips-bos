/**
 * Phase 11D.3c — boiler_v2_generate.
 *
 * Fire a fresh BOILER v2 generation. Triggers boiler.v2.generate event with
 * mode=fresh. Inngest handler does the heavy lifting (gpt-image-1 call +
 * Cloudinary upload + verifier + persist + maybe-auto-retry).
 *
 * Returns immediately with the Inngest event id — the workspace renderer
 * subscribes to design_versions realtime events to pick up the new row when
 * it lands (~20-90s depending on tier).
 *
 * Cost guard: this tool can spend $0.006 (low) / $0.053 (medium) / $0.211
 * (high) per call. Default tier is medium (refinement-quality); founder
 * picks tier via the UI selector or explicitly in chat.
 */

import { tool } from "ai";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { tierSchema, type Tier } from "@/db/zod";
import type { OrcToolContext } from "./types";

export function boilerV2GenerateTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Fire a fresh BOILER design generation. Produces ONE design from the current FURNACE brief + active palette (no parent — full-prompt generation). Use when the founder wants to start over or generate the first draft. For iterating on an existing version, use refine_design instead. Tier defaults to 'medium' ($0.053) — pass 'low' ($0.006) for direction-finding drafts or 'high' ($0.211) for canonical output.",
    inputSchema: z.object({
      tier: tierSchema
        .default("medium")
        .describe(
          "Quality tier. low=$0.006 (direction-finding), medium=$0.053 (refinement), high=$0.211 (canonical / finalize).",
        ),
    }),
    execute: async ({ tier }: { tier: Tier }) => {
      const send = await inngest.send({
        name: "boiler.v2.generate",
        data: {
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          tier,
          mode: "fresh",
          retryDepth: 0,
          triggeredBy: ctx.userId,
        },
      });

      return {
        success: true as const,
        mode: "fresh" as const,
        tier,
        message: `Fresh BOILER generation fired at tier=${tier}. Watch the workspace history strip — new version appears in ${tier === "low" ? "15-25s" : tier === "medium" ? "30-60s" : "60-120s"}.`,
        inngestEventIds: send.ids,
      };
    },
  });
}
