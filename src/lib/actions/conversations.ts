"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, signals } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";

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

  // Atomic insert-or-get.
  //
  // Previous implementation read-then-wrote: SELECT, branch on existence,
  // INSERT if missing. Two concurrent first-opens could both miss the
  // SELECT and both INSERT, leaving duplicate ORC threads — and the
  // `.limit(1)` lookup would pick nondeterministically. The DB now has
  // a UNIQUE INDEX on (signal_id, agent_name) (migration 0001) so the
  // duplicate INSERT would fail with 23505.
  //
  // We use INSERT ... ON CONFLICT DO UPDATE with a no-op assignment so
  // we get RETURNING rows in both the insert path and the conflict
  // path. Seed message is only persisted on the genuine insert path —
  // on conflict the no-op keeps the existing messages array intact.
  // Result: one round-trip, race-safe, no duplicates.
  const seedMessage: Message = {
    role: "orc",
    content: buildSeedMessage(signal.source, signal.workingTitle),
    ts: new Date().toISOString(),
  };
  const seedJson = JSON.stringify([seedMessage]);

  const rows = await db.execute<{
    id: string;
    signal_id: string;
    messages: Message[];
  }>(sql`
    INSERT INTO agent_conversations (signal_id, agent_name, messages)
    VALUES (${signalId}::uuid, 'ORC', ${seedJson}::jsonb)
    ON CONFLICT (signal_id, agent_name) DO UPDATE
      SET updated_at = agent_conversations.updated_at
    RETURNING id, signal_id, messages
  `);

  const row = rows[0];
  if (!row) throw new Error("Failed to upsert ORC conversation");
  return {
    id: row.id,
    signalId: row.signal_id,
    messages: (row.messages as Message[]) ?? [],
  };
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
  //   - If the WHERE fails (conversation missing, wrong org, etc.)
  //     RETURNING yields zero rows and we surface "not found"
  //
  // Concurrent appends serialize on the row's write lock — the DB is
  // the source of truth for ordering, not the client. No message drop.
  const newMessageJson = JSON.stringify(newMessage);
  const rows = await db.execute<{ messages: Message[] }>(sql`
    UPDATE agent_conversations AS ac
    SET messages = ac.messages || jsonb_build_array(${newMessageJson}::jsonb),
        updated_at = NOW()
    FROM signals AS s
    WHERE ac.id = ${conversationId}::uuid
      AND s.id = ac.signal_id
      AND s.org_id = ${user.orgId}::uuid
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
