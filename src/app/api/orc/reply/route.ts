import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, signals, agentConversations } from "@/db";
import type { signals as signalsTable } from "@/db/schema";
import { requireSession } from "@/lib/api/auth-helpers";
import { checkOrcReplyRateLimit } from "@/lib/api/rate-limit";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { getActiveJourney } from "@/lib/orc/journey";
import {
  getOrCreateOrcConversation,
  appendUserMessage,
  type Message,
  type StageKey,
} from "@/lib/actions/conversations";
import {
  buildOrcPromptContext,
  type ConversationMetadata,
} from "@/lib/orc/context-builder";
import { buildOrcTools } from "@/lib/orc/tools";
import { buildCachedMessages, providerFor } from "@/lib/ai/cache";
import { streamOrcReply } from "@/lib/ai/stream";
import { getAgentConfig } from "@/lib/ai/config-reader";
import { summarizeConversation } from "@/lib/orc/summarize";

/**
 * POST /api/orc/reply — ORC's conversational reply endpoint.
 *
 * Phase 8E. Accepts a user message in the context of a signal + stage,
 * persists it, builds the cached-prefix + mutable-suffix prompt, runs
 * streamText against the configured ORC model, and streams the reply
 * back to the client. Persists the final ORC text + tool-call trail
 * via the streamText onFinish callback.
 *
 * FLOW
 *   1. Auth + scope (signal belongs to user's org)
 *   2. Resolve active journey (ORC always writes to the live one)
 *   3. Ensure an ORC conversation exists (or create with seed)
 *   4. Append the user's message to agent_conversations (persist now,
 *      not at stream close — if ORC's reply fails, the user message
 *      shouldn't disappear)
 *   5. Build the prompt context with the updated message list
 *   6. Budget check:
 *        - overBudgetAfterSummarization → clean 413-like error
 *        - needsSummarization → [Phase 8F will trigger a summary
 *          inline here; for Phase 8E we warn + proceed]
 *   7. Build cache-aware payload per provider
 *   8. Instantiate tools bound to (orgId, userId, signalId, journeyId)
 *   9. Fire streamOrcReply with an onFinish handler that persists the
 *      ORC reply
 *  10. Return the streamed UIMessage response
 *
 * ERROR SHAPES
 *   401  — no session
 *   400  — invalid body, or empty message
 *   404  — signal not found in org
 *   413  — conversation genuinely over budget even after summary hooks
 *   500  — upstream LLM or DB failure (logged; surfaced generically)
 */

const BodySchema = z.object({
  signalId: z.string().uuid(),
  userMessage: z.string().min(1).max(2_000),
  stage: z.enum([
    "BUNKER",
    "STOKER",
    "FURNACE",
    "BOILER",
    "ENGINE",
    "PROPELLER",
  ]),
});

