import type { signals } from "@/db/schema";
import type { Message, StageKey } from "@/lib/actions/conversations";
import { ORC_SYSTEM_PROMPT } from "./system-prompt";
import { BRAND_DNA } from "./brand-dna";
import {
  estimateTokens,
  checkBudget,
  ORC_BUDGET,
  type BudgetCheck,
} from "@/lib/ai/token-count";

/**
 * ORC prompt context builder — Phase 8.
 *
 * Assembles the per-turn prompt from five sources:
 *   1. ORC system prompt (stable)
 *   2. Brand DNA (stable)
 *   3. Signal core (stable for the life of the conversation unless
 *      the signal is edited)
 *   4. Rolling summary from agent_conversations.metadata (mutable;
 *      updated every ~12 messages by a cheap Flash summarization call)
 *   5. Verbatim window (last N messages) + the current user message
 *
 * The first three live in the "stable prefix" which goes through
 * prompt caching (see src/lib/ai/cache.ts — Phase 8E). The last two
 * are the "fresh suffix" billed at full price every turn.
 *
 * Returns structured output so the caller can:
 *   - See the per-section token estimate + budget check
 *   - Decide to summarize before sending (if budget breached)
 *   - Build the provider-specific prompt shape (handled in stream.ts)
 */

/**
 * Soft target for how many recent messages live in the verbatim block.
 * Ten messages ≈ five user + five ORC turns. When the unsummarized
 * count exceeds this window, summarization fires (see
 * needsSummarization below) and the six oldest get folded into the
 * rolling summary.
 *
 * Bumped from 6 → 10 on 2026-04-25 alongside the compression-trigger
 * fix. Six was tuned for token pressure that never actually
 * materialized at normal chat scale, and it was leaving Inba with
 * "ORC only remembers three messages" because count-based compression
 * wasn't firing.
 */
export const VERBATIM_WINDOW = 10;

/**
 * Hard cap on how many unsummarized messages are ever shipped
 * verbatim. Safety valve for bursts that arrive faster than
 * summarization can keep up. If we hit it, the token-budget check
 * will trigger another summarization pass on the next turn (and
 * /api/orc/reply runs up to 3 passes per turn anyway).
 */
export const VERBATIM_HARD_CAP = 16;

/**
 * Per-message hard cap on verbatim content. If a user pasted a wall
 * of text, we store it in the messages array (agent_conversations)
 * but truncate it here before sending to the LLM. The full text is
 * always retrievable via a tool call if ORC actually needs it.
 */
export const VERBATIM_MESSAGE_MAX_CHARS = 1_800;

/**
 * Max chars of signal.rawText to include in the signal core. The
 * full text stays accessible via `get_full_signal_field('rawText')`.
 */
export const SIGNAL_RAW_TEXT_PREVIEW_CHARS = 300;

/**
 * Per-conversation metadata stored on agent_conversations.metadata.
 * Populated lazily; all fields optional.
 */
export interface ConversationMetadata {
  summary?: string;
  summary_through_index?: number;
  summary_updated_at?: string;
  gemini_cache_name?: string | null;
  gemini_cache_expires_at?: string | null;
}

export interface OrcPromptContext {
  /** Pieces the caller uses to build the provider-specific payload. */
  parts: {
    systemPrompt: string;
    brandDna: string;
    signalCore: string;
    summary: string | null;
    verbatim: Message[];
    currentUserMessage: string;
  };
  /** Active stage the user is on (stamp-forwarded from the incoming
   *  message). Used by tools + by evaluators. */
  activeStage: StageKey;
  /** Per-section token estimates and overall budget check. */
  tokenEstimate: {
    system_brand_signal: number;
    summary: number;
    verbatim: number;
    current_message: number;
  };
  budget: BudgetCheck;
  /** True when the caller should summarize older messages before
   *  sending — either verbatim window grew too large or total budget
   *  is breached. */
  needsSummarization: boolean;
  /** True when even after summarization the prompt would still bust.
   *  Caller surfaces this as an error rather than silently truncating. */
  overBudgetAfterSummarization: boolean;
}

/**
 * Build the stable signal core passage — read by the LLM as part of
 * the cached prefix. Deliberately compact; anything beyond the
 * whitelist is accessible via tool calls.
 */
export function buildSignalCore(
  signal: typeof signals.$inferSelect,
): string {
  const rawPreview = signal.rawText
    ? signal.rawText.slice(0, SIGNAL_RAW_TEXT_PREVIEW_CHARS)
    : null;

  const lines: string[] = [
    `SIGNAL CORE — the artifact you are helping Inba drive`,
    ``,
    `Shortcode: ${signal.shortcode}`,
    `Working title: ${signal.workingTitle}`,
  ];
  if (signal.concept) {
    lines.push(`Concept: "${signal.concept}"`);
  }
  lines.push(`Source: ${signal.source}`);
  lines.push(`Current stage: ${signal.status}`);
  if (rawPreview) {
    const ellipsis = signal.rawText && signal.rawText.length > SIGNAL_RAW_TEXT_PREVIEW_CHARS
      ? "…"
      : "";
    lines.push(``);
    lines.push(`Raw source excerpt (first ${SIGNAL_RAW_TEXT_PREVIEW_CHARS} chars):`);
    lines.push(`"${rawPreview}${ellipsis}"`);
  }
  lines.push(``);
  lines.push(
    `Full raw_text, raw_metadata, source_url, and decision_history are available via tool calls when you need them.`,
  );

  return lines.join("\n");
}

