/**
 * Phase 11D.3c — boiler_v2_finalize.
 *
 * Re-run the currently-active BOILER design at High tier to produce the
 * canonical artwork. Triggers boiler.v2.generate with mode=finalize.
 *
 * Tier is FORCED to 'high' regardless of caller — finalize is the
 * canonical pass and must be the best-quality render. Cost: $0.211/call.
 *
 * After finalize:
 *   - boiler_state.finalized_version_id is set (but finalized=false still —
 *     the founder must explicitly approve via approve_and_advance).
 *   - The finalized version becomes the active version automatically.
 *   - Founder reviews the high-quality artwork, then approves or refines further.
 *
 * Refuses if no active version exists.
 */

import { tool } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { boilerState } from "@/db/schema";
import { inngest } from "@/lib/inngest/client";
import type { OrcToolContext } from "./types";

export function boilerV2FinalizeTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Re-run the currently-active BOILER design at HIGH tier ($0.211) to produce the canonical artwork. The high-tier pass uses better-quality gpt-image-1 settings and produces the version that gets composited onto mockups + handed to vendors. Founder reviews the high-tier output, then runs approve_and_advance to commit + move to ENGINE. Refuses if no active version exists.",
    inputSchema: z.object({
      // No inputs — finalize is always 'high tier on current active version'
      _confirm: z
        .boolean()
        .default(true)
        .describe(
          "Always true. AI SDK requires a non-empty schema for tools.",
        ),
    }),
    execute: async () => {
      const [state] = await db
        .select()
        .from(boilerState)
        .where(
          and(
            eq(boilerState.orgId, ctx.orgId),
            eq(boilerState.signalId, ctx.signalId),
            eq(boilerState.journeyId, ctx.journeyId),
          ),
        )
        .limit(1);

      if (!state?.activeVersionId) {
        return {
          success: false as const,
          message:
            "No active BOILER design to finalize. Call generate_design first, iterate via refine_design, then finalize.",
        };
      }
      if (state.finalized) {
        return {
          success: false as const,
          message:
            "This BOILER state is already approved + advanced. Cannot finalize after approve.",
        };
      }

      const send = await inngest.send({
        name: "boiler.v2.generate",
        data: {
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          tier: "high",
          mode: "finalize",
          parentVersionId: state.activeVersionId,
          retryDepth: 0,
          triggeredBy: ctx.userId,
        },
      });

      return {
        success: true as const,
        mode: "finalize" as const,
        tier: "high" as const,
        parentVersionId: state.activeVersionId,
        message:
          "Finalize fired at HIGH tier ($0.211). Canonical artwork in 60-120s. Review the output and run approve_and_advance to commit + move to ENGINE Step 1.",
        inngestEventIds: send.ids,
      };
    },
  });
}
