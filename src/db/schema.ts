/**
 * BLIPS BOS Drizzle schema.
 * All 14 tables per ARCHITECTURE.md. Every table is scoped by `org_id`
 * for multi-tenant RLS (Row-Level Security policies applied in a separate
 * SQL migration in Chunk 2C).
 *
 * Design principles:
 * - UUIDs for all primary keys (Postgres generates via gen_random_uuid())
 * - timestamptz everywhere (not plain timestamp — TZ-aware from day 1)
 * - jsonb for flexible payloads (config values, agent outputs, metadata)
 * - Enums for closed sets (signal status, agent name, decade lens, user role)
 * - Foreign keys with onDelete behavior explicit
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ══════════════════════════════════════════════════════════════════
// ENUMS
// ══════════════════════════════════════════════════════════════════

export const signalStatus = pgEnum("signal_status", [
  "IN_BUNKER",
  "IN_STOKER",
  "IN_FURNACE",
  "IN_BOILER",
  "IN_ENGINE",
  "AT_PROPELLER",
  "DOCKED",
  "COLD_BUNKER",
  "DISMISSED",
  "BUNKER_FAILED",
  "EXTRACTION_FAILED",
]);

export const agentName = pgEnum("agent_name", [
  "ORC",
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
]);

export const userRole = pgEnum("user_role", [
  "FOUNDER",
  "EMPLOYEE",
  "PARTNER",
  "VENDOR",
]);

export const decadeLens = pgEnum("decade_lens", ["RCK", "RCL", "RCD"]);

export const candidateStatus = pgEnum("candidate_status", [
  "PENDING_REVIEW",
  "APPROVED",
  "DISMISSED",
]);

export const agentOutputStatus = pgEnum("agent_output_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "REVISION_REQUESTED",
]);

export const agentLogStatus = pgEnum("agent_log_status", [
  "success",
  "error",
  "retry",
]);

export const signalSource = pgEnum("signal_source", [
  "direct",
  "reddit",
  "rss",
  "trends",
  "newsapi",
  "upload",
  "llm_synthesis",
]);

// ══════════════════════════════════════════════════════════════════
// CORE — orgs + users (profile linked to auth.users)
// ══════════════════════════════════════════════════════════════════

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * User profile. `id` matches Supabase `auth.users.id` (1:1).
 * We don't add a DB-level FK to auth.users because auth is a separate schema
 * managed by Supabase; the link is enforced at the app layer (proxy middleware
 * guarantees a Supabase session exists before any protected route runs).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("FOUNDER"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
});

// ══════════════════════════════════════════════════════════════════
// PIPELINE — batches, signals, signal_decades, bunker_candidates
// ══════════════════════════════════════════════════════════════════

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"), // active / complete
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("batches_org_idx").on(t.orgId)],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    shortcode: text("shortcode").notNull(), // 3-6 uppercase letters, unique per org
    workingTitle: text("working_title").notNull(),
    concept: text("concept"),
    status: signalStatus("status").notNull().default("IN_BUNKER"),
    source: signalSource("source").notNull(),
    rawText: text("raw_text"), // preserved original
    rawMetadata: jsonb("raw_metadata"), // upvotes, url, subreddit, etc.
    batchId: uuid("batch_id").references(() => batches.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("signals_org_shortcode_uq").on(t.orgId, t.shortcode),
    index("signals_org_status_idx").on(t.orgId, t.status),
    index("signals_org_batch_idx").on(t.orgId, t.batchId),
    index("signals_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const signalDecades = pgTable(
  "signal_decades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    decadeLens: decadeLens("decade_lens").notNull(),
    manifestation: text("manifestation"),
    evolutionOrder: integer("evolution_order"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("signal_decades_signal_lens_uq").on(t.signalId, t.decadeLens),
  ],
);

export const bunkerCandidates = pgTable(
  "bunker_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    shortcode: text("shortcode").notNull(),
    workingTitle: text("working_title").notNull(),
    concept: text("concept"),
    source: signalSource("source").notNull(),
    rawText: text("raw_text"),
    rawMetadata: jsonb("raw_metadata"),
    contentHash: text("content_hash").notNull(), // SHA-256 for dedup
    status: candidateStatus("status").notNull().default("PENDING_REVIEW"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bunker_candidates_org_hash_uq").on(t.orgId, t.contentHash),
    index("bunker_candidates_org_status_idx").on(t.orgId, t.status),
  ],
);

// ══════════════════════════════════════════════════════════════════
// AGENT EXECUTION — conversations, outputs, logs, decisions, locks
// ══════════════════════════════════════════════════════════════════

export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    agentName: agentName("agent_name").notNull(),
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`), // array of {role, content, ts}
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_conversations_signal_idx").on(t.signalId)],
);

export const agentOutputs = pgTable(
  "agent_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    agentName: agentName("agent_name").notNull(),
    outputType: text("output_type").notNull(), // candidate / decades / brief / gallery / mockup / techpack / bundle
    content: jsonb("content").notNull(), // structured output per stage
    status: agentOutputStatus("status").notNull().default("PENDING"),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("agent_outputs_signal_idx").on(t.signalId),
    index("agent_outputs_signal_agent_idx").on(t.signalId, t.agentName),
  ],
);

/**
 * Observability row per agent action. Captures cost, latency, model choice.
 * Feeds REVIEWS.md phase retros and the eventual BOS billing/usage page.
 */
