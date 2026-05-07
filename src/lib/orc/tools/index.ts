import type { OrcToolContext } from "./types";
import { getFullSignalField } from "./get-full-signal-field";
import { getStageOutput } from "./get-stage-output";
import { searchCollection } from "./search-collection";
import { recall } from "./recall";
import { flagConcern } from "./flag-concern";
import { requestReRun } from "./request-re-run";
import { dismissSignal } from "./dismiss";
import { approveAndAdvance } from "./approve-and-advance";
import { editManifestationFraming } from "./edit-manifestation-framing";
import { dismissManifestation } from "./dismiss-manifestation";
import { addManifestation } from "./add-manifestation";
import { restartStoker } from "./restart-stoker";
import { proposeAction } from "./propose-action";
// Phase 10E — FURNACE brief tools (9 total: 7 mutation + 2 suggestion)
import { approveBriefSectionTool } from "./approve-brief-section";
import { approveFullBriefTool } from "./approve-full-brief";
import { dismissBriefTool } from "./dismiss-brief";
import { editBriefSectionTool } from "./edit-brief-section";
import { regenerateBriefSectionTool } from "./regenerate-brief-section";
import { regenerateFullBriefTool } from "./regenerate-full-brief";
import { addBriefAddendumTool } from "./add-brief-addendum";
import { proposeBriefAddendumTool } from "./propose-brief-addendum";
import { flagBriefConcernTool } from "./flag-brief-concern";

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
    // Phase 9G — propose_action emits a chip with Approve / Decline /
    // Say-something-else buttons. Bound regardless of allowMutation
    // (it's a suggestion, not a side-effect — the actual side-effect
    // lands on the NEXT turn after Approve click).
    propose_action: proposeAction(ctx),
    // Phase 10E — FURNACE brief suggestion tools. Bound regardless of
    // allowMutation (suggestions, not side-effects).
    propose_brief_addendum: proposeBriefAddendumTool(ctx),
    flag_brief_concern: flagBriefConcernTool(ctx),
    ...(ctx.allowMutation && {
      approve_and_advance: approveAndAdvance(ctx),
      dismiss: dismissSignal(ctx),
      // Phase 9G — STOKER mutation tools. Same allowMutation gate as
      // approve/dismiss; the route-level regex includes the new
      // intent stems (edit, restart, force, add, etc.) so these only
      // bind when the user said one of those words in this turn.
      edit_manifestation_framing: editManifestationFraming(ctx),
      dismiss_manifestation: dismissManifestation(ctx),
      add_manifestation: addManifestation(ctx),
      restart_stoker: restartStoker(ctx),
      // Phase 10E — FURNACE brief mutation tools (7 of the 9). The
      // remaining 2 (propose_brief_addendum, flag_brief_concern) are
      // suggestion-only, bound above regardless of allowMutation.
      // Route-level regex picks up new intent stems (regenerate, brief,
      // section, addendum, addenda, refused) so these bind only when
      // the user said one of those words in this turn.
      approve_brief_section: approveBriefSectionTool(ctx),
      approve_full_brief: approveFullBriefTool(ctx),
      dismiss_brief: dismissBriefTool(ctx),
      edit_brief_section: editBriefSectionTool(ctx),
      regenerate_brief_section: regenerateBriefSectionTool(ctx),
      regenerate_full_brief: regenerateFullBriefTool(ctx),
      add_brief_addendum: addBriefAddendumTool(ctx),
    }),
  };
}

export type { OrcToolContext, OrcSuggestionChip } from "./types";
