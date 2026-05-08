import { tool } from "ai";
import { z } from "zod";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * propose_boiler_direction — Phase 11E suggestion tool.
 *
 * ORC has read the brief + the current 4 variants and thinks one
 * specific direction (e.g. "lean harder into the type-led register",
 * "drop the photographic, all four should be illustrative") is worth
 * the founder's consideration. Surfaces as a chip with Approve /
 * Decline / Say-something-else buttons.
 *
 * NOT an allowMutation tool — it's a SUGGESTION (no DB write). On
 * Approve, ORC's next turn (with the founder's intent confirmed) calls
 * regenerate_boiler_gallery (Phase 11E.1) with the proposed direction
 * as the reason.
 *
 * Pattern parallel to propose_brief_addendum (Phase 10E).
 */
export function proposeBoilerDirectionTool(_ctx: OrcToolContext) {
  return tool({
    description:
      "Propose a specific direction the BOILER gallery should pivot toward (e.g. 'lean harder into the type-led register', 'drop the photographic, all four illustrative', 'shift palette warmer'). Surfaces as a chip with Approve / Decline / Say-something-else buttons. On Approve, ORC's next turn calls regenerate_boiler_gallery with the direction as the reason. Use when ORC sees a clear improvement opportunity reading the brief + the current variants.",
    inputSchema: z.object({
      direction: z
        .string()
        .min(20)
        .max(400)
        .describe(
          "The specific design pivot ORC is proposing. Concrete and actionable — vague directions ('make it better') don't help. Reference the register / palette / typography / composition the gallery should shift toward.",
        ),
      reason: z
        .string()
        .min(20)
        .max(300)
        .describe(
          "Why ORC thinks this direction is right for this brief — pattern from past approvals, gap between brief and current variants, brand-fit concern, etc.",
        ),
    }),
    execute: async ({ direction, reason }) => {
      const chip: OrcSuggestionChip = {
        type: "propose_action",
        summary: `Pivot gallery: "${direction.slice(0, 60)}${direction.length > 60 ? "…" : ""}"`,
        reason: `${direction}\n\n— Why: ${reason}`,
      };
      return {
        chip,
        message: `Proposed gallery pivot as a chip below this reply. Approve to regenerate the gallery with this direction.`,
      };
    },
  });
}
