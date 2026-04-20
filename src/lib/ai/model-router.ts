import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { getAgentConfig } from "./config-reader";
import type { AgentKey, ModelId } from "./types";

/**
 * Resolve a model ID string to a Vercel AI SDK LanguageModel.
 *
 * Supports both bare IDs ("gemini-2.5-flash") and prefixed IDs
 * ("google/gemini-2.5-flash"). The router picks the provider based on
 * the ID's prefix or pattern.
 */
export function getModel(modelId: ModelId): LanguageModel {
  // Prefixed form wins if present
  if (modelId.startsWith("anthropic/")) {
    return anthropic(modelId.replace(/^anthropic\//, ""));
  }
  if (modelId.startsWith("google/")) {
    return google(modelId.replace(/^google\//, ""));
  }

  // Heuristic fallback on bare ID
  if (modelId.startsWith("claude-")) {
    return anthropic(modelId);
  }
  if (modelId.startsWith("gemini-")) {
    return google(modelId);
  }

  throw new Error(
    `Unknown model: ${modelId}. Prefix with 'anthropic/' or 'google/', or use a known bare ID.`,
  );
}

/**
 * Resolve the model configured for a given agent key in the given org.
 * Reads `config_agents` (cached per request via React.cache).
 */
export async function getModelForAgent(
  agentKey: AgentKey,
  orgId: string,
): Promise<{ model: LanguageModel; modelId: string; temperature: number }> {
  const config = await getAgentConfig(orgId, agentKey);
  return {
    model: getModel(config.model),
    modelId: config.model,
    temperature: config.temperature,
  };
}
