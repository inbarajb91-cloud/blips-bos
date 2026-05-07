import { tool } from "ai";
import { z } from "zod";
import { REQUIRED_SECTIONS } from "@/lib/actions/furnace-shared";
import type { OrcToolContext, OrcSuggestionChip } from "./types";

/**
 * flag_brief_concern — Phase 10E suggestion tool.
 *
 * Surfaces a workspace chip flagging a specific section of a brief as
 * concerning. No DB write — just a UI surface so the founder sees ORC's
 * read on the brief's weak points. Same pattern as Phase 8 flag_concern.
 *
 * Use when ORC reads the brief and notices something off (sections
 * inconsistent with each other, voice drift, generic vocabulary in
 * tactileIntent, reference anchors too obvious, etc.) — proactive
 * heads-up before founder approves something they'll regret.
 */
export function flagBriefConcernTool(_ctx: OrcToolContext) {
  return tool({
    description:
      "Surface a workspace chip flagging a concern about a specific FURNACE brief section. Use when reading the brief and noticing something off (voice drift, generic vocabulary, weak tactileIntent, contradictory sections). No mutation; just a surface so the founder sees ORC's read.",
    inputSchema: z.object({
      section: z.enum(REQUIRED_SECTIONS).describe("Which section to flag a concern on."),
      concern: z
        .string()
        .min(20)
        .max(400)
        .describe(
          "What's concerning about this section. Specific — vague flags ('feels off') don't help. 20-400 chars.",
        ),
    }),
    execute: async ({ section, concern }) => {
      const chip: OrcSuggestionChip = {
        type: "flag_concern",
        reason: `${section}: ${concern}`,
      };
      return {
        chip,
        message: `Flagged concern on '${section}' as a chip below this reply.`,
      };
    },
  });
}
