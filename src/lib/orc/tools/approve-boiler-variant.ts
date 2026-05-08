import { tool } from "ai";
import { z } from "zod";
import { approveBoilerVariant } from "@/lib/actions/boiler";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, agentOutputs, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * approve_boiler_variant — Phase 11E mutation tool.
 *
 * Wraps approveBoilerVariant so ORC can pick a concept variant when the
 * founder says so (e.g. "approve the type-led variant", "go with
 * variant 2", "pick this one"). The variant slug is the canonical key
 * BOILER assigns at generation time (variant-1..4).
 *
 * Side effect: gallery → APPROVED, manifestation → IN_ENGINE,
 * engine.ready event fires (Phase 12 picks up).
 *
 * Same voice gate as Phase 9G + 10E: system prompt requires Inba's
 * explicit word in the current turn. Runtime gate (allowMutation in
 * route.ts) is defense-in-depth.
 */
export function approveBoilerVariantTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Approve one concept variant from a BOILER gallery. The picked variant becomes the design that flows into ENGINE Step 1 for product specification. Manifestation advances IN_BOILER → IN_ENGINE. Only call after Inba has explicitly said in the current turn to approve / pick / go-with this specific variant.",
    inputSchema: z.object({
      galleryAgentOutputId: z
        .string()
        .uuid()
        .describe(
          "The agent_outputs id of the BOILER gallery. Look it up via get_stage_output('boiler') if you don't have it.",
        ),
      variantSlug: z
        .enum(["variant-1", "variant-2", "variant-3", "variant-4"])
        .describe(
          "Which variant to approve. BOILER assigns variant-1..4 at generation time; the renderer shows the register tag (Type-led / Iconographic / Photographic / Negative-space abstract / Mixed) so map the founder's words to the slug.",
        ),
    }),
    execute: async ({ galleryAgentOutputId, variantSlug }) => {
      const result = await approveBoilerVariant({
        galleryId: galleryAgentOutputId,
        variantSlug,
      });

      // Best-effort memory write — Phase 8K hook pattern. Records the
      // approved variant + its register so cross-signal recall can
      // surface "we approve type-led on RCD heavyweight signals 70% of
      // the time on first pass". Drives Tier 3 visual consistency
      // learning over time.
      try {
        const [row] = await db
          .select({
            shortcode: signals.shortcode,
            decade: signals.manifestationDecade,
            content: agentOutputs.content,
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
          const content = (row.content ?? {}) as {
            variants?: Array<{ variantSlug: string; register?: string }>;
          };
          const matched = content.variants?.find(
            (v) => v.variantSlug === variantSlug,
          );
          const register = matched?.register ?? "(unknown register)";
          const memory = await getMemoryBackend();
          await memory.remember({
            orgId: ctx.orgId,
            container: "events",
            kind: "decision",
            content: `Approved BOILER variant '${variantSlug}' (${register}) on ${row.shortcode} (${row.decade}). Advancing to ENGINE Step 1.`,
            signalId: ctx.signalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "approve_boiler_variant",
              variantSlug,
              register,
              shortcode: row.shortcode,
              decade: row.decade,
            },
          });
        }
      } catch (err) {
        console.warn(
          "[approve_boiler_variant] memory write failed (best-effort):",
          err,
        );
      }

      return {
        success: true as const,
        variantSlug,
        manifestationShortcode: result.manifestationShortcode,
        message: `Variant '${variantSlug}' approved → manifestation ${result.manifestationShortcode} advancing to ENGINE Step 1.`,
      };
    },
  });
}
