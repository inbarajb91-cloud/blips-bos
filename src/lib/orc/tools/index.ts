import type { OrcToolContext } from "./types";
import { getFullSignalField } from "./get-full-signal-field";
import { getStageOutput } from "./get-stage-output";
import { searchCollection } from "./search-collection";
import { recall } from "./recall";
import { flagConcern } from "./flag-concern";
import { requestReRun } from "./request-re-run";
import { dismissSignal } from "./dismiss";
import { approveAndAdvance } from "./approve-and-advance";

/**
 * Build the ORC tool set, bound to a specific turn's context.
 *
 * Each tool's `execute` closes over the context so the AI SDK's tool
 * runtime can invoke them without needing to thread context through
 * argument lists. The streaming route (`POST /api/orc/reply`)
 * constructs the context once per request (resolves the user, signal,
 * and active journey) and hands it to this builder.
 *
 * Tool names (the Record keys) are what the LLM sees and references
 * in tool calls. Keep them snake_case and match the names declared in
 * the ORC system prompt — the prompt lists them verbatim and the
 * model uses that list to know what's available.
 *
 * **Destructive tools (approve_and_advance, dismiss) are conditionally
 * included only when `ctx.allowMutation` is true.** This is computed
 * server-side by `/api/orc/reply` from regex intent detection on the
 * user's current message — defense-in-depth against prompt injection
 * (CodeRabbit pass 1, Critical 3). The system prompt is not a
 * sufficient gate alone: adversarial text in a signal's raw_text or
 * a recalled memory could in principle override ORC's instruction to
 * "only call after Inba's explicit word." With this flag, those tools
 * literally aren't in the LLM's tool set unless the user said an
 * approve/dismiss word in this turn. The static system prompt still
 * lists them so ORC understands they exist; the runtime binding is
 * what determines what's actually callable.
 */
export function buildOrcTools(ctx: OrcToolContext) {
  return {
    get_full_signal_field: getFullSignalField(ctx),
    get_stage_output: getStageOutput(ctx),
    search_collection: searchCollection(ctx),
    recall: recall(ctx),
    flag_concern: flagConcern(ctx),
    request_re_run: requestReRun(ctx),
    ...(ctx.allowMutation && {
      approve_and_advance: approveAndAdvance(ctx),
      dismiss: dismissSignal(ctx),
    }),
  };
}

export type { OrcToolContext, OrcSuggestionChip } from "./types";
