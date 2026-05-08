import type { LanguageModel } from "ai";
import { getAgentConfig } from "./config-reader";
import { resolveProvider } from "./providers";
import type { AgentKey, ModelId } from "./types";

/**
 * Resolve a model ID string to a Vercel AI SDK LanguageModel.
 *
 * Phase 3.5 — backed by the providers registry (`src/lib/ai/providers.ts`).
 * Adding a new provider lives entirely in providers.ts; this router
 * just looks up the matching provider and delegates `make()`.
 *
 * Supports provider-prefixed IDs ("openai/gpt-4o", "anthropic/claude-sonnet-4.7",
 * "openrouter/moonshotai/kimi-k2") and bare IDs ("gemini-3.1-flash-lite",
 * "claude-haiku-4.5") for known providers (Anthropic, Google, OpenAI, xAI).
 *
 * For OpenAI-compatible providers (OpenRouter, Moonshot/Kimi, Groq,
 * Together, Fireworks), the prefix form is required since their bare
 * model names don't have a unique pattern.
 */
export function getModel(modelId: ModelId): LanguageModel {
  const resolved = resolveProvider(modelId);
  if (!resolved) {
    throw new Error(
      `Unknown model: "${modelId}". Use a provider-prefixed form like ` +
        `"openai/gpt-4o", "anthropic/claude-sonnet-4.7", "openrouter/moonshotai/kimi-k2", ` +
        `or a bare known model id ("gemini-3.1-flash-lite", "claude-haiku-4.5", "gpt-4o", "grok-2"). ` +
        `Add new providers to src/lib/ai/providers.ts.`,
    );
  }
  return resolved.provider.make(resolved.modelName);
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
