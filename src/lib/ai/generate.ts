// Note: do not add `import "server-only"` here — it breaks tsx test scripts.
// All callers of `generateStructured` are server-side (server actions, API
// routes, Inngest functions). Never import this from a Client Component.

import { generateObject } from "ai";
import type { ZodSchema } from "zod";
import { getAgentConfig } from "./config-reader";
import { getModel } from "./model-router";
import { logAgentCall } from "./logger";
import type { AgentKey } from "./types";

export interface GenerateStructuredParams<T> {
  agentKey: AgentKey;
  orgId: string;
  /** Optional signal_id for log correlation. */
  signalId?: string;
  /** System prompt — static brand context + stage instructions. */
  system: string;
  /** Dynamic user prompt (the actual request for this call). */
  prompt: string;
  /** Zod schema describing the expected structured output. */
  schema: ZodSchema<T>;
  /** Override temperature from config_agents if set. */
  temperature?: number;
  /**
   * Future: cache hint for prompt-caching providers (Anthropic, Gemini).
   * Phase 6 wires this when BUNKER has static brand context to cache.
   */
  cacheable?: boolean;
}

export interface GenerateStructuredResult<T> {
  object: T;
  usage: {
    tokensInput: number;
    tokensOutput: number;
    totalTokens: number;
  };
  /** Model ID that actually served this call (may differ from primary if fallback used). */
  model: string;
  /** How many fallbacks were used (0 = primary served). */
  fallbacksUsed: number;
  durationMs: number;
}

/**
 * One unified LLM call for all agent skills, with automatic fallback chain.
 *
 * Steps:
 *   1. Resolve fallback chain from config_agents (primary first, then backups)
 *   2. Try each model in order, calling generateObject with the Zod schema
 *   3. On transient errors (rate limit, overload, schema mismatch) → try next model
 *   4. On non-transient errors (auth, malformed request) → fail fast, don't waste retries
 *   5. Log to agent_logs with the model that actually served + fallbacks_used count
 *   6. Return the validated object
 *
 * All skills call this; adding a new skill = define a Zod schema and a prompt,
 * not writing new LLM plumbing. Switching a skill from Gemini -> Claude is a
 * config_agents update, no code change.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams<T>,
): Promise<GenerateStructuredResult<T>> {
  const start = Date.now();
  const config = await getAgentConfig(params.orgId, params.agentKey);
  const chain = config.modelFallbackChain;
  const temperature = params.temperature ?? config.temperature;

  let lastError: Error | undefined;
  let fallbacksUsed = 0;

  for (const modelId of chain) {
    const attemptStart = Date.now();
    try {
      const model = getModel(modelId);
      const r = await generateObject({
        model,
        system: params.system,
        prompt: params.prompt,
        schema: params.schema,
        temperature,
      });

      // Extract token usage (v3/v4 AI SDK shapes differ)
      const u = r.usage as unknown as {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      };
      const tokensInput = u.inputTokens ?? u.promptTokens ?? 0;
      const tokensOutput = u.outputTokens ?? u.completionTokens ?? 0;

      // Success — log and return
      const durationMs = Date.now() - start;
      void logAgentCall({
        orgId: params.orgId,
        signalId: params.signalId,
        agentName: params.agentKey,
        action: "llm_call",
        model: modelId,
        tokensInput,
        tokensOutput,
        durationMs,
        status: "success",
        metadata:
          fallbacksUsed > 0
            ? {
                fallbacks_used: fallbacksUsed,
                primary_model: chain[0],
                attempt_duration_ms: Date.now() - attemptStart,
              }
            : undefined,
      });

      return {
        object: r.object,
        usage: {
          tokensInput,
          tokensOutput,
          totalTokens: tokensInput + tokensOutput,
        },
        model: modelId,
        fallbacksUsed,
        durationMs,
      };
    } catch (e) {
      lastError = e as Error;

      if (!isTransientError(lastError)) {
        // Permanent error (auth, malformed request, unknown model) — different
        // model won't fix it. Fail fast.
        void logAgentCall({
          orgId: params.orgId,
          signalId: params.signalId,
          agentName: params.agentKey,
          action: "llm_call",
          model: modelId,
          durationMs: Date.now() - start,
          status: "error",
          errorMessage: lastError.message,
          metadata: { non_transient: true },
        });
        throw lastError;
      }

      fallbacksUsed++;
      console.warn(
        `[generateStructured] ${modelId} failed (transient: ${lastError.message.slice(0, 80)}...), trying next in chain`,
      );
    }
  }

  // All models in chain exhausted
  const durationMs = Date.now() - start;
  void logAgentCall({
    orgId: params.orgId,
    signalId: params.signalId,
    agentName: params.agentKey,
    action: "llm_call",
    model: chain[chain.length - 1],
    durationMs,
    status: "error",
    errorMessage: lastError?.message ?? "All models in fallback chain failed",
    metadata: {
      exhausted_chain: chain,
      fallbacks_used: fallbacksUsed,
    },
  });
  throw (
    lastError ??
    new Error(`All ${chain.length} models in fallback chain failed`)
  );
}

/**
 * Classify an error as transient (fallback to next model) vs. permanent (fail fast).
 *
 * Transient: the problem is with the specific model or its current capacity.
 * Another model might succeed.
 *
 * Permanent: the problem is with the request itself (auth, malformed input,
 * unknown model ID). No other model will fix it.
 */
function isTransientError(err: Error): boolean {
  const msg = (err.message || "").toLowerCase();
  const transientSignatures = [
    "high demand",
    "experiencing high demand",
    "rate limit",
    "rate-limit",
    "429",
    "503",
    "502",
    "500",
    "service unavailable",
    "internal server error",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "etimedout",
    "no object generated",
    "response did not match schema",
    "invalid response",
    "overloaded",
    "capacity",
    "try again later",
    "failed after",
  ];
  return transientSignatures.some((sig) => msg.includes(sig));
}
