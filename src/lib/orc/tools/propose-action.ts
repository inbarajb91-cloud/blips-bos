import { tool } from "ai";
import { z } from "zod";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * propose_action — Phase 9G suggestion tool.
 *
 * Proposes a side-effect action with explicit Approve / Decline /
 * Say-something-else buttons rendered in the chat thread. Use whenever
 * you'd otherwise ask "should I X?" and wait for a typed reply — the
 * chip lets Inba click instead of typing.
 *
 * Flow:
 *   1. ORC calls propose_action with a clear summary of what it wants
 *      to do + the reason.
 *   2. Chip renders inline below ORC's text reply with three buttons.
 *   3. User clicks Approve → synthetic "Approved." message lands as
 *      the next user turn. Mutation gate fires (matches "approv"),
 *      ORC's tool set binds the destructive tools, and ORC's next
 *      reply calls the tool it proposed (with the conversation context
 *      it just established disambiguating which tool).
 *   4. User clicks Decline → synthetic "Decline." lands; ORC moves on.
 *   5. User clicks "Say something else" → just focuses the chat input;
 *      no auto-message. Useful when Inba wants to refine before
 *      approving.
 *
 * Why a chip instead of just asking in text:
 *   - Less typing for the founder.
 *   - The buttons make the proposed action explicit + atomic — no
 *     ambiguity about WHAT was approved.
 *   - The system prompt's "explicit word in current turn" voice gate
 *     still applies. Click is the explicit word.
 *
 * The tool itself is an idempotent informational emitter — it just
 * surfaces the chip. The actual side-effect lands on ORC's NEXT turn
 * (after Approve click), via whichever destructive tool ORC calls
 * then. So propose_action is in the proactive/suggestion tool tier,
 * not in the destructive tier — bound regardless of allowMutation,
 * just like flag_concern and request_re_run.
 */

export function proposeAction(_ctx: OrcToolContext) {
  return tool({
    description:
      "Propose a side-effect action with Approve / Decline / Say-something-else buttons. Use whenever you'd otherwise ask 'should I X?' and wait for typed approval — the chip lets the user click. The chip surfaces under your reply text. The actual side-effect happens on YOUR NEXT TURN if the user clicks Approve (a synthetic 'Approved' message arrives, mutation tools bind, you call the tool you proposed). Be specific in summary so the user can act with one click. Use this for any STOKER manifestation operation (edit_manifestation_framing, dismiss_manifestation, add_manifestation, restart_stoker) and signal-level approve_and_advance / dismiss when the user hasn't already given the explicit word.",
    inputSchema: z.object({
      summary: z
        .string()
        .min(8)
        .max(200)
        .describe(
          "One-line summary of what you want to do. Renders as the chip's title above the buttons. Examples: 'Re-run STOKER on RCK with focus on the IC-to-manager transition' / 'Edit the RCL manifestation hook to lead with the WhatsApp-group context' / 'Dismiss the RCD card — score 41 doesn't warrant the FURNACE work'.",
        ),
      reason: z
        .string()
        .min(8)
        .max(500)
        .describe(
          "Why you're proposing this. Recorded on the chip and shown below the summary so Inba sees the rationale before clicking.",
        ),
    }),
    execute: async ({ summary, reason }): Promise<OrcSuggestionChip> => {
      return {
        type: "propose_action",
        summary,
        reason,
      };
    },
  });
}
