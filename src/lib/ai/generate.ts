// Note: do not add `import "server-only"` here — it breaks tsx test scripts.
// All callers of `generateStructured` are server-side (server actions, API
// routes, Inngest functions). Never import this from a Client Component.

import { generateObject } from "ai";
import type { ZodSchema } from "zod";
import { getModelForAgent } from "./model-router";
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
  model: string;
  durationMs: number;
}

/**
 * One unified LLM call for all agent skills.
 *
 * Steps:
 *   1. Resolve model from config_agents (per-agent routing)
 *   2. Call generateObject with the Zod schema (structured output)
 *   3. Log to agent_logs with duration, tokens, cost
 *   4. Return the validated object
 *
 * All skills call this; adding a new skill = define a Zod schema and a prompt,
 * not writing new LLM plumbing. Switching a skill from Gemini -> Claude is a
 * config_agents update, no code change.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams<T>,
): Promise<GenerateStructuredResult<T>> {
  const start = Date.now();
  const { model, modelId, temperature: cfgTemp } = await getModelForAgent(
    params.agentKey,
    params.orgId,
  );
  const temperature = params.temperature ?? cfgTemp;

  let tokensInput = 0;
  let tokensOutput = 0;
  let errorMessage: string | undefined;
  let result: { object: T } | undefined;

  try {
    const r = await generateObject({
      model,
      system: params.system,
      prompt: params.prompt,
      schema: params.schema,
      temperature,
    });
    result = { object: r.object };
    // Vercel AI SDK usage shape can vary by version; probe both flavors
    const u = r.usage as unknown as {
      inputTokens?: number;
      outputTokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    tokensInput = u.inputTokens ?? u.promptTokens ?? 0;
    tokensOutput = u.outputTokens ?? u.completionTokens ?? 0;
  } catch (e) {
    errorMessage = (e as Error).message;
    throw e;
  } finally {
    const durationMs = Date.now() - start;
    // Fire-and-forget so logging failures don't affect the caller
    void logAgentCall({
      orgId: params.orgId,
      signalId: params.signalId,
      agentName: params.agentKey,
      action: "llm_call",
      model: modelId,
      tokensInput,
      tokensOutput,
      durationMs,
      status: errorMessage ? "error" : "success",
      errorMessage,
    });
  }

  if (!result) {
    // Should be unreachable — generateObject either returns or throws
    throw new Error("generateStructured reached end without result");
  }

  return {
    object: result.object,
    usage: {
      tokensInput,
      tokensOutput,
      totalTokens: tokensInput + tokensOutput,
    },
    model: modelId,
    durationMs: Date.now() - start,
  };
}