/**
 * Trim a single message for verbatim inclusion. Long user pastes get
 * truncated with a marker so ORC knows more content exists.
 */
export function trimMessageForVerbatim(msg: Message): Message {
  if (msg.content.length <= VERBATIM_MESSAGE_MAX_CHARS) return msg;
  return {
    ...msg,
    content:
      msg.content.slice(0, VERBATIM_MESSAGE_MAX_CHARS) +
      `\n… [truncated — ${msg.content.length - VERBATIM_MESSAGE_MAX_CHARS} more chars; ask Inba if you need the full text]`,
  };
}

/**
 * Pick the verbatim window out of the full message list. Starts at
 * `summary_through_index` (the boundary the rolling summary covers
 * up to) and takes everything after it, capped by VERBATIM_HARD_CAP
 * for token safety.
 *
 * Note: we deliberately use VERBATIM_HARD_CAP here, not the soft
 * VERBATIM_WINDOW. The window is the *trigger* for compression
 * (see needsSummarization below); the cap is the *safety valve* in
 * case a burst of messages arrives before compression has caught up.
 * Using the soft window here was the bug that made ORC silently
 * forget anything older than the last 6 messages even when the
 * summary hadn't run.
 */
export function pickVerbatimWindow(
  messages: readonly Message[],
  metadata: ConversationMetadata,
): Message[] {
  const from = metadata.summary_through_index ?? 0;
  const pool = messages.slice(from);
  return pool.slice(-VERBATIM_HARD_CAP).map(trimMessageForVerbatim);
}

export interface BuildOrcPromptContextParams {
  signal: typeof signals.$inferSelect;
  messages: readonly Message[];
  metadata: ConversationMetadata;
  currentUserMessage: string;
  activeStage: StageKey;
}

/**
 * Build the full per-turn context. Does NOT actually invoke the LLM;
 * it just assembles the parts + estimates the budget so the caller
 * can decide on summarization / truncation before the network call.
 */
export function buildOrcPromptContext(
  params: BuildOrcPromptContextParams,
): OrcPromptContext {
  const { signal, messages, metadata, currentUserMessage, activeStage } =
    params;

  const signalCore = buildSignalCore(signal);
  const summary = metadata.summary?.trim() ? metadata.summary.trim() : null;
  const verbatim = pickVerbatimWindow(messages, metadata);

  // Token estimates per allocation bucket
  const systemBrandSignalTokens =
    estimateTokens(ORC_SYSTEM_PROMPT, "prose") +
    estimateTokens(BRAND_DNA, "prose") +
    estimateTokens(signalCore, "structured");

  const summaryTokens = summary ? estimateTokens(summary, "prose") : 0;

  const verbatimTokens = verbatim.reduce(
    (acc, m) => acc + estimateTokens(m.content, "prose"),
    0,
  );

  const currentMessageTokens = estimateTokens(currentUserMessage, "prose");

  const tokenEstimate = {
    system_brand_signal: systemBrandSignalTokens,
    summary: summaryTokens,
    verbatim: verbatimTokens,
    current_message: currentMessageTokens,
  };

  const budget = checkBudget(tokenEstimate);

  // Summarization fires when ANY of:
  //   - verbatim tokens exceed their bucket (compress to free space)
  //   - total budget exceeds its cap
  //   - unsummarized message COUNT exceeds the soft VERBATIM_WINDOW
  //     (this is the trigger that catches normal-scale chat where
  //     individual messages are short so tokens stay low, but turns
  //     accumulate. Without it, anything past VERBATIM_HARD_CAP would
  //     silently drop. Bugfix 2026-04-25.)
  // …and there are enough unsummarized messages to actually move some
  // into the summary (at least 3, so we always leave 2+ in verbatim).
  const unsummarizedCount =
    messages.length - (metadata.summary_through_index ?? 0);
  const verbatimBreach = tokenEstimate.verbatim > ORC_BUDGET.verbatim;
  const totalBreach = budget.breaches.includes("total_input");
  const overCountCap = unsummarizedCount > VERBATIM_WINDOW;
  const canCompress = unsummarizedCount > 2;
  const needsSummarization =
    (verbatimBreach || totalBreach || overCountCap) && canCompress;

  // If summarization wouldn't help (e.g. system+brand+signal alone
  // busts the cap, or a single message is huge after trim), surface
  // as a hard error so we don't silently produce a bad LLM call.
  const overBudgetAfterSummarization =
    budget.breaches.includes("system_brand_signal") ||
    budget.breaches.includes("current_message") ||
    (!canCompress && !budget.ok);

  return {
    parts: {
      systemPrompt: ORC_SYSTEM_PROMPT,
      brandDna: BRAND_DNA,
      signalCore,
      summary,
      verbatim,
      currentUserMessage,
    },
    activeStage,
    tokenEstimate,
    budget,
    needsSummarization,
    overBudgetAfterSummarization,
  };
}
