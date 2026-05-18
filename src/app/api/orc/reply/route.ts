import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, signals, agentConversations } from "@/db";
import type { signals as signalsTable } from "@/db/schema";
import { checkOrcReplyRateLimit } from "@/lib/api/rate-limit";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { classifyMutationIntent } from "@/lib/orc/mutation-intent";
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
import { getMemoryBackend } from "@/lib/orc/memory";

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
  // Phase 10.4.2 — when the user is on a parent workspace tab that's
  // manifestation-scoped (FURNACE/BOILER/ENGINE/PROPELLER) and a
  // manifestation child is active in the URL (?m=DECADE), the client
  // sends the child's signal id here so the route can resolve its
  // journey + thread it through ORC's tool context. Tools that pull
  // post-STOKER stage data route to this manifestation instead of the
  // parent. Null/omitted on pre-STOKER tabs and when no manifestation
  // is active.
  activeManifestationId: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  // REVIEW.md F7 (High): collapse the previous double auth roundtrip.
  // We used to call `requireSession()` (which does supabase.auth.getUser())
  // and then `getCurrentUserWithOrg()` (which calls supabase.auth.getUser()
  // again — React.cache only dedups within a single render tree, NOT across
  // separate awaits in a route handler). That cost an extra ~50-150ms of
  // Supabase auth round-trip latency per ORC reply. Identical security
  // posture: `getCurrentUserWithOrg` does the auth check AND joins to
  // public.users for org_id. If null, return 401 (was previously a
  // requireSession-driven 401 of the same shape).
  const user = await getCurrentUserWithOrg();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthenticated or no linked profile for this session" },
      { status: 401 },
    );
  }

  // Rate limit — 30 reply requests per minute per user. Protects
  // against frontend loops (abort-retry cycles), rapid-click Send,
  // and future multi-user abuse. See lib/api/rate-limit.ts for
  // config + the single-instance caveat.
  const rl = checkOrcReplyRateLimit(user.authId);
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

  // REVIEW.md F22 (Medium, from PR #54): reject oversized bodies BEFORE
  // req.json() parses them. Zod's userMessage.max(2000) only catches it
  // post-parse — a 10 MB POST gets parsed before being rejected, wasting
  // CPU + memory. Combined with the 30 req/min limit, a single user could
  // shed serverless memory. 16 KB covers a 2k userMessage + UUIDs + JSON
  // envelope with generous margin.
  //
  // Conflict resolution note (May 18): when this branch rebased on main
  // after PR #54 (hygiene bundle) merged, the duplicate `const user =
  // await getCurrentUserWithOrg()` block PR #54 had here was removed in
  // favor of the version at the top of the handler (F7's collapse of the
  // double auth roundtrip — user is already resolved above). F22's
  // Content-Length check kept as-is.
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 16_000) {
    return NextResponse.json(
      { error: "Request body too large", limit: 16_000 },
      { status: 413 },
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
  const { signalId, userMessage, stage, activeManifestationId } = parsed;

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

  // Phase 10.4.2 — resolve the active manifestation's journey when the
  // client signaled one. We scope-check it (must be a child of `signal`,
  // same org) so a malformed client request can't have ORC operate on
  // an arbitrary signal. If lookup fails for any reason (deleted,
  // dismissed past visibility, scope mismatch), we silently fall through
  // to no-manifestation context — tools just stay parent-scoped, same
  // as pre-Phase-10.4.2 behavior.
  let activeManifestationContext: {
    signalId: string;
    journeyId: string;
    decade: "RCK" | "RCL" | "RCD";
    shortcode: string;
  } | null = null;
  if (activeManifestationId) {
    const [child] = await db
      .select({
        id: signals.id,
        shortcode: signals.shortcode,
        decade: signals.manifestationDecade,
        parentId: signals.parentSignalId,
      })
      .from(signals)
      .where(
        and(
          eq(signals.id, activeManifestationId),
          eq(signals.orgId, user.orgId),
          eq(signals.parentSignalId, signalId),
        ),
      )
      .limit(1);
    if (child && child.decade) {
      // Guard the journey lookup so a transient DB hiccup or a missing-
      // journey edge case doesn't 500 the whole ORC turn — the
      // documented behavior is "fall through to parent-scoped tools",
      // not "fail the request". Keep activeManifestationContext null on
      // failure so the route continues normally.
      try {
        const childJourney = await getActiveJourney(child.id);
        activeManifestationContext = {
          signalId: child.id,
          journeyId: childJourney.id,
          decade: child.decade as "RCK" | "RCL" | "RCD",
          shortcode: child.shortcode,
        };
      } catch (err) {
        console.warn(
          `[orc/reply] failed to resolve manifestation journey for ${child.id} (${child.shortcode}); falling through to parent-scoped tools:`,
          err,
        );
      }
    }
  }

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
  // Phase 8F + bugfix 2026-04-25 — inline summarization with bounded
  // loop. Each pass folds the six oldest unsummarized messages into
  // the rolling summary and advances summary_through_index. We re-run
  // until the context no longer needs summarization OR we hit the
  // pass cap, whichever comes first.
  //
  // Why a loop, not a single pass: if a burst of 20+ messages arrived
  // before the previous turn's summarization caught up, one pass only
  // moves 6 → leaves 14+ unsummarized → the count trigger still fires
  // → without a loop the second batch would silently drop on render.
  //
  // Cap of 3 passes folds up to 18 messages per turn. Each pass costs
  // ~$0.00005 on Flash, so a worst-case loop is ~$0.00015 — bounded
  // both in latency and dollars.
  const MAX_SUMMARY_PASSES = 3;
  let workingMetadata = metadata;
  let summaryPasses = 0;
  while (context.needsSummarization && summaryPasses < MAX_SUMMARY_PASSES) {
    const summaryResult = await summarizeConversation({
      conversationId: conversation.id,
      orgId: user.orgId,
      signalId,
      journeyId: activeJourney.id,
      messages,
      metadata: workingMetadata,
    });
    workingMetadata = summaryResult.metadata;

    // Rebuild context with the updated metadata (summary +
    // summary_through_index changed; messages list unchanged).
    context = buildOrcPromptContext({
      signal: signal as typeof signalsTable.$inferSelect,
      messages,
      metadata: workingMetadata,
      currentUserMessage: userMessage,
      activeStage: stage as StageKey,
    });

    summaryPasses++;
  }

  // If still over budget after all summarization attempts, surface
  // as 413. Rare cases: current message itself is huge, summary
  // grew beyond its cap, or the user blew past 18 messages of burst
  // in a single turn (which the cap deliberately doesn't fully
  // handle — that's an "abuse" path, not a normal one).
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

  // Phase 8K hook — if we just summarised this turn, persist the
  // FINAL summary into long-term memory so it's recallable across
  // signals and sessions. We only write on the last pass (after the
  // loop) to avoid 2-3× memory writes per turn when multiple passes
  // fire. Wrapper swallows errors so this is best-effort. Explicit
  // container='events' (auto-written, not curated knowledge).
  if (summaryPasses > 0 && workingMetadata.summary) {
    const memory = await getMemoryBackend();
    await memory.remember({
      orgId: user.orgId,
      container: "events",
      kind: "conversation_summary",
      content: workingMetadata.summary,
      signalId,
      journeyId: activeJourney.id,
      metadata: {
        coversThroughIndex:
          workingMetadata.summary_through_index ?? 0,
        signalShortcode: signal.shortcode,
      },
    });
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
    // Phase 7.5 — pass the current tab as a workspace-orientation
    // hint. buildCachedMessages prepends it to the user message
    // ephemerally (not in the cached prefix) so ORC knows which tab
    // the user is on without invalidating the prefix cache on every
    // stage switch. ORC stays cross-stage aware via tools; the hint
    // just orients reasoning toward where the user is looking.
    activeStageHint: stage,
    // Phase 10.4.2 — surface the active manifestation in the same hint
    // so ORC knows post-STOKER tools route to this child by default.
    activeManifestationHint: activeManifestationContext
      ? {
          shortcode: activeManifestationContext.shortcode,
          decade: activeManifestationContext.decade,
        }
      : null,
  });

  // REVIEW.md F4 (May 18, 2026): mutation-intent classification — LLM
  // replaces the prior whole-word regex. The regex had false positives
  // ("I approve of the framing — can you draft a section about that?"
  // matched on `approve`, binding every destructive tool for that turn).
  // LLM intent classifier is calibrated for the actual question
  // ("is the user REQUESTING a mutation?") instead of substring matching.
  //
  // Cost: ~$0.0001/call. Latency: ~150-300ms typical. Fail-safe to
  // FALSE on classifier error (safer side to err on — false negative
  // makes ORC ask for explicit confirmation; false positive widens
  // destructive surface).
  //
  // Defense-in-depth unchanged: system prompt's framing, action-level
  // org/status checks at SQL layer, AI SDK tool-output validation all
  // still apply. This gate only decides AVAILABILITY of destructive
  // tools for the turn.
  const intent = await classifyMutationIntent(userMessage);
  const allowMutation = intent.mutationRequested;

  // Bind tools to this request's context
  const tools = buildOrcTools({
    orgId: user.orgId,
    userId: user.authId,
    signalId,
    journeyId: activeJourney.id,
    activeManifestation: activeManifestationContext,
    activeStage: stage,
    allowMutation,
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
        // REVIEW.md F8 (High): removed `const { sql } = await import("drizzle-orm")`
        // dead-weight dynamic import — `sql` is now imported statically at the top.
        const orcMessageJson = JSON.stringify(orcMessage);
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