export const agentLogs = pgTable(
  "agent_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id").references(() => signals.id, {
      onDelete: "set null",
    }), // nullable — cron runs have no signal
    agentName: agentName("agent_name").notNull(),
    action: text("action").notNull(), // skill_loaded / llm_call / output_written / error / etc.
    model: text("model"), // which LLM (claude-haiku / gemini-2.5-flash / etc.)
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }), // micro-dollar precision
    durationMs: integer("duration_ms"),
    status: agentLogStatus("status").notNull(),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("agent_logs_org_created_idx").on(t.orgId, t.createdAt),
    index("agent_logs_signal_idx").on(t.signalId),
    index("agent_logs_agent_idx").on(t.agentName),
  ],
);

export const decisionHistory = pgTable(
  "decision_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    agentName: agentName("agent_name").notNull(),
    decision: text("decision").notNull(), // approved / rejected / revision_requested / parked
    reason: text("reason"),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("decision_history_org_idx").on(t.orgId),
    index("decision_history_signal_idx").on(t.signalId),
  ],
);

/**
 * Signal locks — single-user edit at a time per signal.
 * Auto-expires after 30 min (enforced by a cron cleanup + app-level check).
 */
export const signalLocks = pgTable("signal_locks", {
  id: uuid("id").primaryKey().defaultRandom(),
  signalId: uuid("signal_id")
    .notNull()
    .unique()
    .references(() => signals.id, { onDelete: "cascade" }),
  lockedBy: uuid("locked_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lockedAt: timestamp("locked_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ══════════════════════════════════════════════════════════════════
// CONFIGURATION — BOS / Engine Room / Agent level
// ══════════════════════════════════════════════════════════════════

export const configBos = pgTable(
  "config_bos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("config_bos_org_key_uq").on(t.orgId, t.key)],
);

export const configEngineRoom = pgTable(
  "config_engine_room",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("config_engine_room_org_key_uq").on(t.orgId, t.key)],
);

export const configAgents = pgTable(
  "config_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    agentName: agentName("agent_name").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("config_agents_org_agent_key_uq").on(
      t.orgId,
      t.agentName,
      t.key,
    ),
  ],
);

// ══════════════════════════════════════════════════════════════════
// TABLE EXPORTS for convenience
// ══════════════════════════════════════════════════════════════════

export const allTables = {
  orgs,
  users,
  batches,
  signals,
  signalDecades,
  bunkerCandidates,
  agentConversations,
  agentOutputs,
  agentLogs,
  decisionHistory,
  signalLocks,
  configBos,
  configEngineRoom,
  configAgents,
};
