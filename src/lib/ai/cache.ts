import type { ModelMessage } from "ai";

/**
 * Per-provider cache-aware prompt shaper — Phase 8E.
 *
 * Providers cache prompt prefixes differently, so the same "stable
 * prefix + mutable suffix" split needs a different payload shape per
 * provider. This module owns that translation so the streaming route
 * doesn't have to branch on provider.
 *
 * PROVIDER CACHE MECHANICS
 *
 * Anthropic (Claude)
 *   Marker-based. Adding `cacheControl: { type: "ephemeral" }` via
 *   `providerOptions.anthropic` on a message part tells Claude to
 *   cache everything up to and including that part. The cache has a
 *   5-min TTL that auto-extends on hit. 90% discount on cached input
 *   tokens. We mark the system message once; the stable prefix sits
 *   entirely inside it.
 *
 * Gemini / OpenAI / xAI (automatic prefix caching)
 *   No explicit marker. The provider auto-caches the longest
 *   byte-stable prefix it sees across requests. Our responsibility:
 *   send the stable prefix byte-identically across turns (no
 *   timestamps, no request IDs, no anything that varies). Gemini:
 *   75% discount, 5+ min TTL. OpenAI: 50% discount on gpt-4o family,
 *   5-min TTL. xAI: similar pattern.
 *
 * Explicit Gemini caches.create() — deferred. Gives bigger savings
 * and a 1-hour TTL but requires managing cache lifecycle (create,
 * name, expiry, invalidation on signal edits) which adds complexity
 * not justified at current scale. Adding the hook here so Phase 8.5
 * can slot it in without refactoring callers.
 *
 * PAYLOAD SHAPE (return from buildCachedMessages)
 *
 *   system: string
 *     The stable prefix — concatenated ORC system prompt + brand
 *     DNA + signal core. Byte-stable across turns (critical for
 *     automatic prefix caching).
 *
 *   messages: ModelMessage[]
 *     The mutable suffix — rolling summary (if present) + verbatim
 *     window + current user message. One message per conversational
 *     turn, in chronological order.
 *
 *   providerOptions: Record<string, unknown>
 *     Provider-specific hints (Anthropic cacheControl, Gemini
 *     cachedContent ref when enabled, etc.) passed through to
 *     streamText. Empty object for providers with automatic caching.
 */

import type { Message, StageKey } from "@/lib/actions/conversations";

export type Provider = "anthropic" | "google" | "openai" | "xai";

/**
 * Resolve a model ID to its provider. Matches the logic in
 * `src/lib/ai/model-router.ts` — kept as a pure string inspection
 * here so callers that only need provider identification don't have
 * to go through the full router.
 */
export function providerFor(modelId: string): Provider {
  // Prefixed form: "anthropic/claude-sonnet-4.7" → anthropic
  if (modelId.startsWith("anthropic/")) return "anthropic";
  if (modelId.startsWith("google/")) return "google";
  if (modelId.startsWith("openai/")) return "openai";
  if (modelId.startsWith("xai/")) return "xai";
  // Bare form: inspect known model-name substrings
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gemini")) return "google";
  if (modelId.startsWith("gpt")) return "openai";
  if (modelId.startsWith("grok")) return "xai";
  // Default — assume google since Gemini is our current default
  // across `config_agents`. Caller should always be passing a real
  // resolved model ID at this point anyway.
  return "google";
}

