import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, agentConversations } from "@/db";
import { generateStructured } from "@/lib/ai/generate";
import type { Message } from "@/lib/actions/conversations";
import type { ConversationMetadata } from "./context-builder";

/**
 * Rolling summarization — Phase 8F.
 *
 * When a conversation's verbatim window outgrows the 2000-token
 * allocation (see ORC_BUDGET.verbatim in token-count.ts), we compress
 * the six oldest unsummarized messages into a short prose summary
 * and advance the verbatim pointer. The next turn's prompt then
 * carries the summary in the mutable suffix instead of the raw
 * messages, keeping the per-turn budget intact.
 *
 * Design choices:
 *   - Runs INLINE inside /api/orc/reply when the context builder
 *     flags `needsSummarization`. We need the result for the current
 *     turn, not an async job that lands later.
 *   - Cheap model (Gemini Flash by default). Summarization is a
 *     bounded transformation — no need for Sonnet here.
 *   - Advance by 6 per run. Matches the verbatim window size so after
 *     summarization the window is fully repopulated with un-summarized
 *     messages, not a half-state.
 *   - Merges old summary + new messages into ONE summary (not
 *     appending summaries). Keeps the summary prose coherent; a
 *     summary-of-summaries drift is worse than one fresh re-summary.
 *
 * Cost: ~300 tokens in, ~200 tokens out at Flash pricing ≈ $0.00005
 * per summarization call. Triggers at most once per ~6 user turns,
 * so at 30 turns/day that's $0.00025/day per active conversation.
 * Negligible.
 */

const SYSTEM_PROMPT = `You are a conversation summarizer for BLIPS — a premium philosophical apparel brand's brand operating system. You take a chronological conversation between the founder (Inba) and ORC (his AI co-founder) about a specific signal in the pipeline and produce a compressed prose summary.

Rules:
- Output short prose (under 180 words). No bullet points.
- Preserve concrete decisions, approvals, rejections, and feedback Inba gave.
- Preserve context about the signal's shortcode, working title, and concept if mentioned.
- Drop pleasantries and throat-clearing.
- Drop tool-call plumbing ("ORC fetched the raw_text field"); preserve what the tool revealed ("raw excerpt was about career vs. parenting tension").
- Use past tense to distinguish from the live conversation that continues after.
- Write in a neutral voice, not ORC's editorial voice — this is summary, not continuation.

If a prior summary is provided, your output MUST supersede it — merge the prior summary's content plus the new messages into ONE coherent summary. Do not output a list of summaries.`;

const outputSchema = z.object({
  summary: z
    .string()
    .min(40)
    .max(1800)
    .describe(
      "Compressed prose summary of the conversation so far. Under 180 words.",
    ),
});

export interface SummarizeParams {
  conversationId: string;
  orgId: string;
  signalId: string;
  journeyId: string;
  /** All conversation messages, in chronological order. */
  messages: readonly Message[];
  /** Current metadata — we read summary + summary_through_index from here. */
  metadata: ConversationMetadata;
}

export interface SummarizeResult {
  /** The updated metadata that was written to the row. */
  metadata: ConversationMetadata;
  /** How many messages are now in the summary (updated index). */
  summaryThroughIndex: number;
  /** Token cost of this summarization call. */
  tokensInput: number;
  tokensOutput: number;
  model: string;
}

/**
 * Run the summarization pass. Returns the updated metadata so the
 * caller can pass it to buildOrcPromptContext for the re-check.
 */
