import { tool } from "ai";
import { z } from "zod";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * flag_concern — proactive tool. ORC calls this mid-reply when it
 * spots something weak or worth a second look on the current signal.
 * The tool doesn't write to the database; it returns a structured
 * chip payload. The streaming route collects these chips from the
 * tool call stream and surfaces them to the UI alongside ORC's text
 * reply.
 *
 * The UI (Phase 8H) renders each chip as a small "ORC flags: ..."
 * card that Inba can click to open a focused thread about the
 * concern, or dismiss to ignore.
 *
 * Why this isn't just "have ORC write the concern in its reply
 * text" — chips are actionable + persistent. A line buried in a
 * paragraph gets skimmed past; a chip with a click target is
 * harder to miss and easier to act on.
 */

export function flagConcern(_ctx: OrcToolContext) {
  return tool({
    description:
      "Surface a specific concern about the current signal as an actionable chip in the workspace. Use when you spot something weak that Inba might otherwise miss — a thin decade framing, an off-brand concept, a fit score that feels generous, a source that doesn't bear scrutiny. Keep the reason short (1-2 sentences). Never use this to restate obvious facts; only for concerns worth a second look.",
    inputSchema: z.object({
      reason: z
        .string()
        .min(8)
        .max(240)
        .describe(
          "One-sentence statement of the concern. Sharp, specific, no hedging.",
        ),
    }),
    execute: async ({ reason }): Promise<OrcSuggestionChip> => {
      return {
        type: "flag_concern",
        reason,
      };
    },
  });
}
