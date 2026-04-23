import { tool } from "ai";
import { z } from "zod";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * request_re_run — proactive tool. ORC suggests re-running a
 * specific stage with concrete feedback. Like flag_concern, this is
 * a UI chip, not a side-effect action. Inba decides whether to
 * actually trigger the re-run from the chip.
 *
 * In Phase 9 (STOKER ships alongside reset-from-stage UX), clicking
 * the chip will open a confirmation modal pre-filled with the
 * stage + reason. For Phase 8 (pre-STOKER) the chip just surfaces;
 * the reset action doesn't exist yet. ORC still has the
 * affordance — using it on Phase-8 signals before reset exists
 * produces an informational chip the user can dismiss.
 */

const STAGE_NAMES = [
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
] as const;

export function requestReRun(_ctx: OrcToolContext) {
  return tool({
    description:
      "Suggest re-running a specific pipeline stage with feedback. Surfaces as a chip in the workspace that Inba can accept (triggers reset-from-stage) or dismiss. Only use when you see a concrete improvement the skill would make if given your feedback — don't re-run stages on vibes.",
    inputSchema: z.object({
      stage: z.enum(STAGE_NAMES).describe("The stage to re-run"),
      reason: z
        .string()
        .min(8)
        .max(240)
        .describe(
          "Concrete feedback the skill should incorporate on re-run. One sentence, specific.",
        ),
    }),
    execute: async ({ stage, reason }): Promise<OrcSuggestionChip> => {
      return {
        type: "request_re_run",
        stage,
        reason,
      };
    },
  });
}
