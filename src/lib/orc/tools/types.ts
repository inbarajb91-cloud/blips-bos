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
  /**
   * Phase 10.4.2 — when the user is viewing a parent workspace tab
   * that's manifestation-scoped (FURNACE/BOILER/ENGINE/PROPELLER) AND
   * a manifestation child is active (?m= in the URL), this carries
   * that child's signalId + journeyId + decade. Tools that pull stage
   * data for post-STOKER stages route to the manifestation here
   * instead of the parent.
   *
   * Without this, `get_stage_output("FURNACE")` on a parent workspace
   * reported "FURNACE has not produced an output on the active journey
   * yet" — true for the parent (parent's pipeline ends at FANNED_OUT),
   * but the user was actually looking at the manifestation child's
   * FURNACE brief. The mismatch made ORC look broken.
   *
   * Null when:
   *   - User is on a pre-STOKER tab (BUNKER / STOKER are parent-scoped)
   *   - Parent has no manifestations yet
   *   - Active manifestation lookup failed (deleted, dismissed, etc.)
   */
  activeManifestation: {
    signalId: string;
    journeyId: string;
    decade: "RCK" | "RCL" | "RCD";
    shortcode: string;
  } | null;
  /** The stage the user is currently viewing in the workspace. Used
   *  by tools (esp. get_stage_output) to decide whether to route to
   *  the active manifestation or stay on the parent — POST_STOKER
   *  stages route to the manifestation, BUNKER/STOKER stay on parent. */
  activeStage: "BUNKER" | "STOKER" | "FURNACE" | "BOILER" | "ENGINE" | "PROPELLER";
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
 * Return shape for proactive tools (flag_concern, request_re_run,
 * propose_action). The streaming route surfaces these to the client
 * as chip payloads alongside ORC's text response, so the UI can render
 * them as actionable suggestions the user accepts or dismisses.
 *
 * Phase 9G — `propose_action` adds Approve / Decline / Say-something-else
 * buttons to the chip. Approve / Decline fire synthetic chat messages
 * back to ORC so the next turn can call the underlying tool with the
 * conversation context already loaded.
 */
export interface OrcSuggestionChip {
  type: "flag_concern" | "request_re_run" | "propose_action";
  reason: string;
  /** Only set on request_re_run suggestions. */
  stage?: "BUNKER" | "STOKER" | "FURNACE" | "BOILER" | "ENGINE" | "PROPELLER";
  /** Only set on propose_action — one-line summary of what ORC wants
   *  to do. Renders as the chip's title above the buttons. */
  summary?: string;
}

/**
 * Standard shape returned by every tool — success path only. Errors
 * throw; AI SDK's tool runtime surfaces them back to the model as an
 * error message so ORC can recover gracefully within the turn.
 */
export type ToolResult<T> = T;
