import { tool } from "ai";
import { z } from "zod";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * flag_boiler_concern — Phase 11E suggestion tool.
 *
 * Surfaces a workspace chip flagging a concern about the BOILER gallery
 * (generic vocabulary, brand-drift, register imbalance, type-rendering
 * issues, palette mismatch with decade, etc.). No DB write — just a UI
 * surface so the founder sees ORC's read on the gallery's weak points
 * before they pick a variant.
 *
 * Pattern parallel to flag_brief_concern (Phase 10E) and the original
 * Phase 8 flag_concern. Optional variantSlug scopes the concern to one
 * variant; omit to flag the whole gallery.
 */
export function flagBoilerConcernTool(_ctx: OrcToolContext) {
  return tool({
    description:
      "Surface a workspace chip flagging a concern about a BOILER gallery (or a specific variant). Use when reading the gallery and noticing something off (brand-drift, generic vocabulary, register imbalance, palette / decade mismatch, weak type rendering). No mutation; just a surface so the founder sees ORC's read.",
    inputSchema: z.object({
      variantSlug: z
        .enum(["variant-1", "variant-2", "variant-3", "variant-4"])
        .nullable()
        .describe(
          "Which variant the concern is about. Pass null to flag the whole gallery.",
        ),
      concern: z
        .string()
        .min(20)
        .max(400)
        .describe(
          "What's concerning. Specific — vague flags ('feels off') don't help. 20-400 chars.",
        ),
    }),
    execute: async ({ variantSlug, concern }) => {
      const scope = variantSlug ?? "gallery";
      const chip: OrcSuggestionChip = {
        type: "flag_concern",
        reason: `${scope}: ${concern}`,
      };
      return {
        chip,
        message: `Flagged concern on ${scope === "gallery" ? "the gallery" : `variant '${scope}'`} as a chip below this reply.`,
      };
    },
  });
}