export async function POST(req: Request) {
  const auth = await requireSession();
  if (auth instanceof NextResponse) return auth;

  // Rate limit — 30 reply requests per minute per user. Protects
  // against frontend loops (abort-retry cycles), rapid-click Send,
  // and future multi-user abuse. See lib/api/rate-limit.ts for
  // config + the single-instance caveat.
  const rl = checkOrcReplyRateLimit(auth.id);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "Too many requests",
        detail: "ORC is rate-limited to 30 replies per minute. Please wait and try again.",
        retryAfterSeconds: Math.ceil(rl.retryAfterMs / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  // Org scope resolution — requireSession gives us the Supabase user;
  // getCurrentUserWithOrg joins it with public.users to get org_id.
  const user = await getCurrentUserWithOrg();
  if (!user) {
    return NextResponse.json(
      { error: "No linked profile for this session" },
      { status: 401 },
    );
  }

  // Parse body
  let parsed: z.infer<typeof BodySchema>;
  try {
    const body = await req.json();
    parsed = BodySchema.parse(body);
  } catch (e) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        detail: e instanceof Error ? e.message : "parse failed",
      },
      { status: 400 },
    );
  }
  const { signalId, userMessage, stage } = parsed;

  // Scope check: signal belongs to user's org
  const [signal] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.orgId, user.orgId)))
    .limit(1);
  if (!signal) {
    return NextResponse.json({ error: "Signal not found" }, { status: 404 });
  }

  // Active journey resolution. ORC always operates on the live journey;
  // archived journeys are read-only via the conversations scope check.
  const activeJourney = await getActiveJourney(signalId);

  // Ensure conversation exists + append user message. Persisting the
  // user turn NOW (not at stream close) matches the "don't lose user
  // input on LLM failure" principle — if the stream errors below, the
  // user's message is already safe on disk.
  const conversation = await getOrCreateOrcConversation(signalId);
  await appendUserMessage(conversation.id, userMessage, stage as StageKey);

  // Reload the full message list + metadata after the append so the
  // context builder sees the canonical post-append state.
  const [fresh] = await db
    .select({
      id: agentConversations.id,
      messages: agentConversations.messages,
      metadata: agentConversations.metadata,
    })
    .from(agentConversations)
    .where(eq(agentConversations.id, conversation.id))
    .limit(1);
  if (!fresh) {
    // Shouldn't happen — we just wrote to it. But defensive.
    return NextResponse.json(
      { error: "Conversation vanished unexpectedly" },
      { status: 500 },
    );
  }
  const messages = (fresh.messages as Message[]) ?? [];
  const metadata = (fresh.metadata as ConversationMetadata | null) ?? {};

  // Build the prompt context
  let context = buildOrcPromptContext({
    signal: signal as typeof signalsTable.$inferSelect,
    messages,
    metadata,
    currentUserMessage: userMessage,
    activeStage: stage as StageKey,
  });

  // Budget decisions. overBudgetAfterSummarization is the hard cap —
  // no recovery possible, fail cleanly. needsSummarization is the
  // soft signal — run an inline summarization pass, then re-check.
  if (context.overBudgetAfterSummarization) {
    return NextResponse.json(
      {
        error: "Conversation too long to continue in this thread",
        detail:
          "Start a fresh signal workspace to continue. This conversation exceeds the per-turn context budget even after compression.",
        tokenEstimate: context.tokenEstimate,
      },
      { status: 413 },
    );
  }
  if (context.needsSummarization) {
    // Phase 8F — inline summarization. Folds the six oldest
    // unsummarized messages into the rolling summary, advances
    // summary_through_index, writes back to agent_conversations.
    // We then rebuild the context with the new metadata so the
    // current turn ships with the compressed prefix.
    const summaryResult = await summarizeConversation({
      conversationId: conversation.id,
      orgId: user.orgId,
      signalId,
      journeyId: activeJourney.id,
      messages,
      metadata,
    });

    // Rebuild context with the updated metadata (summary +
    // summary_through_index changed; messages list unchanged).
    context = buildOrcPromptContext({
      signal: signal as typeof signalsTable.$inferSelect,
      messages,
      metadata: summaryResult.metadata,
      currentUserMessage: userMessage,
      activeStage: stage as StageKey,
    });

    // If still over budget after summarization, surface as 413.
    // Rare case: user's current message itself is huge, or the
    // summary grew beyond its cap.
    if (context.overBudgetAfterSummarization || !context.budget.ok) {
      return NextResponse.json(
        {
          error: "Conversation too long even after summarization",
          detail:
            "Your current message or the compressed history still exceeds the per-turn budget. Try a shorter message, or start a fresh signal workspace.",
          tokenEstimate: context.tokenEstimate,
        },
        { status: 413 },
      );
    }
  }

  // Assemble the stable prefix (cached portion) from the three parts
  const stablePrefix = [
    context.parts.systemPrompt,
    "",
    context.parts.brandDna,
    "",
    context.parts.signalCore,
  ].join("\n");

  // Resolve the provider from the agent's configured model so we
  // shape the cache hints correctly.
  const config = await getAgentConfig(user.orgId, "ORC");
  const modelId = config.modelFallbackChain[0];
  const provider = providerFor(modelId);

  const cachedPayload = buildCachedMessages({
    provider,
    stablePrefix,
    summary: context.parts.summary,
    verbatim: context.parts.verbatim,
    currentUserMessage: context.parts.currentUserMessage,
  });

  // Bind tools to this request's context
  const tools = buildOrcTools({
    orgId: user.orgId,
    userId: user.authId,
    signalId,
    journeyId: activeJourney.id,
  });

  // Stream the reply
  const result = await streamOrcReply({
    agentKey: "ORC",
    orgId: user.orgId,
    signalId,
    journeyId: activeJourney.id,
    system: cachedPayload.system,
    messages: cachedPayload.messages,
    providerOptions: cachedPayload.providerOptions,
    tools,
    onFinish: async (event) => {
      // Persist ORC's final text reply to agent_conversations.
      // Strategy (A — confirmed with Inba): one write at stream close;
      // if the stream is aborted before onFinish fires, the partial
      // reply is lost. Simpler + acceptable at current scale.
      //
      // `event.text` is the final concatenated text. Tool calls are
      // captured in agent_logs (via our onFinish in streamOrcReply)
      // plus the per-tool agent_logs from individual tool executions
      // — not persisted into agent_conversations.messages, which
      // stays clean as a user/ORC dialogue record.
      if (event.text && event.text.trim().length > 0) {
        const orcMessage: Message = {
          role: "orc",
          content: event.text,
          ts: new Date().toISOString(),
        };
        // Append atomically via the same JSONB || pattern used in
        // appendUserMessage, plus the active-journey guard. We
        // inline it here rather than creating a new server action
        // because this is the only caller — factoring out would
        // add surface area without reuse benefit.
        const orcMessageJson = JSON.stringify(orcMessage);
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`
          UPDATE agent_conversations AS ac
          SET messages = ac.messages || jsonb_build_array(${orcMessageJson}::jsonb),
              updated_at = NOW()
          FROM signals AS s, journeys AS j
          WHERE ac.id = ${conversation.id}::uuid
            AND ac.agent_name = 'ORC'
            AND s.id = ac.signal_id
            AND s.org_id = ${user.orgId}::uuid
            AND j.id = ac.journey_id
            AND j.status = 'active'
        `);
      }
    },
  });

  // Convert the streaming result to an HTTP streamed response. AI SDK
  // v6 shape — emits text chunks + tool calls + custom data parts all
  // multiplexed into one response. Client consumes via useChat or
  // manual stream handling.
  return result.toUIMessageStreamResponse();
}
