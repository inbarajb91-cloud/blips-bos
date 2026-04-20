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
