"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, agentConversations, signals } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { getActiveJourney } from "@/lib/orc/journey";

/**
 * ORC conversation actions — Phase 7D.
 *
 * Each signal has ONE ORC conversation (`agent_name = 'ORC'`). Messages
 * are stored as a jsonb array on the conversation row. Scope key is
 * signal-level, not stage-level: ORC carries the whole signal's thread
 * across all stages. The current stage is stamped on each message via
 * `stage` so ORC (and later UI) can see "what stage was the user on
 * when they said this."
 *
 * Phase 7D scope is persistence only: user messages round-trip to the
 * database and render in the thread. No auto-reply from ORC yet —
 * Phase 8 (real ORC agent) handles that. Seed message on first open
 * is a stage-aware template so the thread isn't empty when the user
 * arrives.
 */

export type MessageRole = "orc" | "user";
export type StageKey =
  | "BUNKER"
  | "STOKER"
  | "FURNACE"
  | "BOILER"
  | "ENGINE"
  | "PROPELLER";

export interface Message {
  role: MessageRole;
  content: string;
  ts: string; // ISO string
  /** Which agent tab was active when this message was sent. Useful
   *  context when Phase 8 ORC reads history to inform responses. */
  stage?: StageKey;
}

export interface OrcConversation {
  id: string;
  signalId: string;
  messages: Message[];
}

/**
 * Get or create the ORC conversation for a signal. Creates with a
 * seed opening message the first time a user opens the workspace for
 * this signal.
 */
export async function getOrCreateOrcConversation(
  signalId: string,
): Promise<OrcConversation> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  // Verify signal exists + belongs to user's org before touching the
  // conversation. Scoping defense-in-depth against service-role access.
  const [signal] = await db
    .select({
      id: signals.id,
      shortcode: signals.shortcode,
      source: signals.source,
      workingTitle: signals.workingTitle,
      status: signals.status,
    })
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.orgId, user.orgId)))
    .limit(1);
  if (!signal) throw new Error("Signal not found");

  // Resolve the active journey for this signal. Every signal has
  // exactly one active journey at any time (partial unique index
  // enforces it); the ORC conversation is scoped to THAT journey so
  // resetting a signal (archiving the active journey, spawning a new
  // one) gives ORC a fresh thread on the new attempt while preserving
  // the old journey's thread readable as history.
  const activeJourney = await getActiveJourney(signalId);

  // SELECT first, INSERT if missing, catch 23505 on the race.
  //
  // Post-Phase-8 the unique index is on (journey_id, agent_name) — a
  // new journey naturally gets its own ORC thread because its
  // journey_id is fresh. Race only matters when two concurrent first
  // opens hit the same journey at the same time, which is the same
  // race we handled in Phase 7.
  //
  // The pattern is resilient regardless of index presence:
  //   1. Index present + no race: SELECT → nothing → INSERT succeeds.
  //   2. Index present + race: losing racer catches 23505 and
  //      re-SELECTs the winner.
  //   3. Index absent (pre-migration): INSERT always succeeds; races
  //      may produce duplicates, accepted transiently until migration
  //      lands — same pattern used in Phase 7 and still apt here.
  const [existing] = await db
    .select()
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.journeyId, activeJourney.id),
        eq(agentConversations.agentName, "ORC"),
      ),
    )
    .orderBy(agentConversations.createdAt)
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      signalId: existing.signalId,
      messages: (existing.messages as Message[]) ?? [],
    };
  }

  const seedMessage: Message = {
    role: "orc",
    content: buildSeedMessage(signal.source, signal.workingTitle),
    ts: new Date().toISOString(),
  };

  try {
    const [created] = await db
      .insert(agentConversations)
      .values({
        signalId,
        journeyId: activeJourney.id,
        agentName: "ORC",
        messages: [seedMessage],
      })
      .returning();
    return {
      id: created.id,
      signalId: created.signalId,
      messages: (created.messages as Message[]) ?? [],
    };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost the race. Re-SELECT to return the winning row.
    const [raced] = await db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.journeyId, activeJourney.id),
          eq(agentConversations.agentName, "ORC"),
        ),
      )
      .orderBy(agentConversations.createdAt)
      .limit(1);
    if (!raced) {
      // Shouldn't happen: 23505 means there's already a row on the
      // (journey_id, agent_name) pair. If the select misses, something
      // is truly wrong — surface the original error to keep diagnostics.
      throw e;
    }
    return {
      id: raced.id,
      signalId: raced.signalId,
      messages: (raced.messages as Message[]) ?? [],
    };
  }
}

/**
 * Detect Postgres unique_violation (SQLSTATE 23505). Wraps the check
 * in defensive property access since the error shape varies between
 * postgres.js / node-postgres / drizzle wrappers; some attach `code`
 * on the error itself, others wrap it in `.cause`.
 */
