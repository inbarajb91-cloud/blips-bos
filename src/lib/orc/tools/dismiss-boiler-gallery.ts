import { tool } from "ai";
import { z } from "zod";
import { dismissBoilerGallery } from "@/lib/actions/boiler";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * dismiss_boiler_gallery — Phase 11E mutation tool.
 *
 * Wraps dismissBoilerGallery so ORC can kill a manifestation at BOILER
 * when the founder rejects all 4 variants and doesn't want to regenerate
 * (e.g. "the whole gallery is off, dismiss it", "this manifestation
 * isn't worth pursuing"). Manifestation status flips to BOILER_REFUSED.
 *
 * The manifestation can still be revived by editing the FURNACE brief
 * past gate; cascade detection (Phase 11F) surfaces the dirty state
 * with a "regenerate gallery?" CTA. Until then, BOILER_REFUSED is a
 * terminal state from ORC's side.
 *
 * Same voice gate as approve_boiler_variant. Reason captures founder's
 * rationale for the dismissal — fed into memory so cross-signal recall
 * can surface "BOILER galleries with no type-led options get dismissed
 * 80% of the time" or similar patterns.
 */
export function dismissBoilerGalleryTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Dismiss a BOILER concept gallery — kills the manifestation at BOILER (status → BOILER_REFUSED). Use when ALL variants miss the brief and founder doesn't want to regenerate. Manifestation can still be revived by editing the FURNACE brief past gate. Only call after Inba has explicitly said in the current turn to dismiss / kill / drop / abandon this manifestation at BOILER.",
    inputSchema: z.object({
      galleryAgentOutputId: z
        .string()
        .uuid()
        .describe(
          "The agent_outputs id of the BOILER gallery. Look it up via get_stage_output('boiler') if you don't have it.",
        ),
      reason: z
        .string()
        .min(4)
        .max(500)
        .describe(
          "Founder's rationale for dismissing the whole gallery. Specific is better — vague reasons lose the signal in cross-gallery recall.",
        ),
    }),
    execute: async ({ galleryAgentOutputId, reason }) => {
      const result = await dismissBoilerGallery({
        galleryId: galleryAgentOutputId,
        reason,
      });

      // Best-effort memory write
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
              eq(agentOutputs.id, galleryAgentOutputId),
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
            content: `Dismissed BOILER gallery on ${row.shortcode} (${row.decade}). Reason: ${reason}`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "dismiss_boiler_gallery",
              shortcode: row.shortcode,
              decade: row.decade,
            },
          });
        }
      } catch (err) {
        console.warn(
          "[dismiss_boiler_gallery] memory write failed (best-effort):",
          err,
        );
      }

      return {
        success: true as const,
        manifestationShortcode: result.manifestationShortcode,
        message: `BOILER gallery dismissed for ${result.manifestationShortcode}. Manifestation status: BOILER_REFUSED.`,
      };
    },
  });
}
