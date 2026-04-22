"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, agentConversations, signals } from "@/db";
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

  // Look for existing conversation
  const [existing] = await db
    .select()
    .from(agentConversations)
    .where(
      and(
        eq(agentConversations.signalId, signalId),
        eq(agentConversations.agentName, "ORC"),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      signalId: existing.signalId,
      messages: (existing.messages as Message[]) ?? [],
    };
  }

  // Create new conversation with a seed opening message. Template is
  // server-side so it's canonical + persists consistently; Phase 8
  // real ORC can regenerate if the template turns out wrong.
  const seedMessage: Message = {
    role: "orc",
    content: buildSeedMessage(signal.source, signal.workingTitle),
    ts: new Date().toISOString(),
  };

  const [created] = await db
    .insert(agentConversations)
    .values({
      signalId,
      agentName: "ORC",
      messages: [seedMessage],
    })
    .returning();

  return {
    id: created.id,
    signalId: created.signalId,
    messages: (created.messages as Message[]) ?? [],
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

  // Load conversation + verify scope via signal → org
  const [convo] = await db
    .select({
      id: agentConversations.id,
      signalId: agentConversations.signalId,
      messages: agentConversations.messages,
    })
    .from(agentConversations)
    .where(eq(agentConversations.id, conversationId))
    .limit(1);
  if (!convo) throw new Error("Conversation not found");

  // Scope check: signal belongs to this user's org
  const [signal] = await db
    .select({ id: signals.id })
    .from(signals)
    .where(
      and(eq(signals.id, convo.signalId), eq(signals.orgId, user.orgId)),
    )
    .limit(1);
  if (!signal) throw new Error("Signal not found");

  const existingMessages = (convo.messages as Message[]) ?? [];
  const newMessage: Message = {
    role: "user",
    content: trimmed,
    ts: new Date().toISOString(),
    ...(stage ? { stage } : {}),
  };
  const nextMessages = [...existingMessages, newMessage];

  await db
    .update(agentConversations)
    .set({
      messages: nextMessages,
      updatedAt: new Date(),
    })
    .where(eq(agentConversations.id, conversationId));

  // Revalidate so the workspace page re-reads on next navigation/render
  revalidatePath(`/engine-room/signals`, "layout");

  return nextMessages;
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