function isUniqueViolation(e: unknown): boolean {
  if (e && typeof e === "object") {
    if ("code" in e && (e as { code?: string }).code === "23505") return true;
    if ("cause" in e) return isUniqueViolation((e as { cause?: unknown }).cause);
  }
  return false;
}

/**
 * Append a user message to an ORC conversation. Pushes onto the
 * messages jsonb array atomically and bumps updatedAt so Realtime
 * subscribers (future) can see the change.
 *
 * Returns the updated message list so the client doesn't have to re-read.
 */
export async function appendUserMessage(
  conversationId: string,
  content: string,
  stage?: StageKey,
): Promise<Message[]> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Unauthenticated");

  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error("Message is empty.");
  if (trimmed.length > 2000) {
    throw new Error("Message is too long (2000 character max).");
  }

  const newMessage: Message = {
    role: "user",
    content: trimmed,
    ts: new Date().toISOString(),
    ...(stage ? { stage } : {}),
  };

  // Atomic append via Postgres JSONB `||` operator.
  //
  // Previous implementation was read-modify-write: SELECT messages,
  // spread-append in JS, UPDATE whole array. Two concurrent sends
  // could both read the same pre-state, each append locally, and the
  // second UPDATE would overwrite — dropping the first user's message
  // silently. CodeRabbit flagged this as Critical.
  //
  // We now merge the scope check and the append into one UPDATE:
  //   - JOIN signals in the FROM clause so Postgres enforces the org
  //     scope as part of the WHERE (not a separate read)
  //   - `messages || jsonb_build_array(...)` does the append in place,
  //     so no client-side read of the current array is needed
  //   - If the WHERE fails (conversation missing, wrong agent, wrong
  //     org, etc.) RETURNING yields zero rows and we surface "not found"
  //
  // CodeRabbit round 2 flagged: the WHERE only scoped by conversationId
  // + org, not by agent_name. The function is `appendUserMessage`
  // called from ORC panel and uses StageKey stamping — it has no
  // business writing into a BUNKER/STOKER/etc. thread even if one
  // existed on the same table with a guessable ID. Pinning
  // `agent_name = 'ORC'` in the WHERE makes the function match its
  // name and keeps future phases' per-agent threads isolated from
  // cross-agent append.
  //
  // Phase 8: also join journeys and require `status = 'active'`.
  // When Phase 9's archived-journey-view UX lands, the client will
  // already prevent sends from read-only mode, but defense in depth
  // matters — a crafted request against an archived-journey
  // conversationId should touch zero rows, not silently append into
  // history. "Not found" is the right surface either way.
  //
  // Concurrent appends serialize on the row's write lock — the DB is
  // the source of truth for ordering, not the client. No message drop.
  const newMessageJson = JSON.stringify(newMessage);
  const rows = await db.execute<{ messages: Message[] }>(sql`
    UPDATE agent_conversations AS ac
    SET messages = ac.messages || jsonb_build_array(${newMessageJson}::jsonb),
        updated_at = NOW()
    FROM signals AS s, journeys AS j
    WHERE ac.id = ${conversationId}::uuid
      AND ac.agent_name = 'ORC'
      AND s.id = ac.signal_id
      AND s.org_id = ${user.orgId}::uuid
      AND j.id = ac.journey_id
      AND j.status = 'active'
    RETURNING ac.messages
  `);

  if (rows.length === 0) {
    // Either the conversation doesn't exist or the signal isn't in
    // this user's org. We don't differentiate — same "not found" from
    // the caller's perspective, less info leaking about existence of
    // cross-org rows.
    throw new Error("Conversation not found");
  }

  // Revalidate so the workspace page re-reads on next navigation/render
  revalidatePath(`/engine-room/signals`, "layout");

  return (rows[0].messages as Message[]) ?? [];
}

// ─── Seed message templates ─────────────────────────────────────────

/**
 * ORC's opening observation when a user first opens a signal's
 * workspace. Varies by source + signal identity so it reads like
 * context-aware acknowledgement, not a generic greeting.
 *
 * Phase 8 real ORC replaces this with an actual LLM call that reads
 * the full signal dossier.
 */
function buildSeedMessage(source: string, workingTitle: string): string {
  const sourceNarrative = narrateSource(source);
  return `I pulled "${workingTitle}" ${sourceNarrative}. The extraction's clean and the tension reads. Ask me anything about this signal — I'll carry the thread with you as it moves through the stages.`;
}

function narrateSource(source: string): string {
  switch (source) {
    case "direct":
      return "from your direct submission";
    case "reddit":
      return "off a Reddit pull";
    case "rss":
      return "from an RSS feed";
    case "trends":
      return "off a Google Trends run";
    case "llm_synthesis":
      return "from an LLM synthesis pass";
    case "grounded_search":
      return "off a grounded search you queued";
    case "newsapi":
      return "from a news search";
    case "upload":
      return "from a file upload";
    default:
      return "from a standing source";
  }
}
