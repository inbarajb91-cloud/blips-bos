import {
  generateText,
  streamText,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { getAgentConfig } from "./config-reader";
import { getModel } from "./model-router";
import { logAgentCall } from "./logger";
import { isTransientError } from "./generate";
import type { AgentKey } from "./types";

/**
 * Streaming abstraction for ORC replies — Phase 8E + Phase 3.5 fallback.
 *
 * The structured-call cousin is `generateStructured()` in
 * `src/lib/ai/generate.ts`. Same model-routing rules, same
 * config-driven selection, same agent_logs correlation — just
 * produces a streaming Response instead of a parsed object.
 *
 * Phase 3.5 — added a fallback chain via "probe-then-stream":
 *
 *   For each model in modelFallbackChain:
 *     1. Send a 1-token probe with generateText (sub-second on healthy
 *        models). If it succeeds, the model is healthy → start the
 *        streamText against that model and return.
 *     2. If the probe fails with a transient error (capacity, overload,
 *        rate limit), advance to the next model in the chain.
 *     3. If the probe fails with a permanent error (auth, malformed
 *        input), throw — no fallback fixes that.
 *   If all models fail probe, throw a friendly aggregated error.
 *
 * Latency cost on the happy path: one extra probe call (~200-500ms on
 * Gemini Flash). Worst case (3 unhealthy models): ~3-6s of probes
 * before failing. Strictly better than the prior behavior (no fallback,
 * primary outage = full failure for the entire turn).
 *
 * Why probe-then-stream rather than stream-then-detect: streamText
 * returns a result whose first chunk would have to be peeked-then-
 * replayed to detect early failure without losing data. The AI SDK
 * doesn't expose a clean "did the request even start?" signal. Probe-
 * then-stream is the simple-and-correct approach. We accept the
 * latency hit on every turn for the reliability win.
 *
 * Tool loop capped at 5 steps via stepCountIs(5). Documented in
 * agents/ORC.md Phase 8; matches agent-design default.
 *
 * Caller is responsible for building the cached payload (see
 * `src/lib/ai/cache.ts buildCachedMessages`); this wrapper just
 * threads it through streamText + instruments logging.
 *
 * What the caller gets back: the StreamTextResult object. The route
 * handler turns that into a `Response` via
 * `result.toUIMessageStreamResponse()`. Separating those two
 * concerns keeps this file reusable if we ever want non-HTTP
 * consumers (Inngest streaming jobs, e.g.).
 */

export const ORC_MAX_STEPS = 5;

/** Probe latency soft cap. If a model's probe takes longer than this,
 *  we treat it as failed and advance — better than letting a slow
 *  primary cost the whole turn its full 30s timeout. */
const PROBE_TIMEOUT_MS = 8_000;

export interface StreamOrcReplyParams {
  agentKey: AgentKey;
  orgId: string;
  /** Signal the conversation is about — for log correlation. */
  signalId: string;
  /** Active journey — for log correlation + scoping. */
  journeyId: string;
  /** Stable cached prefix: system prompt + brand DNA + signal core. */
  system: string;
  /** Mutable suffix messages: rolling summary (if any) + verbatim + current turn. */
  messages: ModelMessage[];
  /** Provider-specific cache/stream hints from buildCachedMessages. */
  providerOptions?: Record<string, unknown>;
  /** Tools available to ORC this turn (bound to context). */
  tools: ToolSet;
  /** Override temperature if the config's default doesn't fit. */
  temperature?: number;
  /**
   * Called when the stream completes successfully. Used by the route
   * handler to persist the ORC reply to agent_conversations.
   * Runs after the full text + tool calls are finalized.
   */
  onFinish?: Parameters<typeof streamText>[0]["onFinish"];
}

/**
 * 1-token probe — confirms the model is healthy enough to serve the
 * upcoming streaming call. Cost: ~10 tokens of output, well under
 * $0.0001 on every model in the catalog. Returns:
 *   - "healthy" → model accepted the request, returned a token
 *   - "transient" → model errored on a fallback-eligible signature
 *     (capacity, overload, etc.); caller should try next model
 *   - throws → permanent error (auth, malformed); no fallback fixes
 */
async function probeModel(
  modelId: string,
): Promise<"healthy" | "transient"> {
  try {
    await Promise.race([
      generateText({
        model: getModel(modelId),
        prompt: ".",
        // AI SDK v6 uses `maxOutputTokens` — older variants used `maxTokens`.
        // generateText accepts maxOutputTokens; cap at 4 so this stays
        // cheap regardless of model pricing tier.
        maxOutputTokens: 4,
        temperature: 0.0,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`probe timeout after ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        ),
      ),
    ]);
    return "healthy";
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (isTransientError(err)) return "transient";
    throw err;
  }
}

/**
 * Walk the fallback chain to find the first healthy model. Returns
 * the chosen model id and how many fallbacks were used (0 = primary
 * served). Throws a friendly aggregated error if none are healthy.
 */
async function pickHealthyModel(
  chain: string[],
  agentKey: AgentKey,
): Promise<{ modelId: string; fallbacksUsed: number }> {
  // CR pass 1 fix: previously rethrew on any "permanent" probe error,
  // which defeated the whole point of the fallback chain in a key
  // failure mode — a missing per-provider API key (e.g. primary set
  // to "openai/gpt-4o" via the bulk-apply UI when OPENAI_API_KEY isn't
  // configured) is permanent for THAT model but the chain exists
  // exactly to recover from "this provider can't serve right now."
  // New behavior: advance on any probe failure, only throw if the
  // whole chain is exhausted. The aggregated error attaches the last
  // failure as `cause` for log/observability inspection.
  let lastError: Error | null = null;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    try {
      const status = await probeModel(id);
      if (status === "healthy") {
        return { modelId: id, fallbacksUsed: i };
      }
      lastError = new Error(`${id} probe returned transient error`);
      console.warn(
        `[streamOrcReply] ${id} probe failed transiently — trying next in chain`,
      );
    } catch (e) {
      // Permanent error for THIS model (missing key, auth, malformed
      // model id, unknown provider). Record it + advance — the chain
      // is the safety net for exactly this case.
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(
        `[streamOrcReply] ${id} probe failed permanently (${lastError.message.slice(0, 80)}) — trying next in chain`,
      );
    }
  }
  // All models failed probe.
  const friendly = new Error(
    `${agentKey}: all ${chain.length} model${
      chain.length === 1 ? "" : "s"
    } in the fallback chain failed health probes (likely a temporary capacity event or a misconfigured provider key — please check the Settings → Agent Models page or try again in a few minutes).`,
  );
  if (lastError) {
    (friendly as Error & { cause?: unknown }).cause = lastError;
  }
  throw friendly;
}

/**
 * Fire a streaming LLM call for ORC. Returns the raw streamText
 * result so the caller can:
 *   - convert to an HTTP response via `.toUIMessageStreamResponse()`
 *   - consume the text stream server-side if needed
 *   - attach additional handlers
 *
 * Logs an `llm_call` row on completion via onFinish. Errors also
 * produce an agent_log row for observability.
 */
export async function streamOrcReply(params: StreamOrcReplyParams) {
  const start = Date.now();
  const config = await getAgentConfig(params.orgId, params.agentKey);
  const chain = config.modelFallbackChain;
  const temperature = params.temperature ?? config.temperature;

  // Probe-then-stream: find the first healthy model in the chain.
  // Throws if all probes fail; surfaces as a 500 from the route, which
  // the OrcPanel renders as a friendly "try again" message.
  const { modelId, fallbacksUsed } = await pickHealthyModel(
    chain,
    params.agentKey,
  );
  const probeMs = Date.now() - start;

  const model = getModel(modelId);

  const result = streamText({
    model,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    temperature,
    stopWhen: stepCountIs(ORC_MAX_STEPS),
    providerOptions: params.providerOptions as Parameters<
      typeof streamText
    >[0]["providerOptions"],
    onFinish: async (event) => {
      // Extract token usage — shape varies by provider/SDK version
      const u = event.usage as unknown as {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
        cachedInputTokens?: number;
      };
      const tokensInput = u.inputTokens ?? u.promptTokens ?? 0;
      const tokensOutput = u.outputTokens ?? u.completionTokens ?? 0;
      const cachedTokens = u.cachedInputTokens ?? 0;

      void logAgentCall({
        orgId: params.orgId,
        signalId: params.signalId,
        journeyId: params.journeyId,
        agentName: params.agentKey,
        action: "llm_call",
        model: modelId,
        tokensInput,
        tokensOutput,
        cachedTokens,
        durationMs: Date.now() - start,
        status: "success",
        metadata: {
          streaming: true,
          steps: event.steps.length,
          finish_reason: event.finishReason,
          // Phase 3.5 — record fallback usage so the agent_logs table
          // surfaces "this turn used model X because primary was down."
          // Useful for capacity dashboards + cost analysis.
          fallbacks_used: fallbacksUsed,
          primary_model: chain[0],
          probe_ms: probeMs,
        },
      });

      // Caller's onFinish (persistence + revalidation) runs after
      // our logging. If it throws, the error surfaces up but our
      // observability row is already in.
      if (params.onFinish) {
        await params.onFinish(event);
      }
    },
    onError: ({ error }) => {
      void logAgentCall({
        orgId: params.orgId,
        signalId: params.signalId,
        journeyId: params.journeyId,
        agentName: params.agentKey,
        action: "llm_call",
        model: modelId,
        durationMs: Date.now() - start,
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          streaming: true,
          fallbacks_used: fallbacksUsed,
          primary_model: chain[0],
          probe_passed: true, // probe said healthy but stream errored mid-flight
        },
      });
    },
  });

  return result;
}
