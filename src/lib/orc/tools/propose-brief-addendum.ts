import { tool } from "ai";
import { z } from "zod";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * propose_brief_addendum — Phase 10E suggestion tool.
 *
 * Surfaces a chip with Approve / Decline / Say-something-else buttons,
 * proposing an addendum ORC thinks should be on the brief. On Approve,
 * a synthetic message lands; ORC's next turn calls add_brief_addendum.
 *
 * NOT an allowMutation tool — it's a SUGGESTION (no DB write). The
 * mutation lands on the next turn after Approve binds the actual
 * add_brief_addendum tool. Same pattern as Phase 9G propose_action.
 */
export function proposeBriefAddendumTool(_ctx: OrcToolContext) {
  return tool({
    description:
      "Propose an addendum (extra labelled section) for the founder's review. Surfaces as a chip with Approve / Decline / Say-something-else buttons. On Approve, ORC's next turn calls add_brief_addendum. Use when ORC sees a gap the core 11 sections don't cover (e.g. hangtag content, special inside-neck print, named-edition stamp).",
    inputSchema: z.object({
      label: z
        .string()
        .min(5)
        .max(50)
        .describe("Short label for the addendum."),
      content: z
        .string()
        .min(50)
        .max(500)
        .describe("Proposed addendum content."),
      reason: z
        .string()
        .min(50)
        .max(300)
        .describe("Why this addendum should exist — what gap in the core 11 sections it fills."),
    }),
    execute: async ({ label, content, reason }) => {
      const chip: OrcSuggestionChip = {
        type: "propose_action",
        summary: `Add addendum: "${label}"`,
        reason: `${content}\n\n— Why: ${reason}`,
      };
      return {
        chip,
        message: `Proposed addendum '${label}' as a chip below this reply.`,
      };
    },
  });
}
