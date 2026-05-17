// Note: do not add `import "server-only"` here — it breaks tsx test scripts.
// All callers of `generateStructured` are server-side (server actions, API
// routes, Inngest functions). Never import this from a Client Component.

import { generateObject } from "ai";
import type { ZodSchema } from "zod";
import { getAgentConfig } from "./config-reader";
import { getModel } from "./model-router";
import { logAgentCall } from "./logger";
import { pickHealthyModel } from "./probe";
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
 * One unified structured LLM call for all agent skills, with automatic
 * probe-then-call fallback chain.
 *
 * Phase 3.5 (May 8) wired probe-then-stream for ORC's streaming path.
 * The structured-call path shipped with a narrower fallback policy that
 * only advanced on classified-transient errors — which left a real
 * failure mode unguarded and surfaced on May 15 (BOILER incident):
 * a primary model id that doesn't exist plus a misconfigured provider
 * key throws a permanent-shaped error that failed the whole call
 * instead of walking the chain to a healthy slot #2.
 *
 * Fixed May 17 — both paths now share `pickHealthyModel` from probe.ts:
 *
 *   1. Walk fallback chain, sending a tiny probe to each model.
 *   2. First healthy probe wins — return that model id.
 *   3. Advance on ANY probe failure (transient or permanent — both are
 *      what the chain is for; differentiating bugs us, see Phase 3.5
 *      CR pass 1 catch).
 *   4. All probes fail → friendly aggregated error.
 *
 * After picking a healthy model, run `generateObject` once. The probe
 * already filtered out dead-primary failures; mid-call failures are
 * either:
 *   - schema validation issues (Zod / model JSON mismatch) — rare per
 *     model after Phase 11G.1's flat-with-nullable schema rule
 *   - genuine capacity drops after a healthy probe — surface them
 *     rather than retrying silently
 *
 * Either way, surface the failure rather than silently retrying — a
 * thrown error gets caught by the cascade-banner regen flow / ORC tool
 * surfaces / Inngest handler so the founder sees "try again."
 *
 * Latency cost on the happy path: one extra probe call (~200-500ms on
 * Gemini Flash). Worst case (3 unhealthy models): ~3-6s of probes
 * before the friendly error. Same envelope as the streaming path.
 *
 * All skills call this; adding a new skill = define a Zod schema and
 * a prompt, not writing new LLM plumbing. Switching a skill from
 * Gemini -> Claude is a config_agents update, no code change.
 */
export async function generateStructured<T>(
  params: GenerateStructuredParams<T>,
): Promise<GenerateStructuredResult<T>> {
  const start = Date.now();
  const config = await getAgentConfig(params.orgId, params.agentKey);
  const chain = config.modelFallbackChain;
  const temperature = params.temperature ?? config.temperature;

  // Probe-then-call: find the first healthy model in the chain. Throws
  // a friendly aggregated error if every probe fails — the BUNKER /
  // STOKER / FURNACE / BOILER call surfaces (Inngest handler, ORC tool
  // result, server action) all catch and present this as "try again in
  // a few minutes."
  const { modelId, fallbacksUsed } = await pickHealthyModel(
    chain,
    params.agentKey,
    "generateStructured",
  );
  const probeMs = Date.now() - start;

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
      metadata: {
        fallbacks_used: fallbacksUsed,
        primary_model: chain[0],
        probe_ms: probeMs,
      },
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
    // Probe said healthy but the real structured call failed — surface
    // it rather than silently fall through. Most likely shape: schema
    // mismatch (Gemini structured output failing a discriminated union
    // is the canonical case, addressed at the schema level in 11G.1)
    // or a genuine capacity drop after a healthy probe.
    const err = e instanceof Error ? e : new Error(String(e));
    const durationMs = Date.now() - start;
    void logAgentCall({
      orgId: params.orgId,
      signalId: params.signalId,
      agentName: params.agentKey,
      action: "llm_call",
      model: modelId,
      durationMs,
      status: "error",
      errorMessage: err.message,
      metadata: {
        fallbacks_used: fallbacksUsed,
        primary_model: chain[0],
        probe_passed: true,
        probe_ms: probeMs,
      },
    });
    throw err;
  }
}
