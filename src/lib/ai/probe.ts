/**
 * Model-health probe — shared between streaming (ORC) and structured
 * (every other skill) LLM call paths.
 *
 * Phase 3.5 (May 8) introduced probe-then-stream for ORC. The structured-
 * call cousin (`generateStructured` in generate.ts) shipped with a narrower
 * fallback policy that only advanced on classified-transient errors, which
 * left a real failure mode unguarded: a misconfigured primary (e.g. a model
 * id that doesn't exist, or a provider whose API key isn't set) throws a
 * permanent-shaped error that fails the whole call rather than walking the
 * chain to a healthy slot #2.
 *
 * The May 15 BOILER incident hit exactly this: `claude-sonnet-4.7` (not a
 * real model id) was the primary; the call failed immediately at the
 * "model not found" / missing-Anthropic-key boundary instead of falling
 * through to `gemini-2.5-pro` which was waiting in the chain.
 *
 * This file extracts the probe-then-call pattern from stream.ts so both
 * paths share the same recovery semantics. The rule everywhere:
 *
 *     For each model in the configured fallback chain:
 *       1. Send a tiny probe call (<10 output tokens, <1s on healthy models).
 *       2. If the probe succeeds → that model is healthy, return it.
 *       3. If the probe fails for ANY reason (transient or permanent) →
 *          advance to the next model in the chain.
 *       4. If the whole chain is exhausted → throw an aggregated error.
 *
 * Probe-then-call adds one cheap round-trip on the happy path (~200-500ms
 * on Gemini Flash) and pays for itself the first time it saves us from a
 * misconfigured primary causing a full pipeline failure.
 */

import { generateText } from "ai";
import { getModel } from "./model-router";
import type { AgentKey } from "./types";

/** Probe latency soft cap. If a model's probe takes longer than this,
 *  we treat it as failed and advance — better than letting a slow
 *  primary cost the whole call its full 30s timeout. */
export const PROBE_TIMEOUT_MS = 8_000;

/**
 * Send a tiny generation request to confirm the model is healthy enough
 * to serve a real call. Cost: ~10 tokens of output, well under $0.0001
 * on every model in the catalog.
 *
 * Returns "healthy" if the model accepted the request and produced a
 * token. Returns "failed" for any other outcome — transient (capacity,
 * overload, timeout) OR permanent (auth, missing key, unknown model id).
 *
 * The unified "failed" return is intentional: the caller's fallback
 * chain is the safety net for both classes. Differentiating between
 * transient and permanent at the probe site has historically caused
 * bugs (Phase 3.5 CR pass 1 catch — short-circuit on permanent killed
 * the bulk-apply scenario; same shape as the May 15 BOILER incident).
 *
 * The full error message is attached to the result so callers can log
 * a useful breadcrumb when an entire chain fails.
 */
export async function probeModel(
  modelId: string,
): Promise<{ status: "healthy" } | { status: "failed"; error: Error }> {
  try {
    await Promise.race([
      generateText({
        model: getModel(modelId),
        prompt: ".",
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
    return { status: "healthy" };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { status: "failed", error: err };
  }
}

export interface HealthyModelResult {
  modelId: string;
  fallbacksUsed: number;
}

/**
 * Walk the fallback chain, probing each model in order. Returns the
 * first healthy model + how many fallbacks were used to get there.
 *
 * Throws an aggregated error when the whole chain is exhausted. The
 * `friendly` message is suitable for surfacing to the founder; the
 * raw last-failure is attached as `cause` for log / observability use.
 *
 * `callSite` shows up in the log breadcrumbs — pass "streamOrcReply"
 * or "generateStructured" so a "all models failed" event can be traced
 * back to which call path triggered it.
 */
export async function pickHealthyModel(
  chain: string[],
  agentKey: AgentKey,
  callSite: string,
): Promise<HealthyModelResult> {
  if (chain.length === 0) {
    throw new Error(
      `${agentKey}: fallback chain is empty — check config_agents.${agentKey}.model_fallback_chain`,
    );
  }

  let lastError: Error | null = null;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    const result = await probeModel(id);
    if (result.status === "healthy") {
      return { modelId: id, fallbacksUsed: i };
    }
    lastError = result.error;
    console.warn(
      `[${callSite}] ${id} probe failed (${lastError.message.slice(0, 80)}) — trying next in chain`,
    );
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