export async function summarizeConversation(
  params: SummarizeParams,
): Promise<SummarizeResult> {
  const priorSummaryThrough = params.metadata.summary_through_index ?? 0;
  const priorSummary = params.metadata.summary?.trim() ?? null;

  // Advance the window by SUMMARIZE_BATCH_SIZE messages. If fewer
  // unsummarized messages exist than the batch size, take what's
  // available.
  const unsummarized = params.messages.slice(priorSummaryThrough);
  const batchSize = Math.min(6, unsummarized.length);
  const newlyCoveredMessages = unsummarized.slice(0, batchSize);
  const newSummaryThroughIndex = priorSummaryThrough + batchSize;

  if (batchSize === 0) {
    // Nothing to compress. Return unchanged metadata.
    return {
      metadata: params.metadata,
      summaryThroughIndex: priorSummaryThrough,
      tokensInput: 0,
      tokensOutput: 0,
      model: "none",
    };
  }

  // Build the LLM prompt
  const prompt = buildSummaryPrompt({
    priorSummary,
    newMessages: newlyCoveredMessages,
  });

  const result = await generateStructured({
    agentKey: "ORC",
    orgId: params.orgId,
    signalId: params.signalId,
    system: SYSTEM_PROMPT,
    prompt,
    schema: outputSchema,
    // Slight temperature — summarization benefits from a bit of
    // variation in phrasing, but stays grounded.
    temperature: 0.3,
  });

  const newSummary = result.object.summary;
  const updatedAt = new Date().toISOString();

  // Partial JSONB update — only mutate the three summary fields we
  // own. Pre-CodeRabbit-pass-1 we wrote the whole metadata object
  // built from a stale `params.metadata` snapshot; if another request
  // updated `gemini_cache_name` or any other metadata field while
  // this summarization was in flight, this write clobbered it.
  // jsonb_set leaves untouched fields alone, so concurrent updates
  // to other metadata keys survive.
  //
  // The WHERE adds a CAS check on summary_through_index — if another
  // summarization pass landed first and advanced the index, our
  // UPDATE matches zero rows and we skip the write rather than
  // overwriting their summary with ours. Caller sees the unchanged
  // metadata returned; route.ts treats this as "summary done by
  // someone else" and proceeds.
  await db
    .update(agentConversations)
    .set({
      metadata: sql`
        jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(${agentConversations.metadata}, '{}'::jsonb),
              '{summary}',
              to_jsonb(${newSummary}::text)
            ),
            '{summary_through_index}',
            to_jsonb(${newSummaryThroughIndex}::int)
          ),
          '{summary_updated_at}',
          to_jsonb(${updatedAt}::text)
        )
      `,
      updatedAt: new Date(),
    })
    .where(sql`
      ${agentConversations.id} = ${params.conversationId}::uuid
      AND COALESCE((${agentConversations.metadata} ->> 'summary_through_index')::int, 0) = ${priorSummaryThrough}
    `);

  // Return the merged metadata that the caller would see if the write
  // landed cleanly. If a concurrent pass advanced the index, the
  // caller's downstream logic still uses these values (they're a
  // monotonic step forward from priorSummaryThrough); the next turn
  // will re-read the row and reconcile.
  const newMetadata: ConversationMetadata = {
    ...params.metadata,
    summary: newSummary,
    summary_through_index: newSummaryThroughIndex,
    summary_updated_at: updatedAt,
  };

  return {
    metadata: newMetadata,
    summaryThroughIndex: newSummaryThroughIndex,
    tokensInput: result.usage.tokensInput,
    tokensOutput: result.usage.tokensOutput,
    model: result.model,
  };
}

/**
 * Build the user-side prompt fed to the summarizer LLM. The prior
 * summary (when present) is the top priority — the model must
 * supersede it, not list alongside it.
 */
function buildSummaryPrompt(opts: {
  priorSummary: string | null;
  newMessages: readonly Message[];
}): string {
  const lines: string[] = [];

  if (opts.priorSummary) {
    lines.push("EXISTING SUMMARY (to be superseded by your new summary):");
    lines.push(opts.priorSummary);
    lines.push("");
    lines.push("NEW MESSAGES to fold into the updated summary:");
  } else {
    lines.push(
      "MESSAGES to summarize (this is the first summarization pass):",
    );
  }
  lines.push("");

  for (const m of opts.newMessages) {
    const role = m.role === "orc" ? "ORC" : "Inba";
    const stageTag = m.stage ? ` [at ${m.stage}]` : "";
    lines.push(`${role}${stageTag}: ${m.content}`);
    lines.push("");
  }

  lines.push(
    "Produce ONE updated summary that supersedes the existing one. Under 180 words, prose, past tense.",
  );

  return lines.join("\n");
}
