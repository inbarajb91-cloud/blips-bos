/**
 * Shared types for ORC's tool set — Phase 8D.
 *
 * Tools are built per-request with a bound context so `execute` can
 * reach the right signal, journey, and user. The streaming route
 * (Phase 8E) creates this context and threads it through `buildTools`.
 */

export interface OrcToolContext {
  /** Org scoping — required on every DB read/write. */
  orgId: string;
  /** Auth user id — recorded on decision_history rows for side-effect tools. */
  userId: string;
  /** The signal ORC is currently discussing with the user. */
  signalId: string;
  /** The signal's currently-active journey. Every tool call scopes to
   *  this journey so archived journeys stay read-only from ORC's side. */
  journeyId: string;
  /** When true, destructive tools (approve_and_advance, dismiss) are
   *  included in the tool set returned by buildOrcTools. Computed
   *  server-side by /api/orc/reply based on regex intent detection in
   *  the user's current message — defense-in-depth against prompt
   *  injection routing through ORC's tool calls. The system prompt
   *  alone isn't a sufficient gate for irreversible state changes;
   *  this server-side flag is the second layer that prompt-injection
   *  text in raw signals or recall content can't bypass. */
  allowMutation: boolean;
}

/**
 * Return shape for proactive tools (flag_concern, request_re_run).
 * The streaming route surfaces these to the client as chip payloads
 * alongside ORC's text response, so the UI can render them as
 * actionable suggestions the user accepts or dismisses.
 */
export interface OrcSuggestionChip {
  type: "flag_concern" | "request_re_run";
  reason: string;
  /** Only set on request_re_run suggestions. */
  stage?: "BUNKER" | "STOKER" | "FURNACE" | "BOILER" | "ENGINE" | "PROPELLER";
}

/**
 * Standard shape returned by every tool — success path only. Errors
 * throw; AI SDK's tool runtime surfaces them back to the model as an
 * error message so ORC can recover gracefully within the turn.
 */
export type ToolResult<T> = T;
