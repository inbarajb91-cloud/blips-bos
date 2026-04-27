/**
 * AI layer types.
 */

export type AgentKey =
  | "ORC"
  | "BUNKER"
  | "STOKER"
  | "FURNACE"
  | "BOILER"
  | "ENGINE"
  | "PROPELLER";

export const AGENT_KEYS: readonly AgentKey[] = [
  "ORC",
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
] as const;

/**
 * Provider-prefixed or plain model ID. The router parses and dispatches.
 * Examples:
 *   "gemini-2.5-flash"
 *   "gemini-2.5-pro"
 *   "claude-haiku-4.5"
 *   "claude-sonnet-4.7"
 *   "anthropic/claude-sonnet-4.7"
 *   "google/gemini-2.5-pro"
 */
export type ModelId = string;

export type AgentLogAction =
  | "skill_loaded"
  | "llm_call"
  | "output_written"
  | "output_validated"
  | "error";

export interface AgentCallMetadata {
  orgId: string;
  signalId?: string;
  /** Phase 8 — optional journey scoping for per-signal log rows.
   *  Pre-signal BUNKER extraction logs and cron-triggered source
   *  fetches leave this unset (they're not inside any journey).
   *  Post-signal agent calls should populate it so observability
   *  queries can filter by "this journey's costs." */
  journeyId?: string;
  agentName: AgentKey;
  action: AgentLogAction;
  model?: string;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
  durationMs?: number;
  status: "success" | "error" | "retry";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}