export interface BuildCachedMessagesParams {
  provider: Provider;
  stablePrefix: string;
  summary: string | null;
  verbatim: readonly Message[];
  currentUserMessage: string;
  /**
   * Optional workspace orientation hint — the agent tab the user is
   * looking at right now (Phase 7.5). Prepended ephemerally to the
   * current user message so the LLM knows where the user's attention
   * is, without the hint polluting the persisted conversation row or
   * the cached system prefix.
   *
   * Typed as `StageKey` (not `string`) since the route validates the
   * incoming `stage` field via `z.enum([...])` before passing it
   * here. CodeRabbit on PR #7 caught the loose `string` declaration —
   * tightening to the enum keeps the contract explicit and avoids a
   * theoretical pathway where an unvalidated string could be
   * concatenated into the prompt template.
   *
   * Why ephemeral (in messages, not system):
   *   - The hint changes per-turn (user switches tabs); stuffing it in
   *     the system field would invalidate the prefix cache on every
   *     stage switch (Anthropic 5-min TTL, Gemini auto-prefix) — that
   *     would tear up our token economics for no reason.
   *   - Persisted user messages (agent_conversations.messages[].content)
   *     stay clean because we only prepend at LLM-prompt-build time.
   *
   * Why a hint, not a scope-restriction:
   *   - ORC stays cross-stage aware (still has tools to query other
   *     stages' outputs). The hint just orients reasoning toward the
   *     user's current viewport. Phrasing in the prepended line makes
   *     this explicit so the model doesn't infer scope-locking.
   */
  activeStageHint?: StageKey;
}

export interface CachedPayload {
  system: string;
  messages: ModelMessage[];
  providerOptions: Record<string, unknown>;
}

/**
 * Build the streamText payload with per-provider caching hints.
 *
 * The stable prefix (system + brand DNA + signal core) always lives
 * in the `system` field. The mutable suffix becomes the `messages`
 * array. This ordering matters — putting anything dynamic inside
 * `system` breaks every provider's cache hit.
 */
export function buildCachedMessages(
  params: BuildCachedMessagesParams,
): CachedPayload {
  const {
    provider,
    stablePrefix,
    summary,
    verbatim,
    currentUserMessage,
    activeStageHint,
  } = params;

  const messages: ModelMessage[] = [];

  // Rolling summary lands as an "assistant" system-style note so the
  // model reads it as prior context rather than a user turn. Using
  // the `system` role inside messages is not a thing in AI SDK, and
  // prepending to `system` would break caching — so this sits as an
  // assistant message tagged with a clear preamble.
  if (summary && summary.trim().length > 0) {
    messages.push({
      role: "assistant",
      content: `[earlier conversation summary] ${summary.trim()}`,
    });
  }

  // Verbatim window — role-mapped. Our internal Message uses "orc"
  // for the agent; AI SDK uses "assistant". Map once here.
  for (const m of verbatim) {
    messages.push({
      role: m.role === "orc" ? "assistant" : "user",
      content: m.content,
    });
  }

  // Current user message — last. Always a fresh user turn.
  // If activeStageHint is set, prepend a brief workspace-orientation
  // line so ORC knows which tab the user is on. The square-bracket
  // framing keeps it visually distinct from the user's own words and
  // signals to the model that this is system-style metadata, not part
  // of what the user typed. The "but you have access" clause prevents
  // the model from treating this as a scope-lock.
  // Phrasing kept user-agnostic ("the user is currently viewing") so
  // the same hint works once DECK ships and there are non-founder
  // users in BOS. CodeRabbit on PR #7 caught this; it's the same
  // pattern as the require-founder.ts fix on Phase 8L (no founder
  // name baked into a string that may outlive a single-founder org).
  const finalUserMessage = activeStageHint
    ? `[Workspace orientation: The user is currently viewing the ${activeStageHint} tab. Frame your reply with that as orientation context — but you have access to every stage's outputs via tools, so don't refuse a cross-stage question.]\n\n${currentUserMessage}`
    : currentUserMessage;

  messages.push({
    role: "user",
    content: finalUserMessage,
  });

  // Provider-specific hints
  const providerOptions: Record<string, unknown> = {};

  if (provider === "anthropic") {
    // Mark the system prompt as ephemeral-cacheable. Anthropic
    // caches everything up to and including this marker; 5-min TTL
    // auto-extended on hit; 90% discount on cached input tokens.
    providerOptions.anthropic = {
      cacheControl: { type: "ephemeral" },
    };
  }

  // Gemini/OpenAI/xAI: automatic prefix caching. No explicit hint
  // needed — keeping the system prompt byte-stable across turns is
  // what engages it. Our `stablePrefix` is built from static ORC
  // constants + signal core (stable for the life of the signal),
  // so it's naturally byte-stable.

  return {
    system: stablePrefix,
    messages,
    providerOptions,
  };
}
