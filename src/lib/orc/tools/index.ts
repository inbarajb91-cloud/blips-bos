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
 */
export function buildOrcTools(ctx: OrcToolContext) {
  return {
    get_full_signal_field: getFullSignalField(ctx),
    get_stage_output: getStageOutput(ctx),
    search_collection: searchCollection(ctx),
    recall: recall(ctx),
    flag_concern: flagConcern(ctx),
    request_re_run: requestReRun(ctx),
    approve_and_advance: approveAndAdvance(ctx),
    dismiss: dismissSignal(ctx),
  };
}

export type { OrcToolContext, OrcSuggestionChip } from "./types";
