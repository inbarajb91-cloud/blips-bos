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
  type AnyPgColumn,
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
  "grounded_search", // Phase 6.6 — Gemini useSearchGrounding results
]);

// Phase 6.5 — Collections replace the original `batches` concept.
// Collections wrap the whole lifecycle of a BUNKER run: the triage queue
// of candidates, then the signals those candidates become, tracked
// through every pipeline stage.
export const collectionType = pgEnum("collection_type", [
  "instant", // fixed 5 signals, one-shot
  "batch", // 6-100 signals, one-shot
  "scheduled", // 1-100 per run, recurring via cadence
]);

export const collectionStatus = pgEnum("collection_status", [
  "queued", // just created, Inngest has the event
  "running", // actively collecting
  "idle", // finished (one-shot) or waiting for next run (scheduled)
  "archived", // user archived
  "failed",
]);

// Phase 6.6 — search_mode governs how BUNKER actually sources content.
// Trend: pull from the standing 5 sources, filter by brand DNA. Outline
// is descriptive only.
// Reference: outline IS the query. Gemini grounded-search pulls web
// content matching the theme; BUNKER extracts from that. Outline required.
export const collectionSearchMode = pgEnum("collection_search_mode", [
  "trend",
  "reference",
]);

// Phase 6.6 — optional decade picker on Collect-now modal. Sourcing bias
// only; does NOT replace STOKER's decade-manifestation fan-out downstream.
export const collectionDecadeHint = pgEnum("collection_decade_hint", [
  "any",
  "RCK", // 28-38
  "RCL", // 38-48
  "RCD", // 48-58
]);

export const collectionCadence = pgEnum("collection_cadence", [
  "daily",
  "weekly",
  "monthly",
  "custom",
]);

// Phase 8 — Journeys. Every signal has one or more journeys over its
// lifetime. A journey is the narrative of one attempt through the
// pipeline; resetting from stage X archives the current journey and
// starts a new one with upstream stages inherited. See MEMORY.md for
// the locked decision and agents/ORC.md for how journeys interact
// with ORC's context.
export const journeyStatus = pgEnum("journey_status", [
  "active", // the one journey currently driving the pipeline
  "archived", // a prior attempt, read-only
  "dismissed", // signal reset was a mistake and the user abandoned the attempt
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
    // Legacy — superseded by collectionId as of Phase 6.5. Kept for back-compat.
    batchId: uuid("batch_id").references(() => batches.id, {
      onDelete: "set null",
    }),
    // Phase 6.5 — signal inherits its originating collection at approve time.
    collectionId: uuid("collection_id").references(() => collections.id, {
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
    index("signals_org_collection_idx").on(t.orgId, t.collectionId),
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
    // Phase 8 — scoped to a journey. Resetting STOKER archives the
    // old journey's decade rows (still readable via the archived
    // journey view) and creates new ones on the new journey.
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    decadeLens: decadeLens("decade_lens").notNull(),
    manifestation: text("manifestation"),
    evolutionOrder: integer("evolution_order"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Unique scoped to (signal, journey, decade) — each journey
    // gets its own set of decade manifestations for the signal.
    uniqueIndex("signal_decades_signal_journey_lens_uq").on(
      t.signalId,
      t.journeyId,
      t.decadeLens,
    ),
    index("signal_decades_journey_idx").on(t.journeyId),
  ],
);

export const bunkerCandidates = pgTable(
  "bunker_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Phase 6.5 — each candidate belongs to the collection that produced it.
    // Nullable so pre-6.5 rows don't break the FK; new rows always populate.
    collectionId: uuid("collection_id").references(() => collections.id, {
      onDelete: "set null",
    }),
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
    index("bunker_candidates_collection_idx").on(t.collectionId),
  ],
);

// ══════════════════════════════════════════════════════════════════
// COLLECTIONS — Phase 6.5. Container for a BUNKER run's whole lifecycle:
// candidates (triage) → signals (pipeline) → through every stage.
// ══════════════════════════════════════════════════════════════════

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    outline: text("outline"), // descriptive label in trend mode; actual search query in reference mode
    type: collectionType("type").notNull(),
    targetCount: integer("target_count").notNull(), // 5 for instant; 6-100 batch; 1-100 per-run scheduled
    cadence: collectionCadence("cadence"), // only set for scheduled
    cadenceCron: text("cadence_cron"), // only set when cadence='custom'
    // Phase 6.6 — search_mode governs sourcing strategy.
    // trend: existing 5 sources + outline is label. reference: outline is the
    // query, Gemini grounded-search pulls theme-matching web content.
    searchMode: collectionSearchMode("search_mode").notNull().default("trend"),
    // Phase 6.6 — optional audience bias hint. "any" = no bias (default).
    // Doesn't replace STOKER's decade fan-out; just biases what BUNKER surfaces.
    decadeHint: collectionDecadeHint("decade_hint").notNull().default("any"),
    status: collectionStatus("status").notNull().default("queued"),
    // Aggregate counters for display; kept in sync on candidate/signal state changes.
    candidateCount: integer("candidate_count").notNull().default(0),
    signalCount: integer("signal_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }), // only scheduled rows populate this; cron checker queries it
  },
  (t) => [
    index("collections_org_status_idx").on(t.orgId, t.status),
    index("collections_org_created_idx").on(t.orgId, t.createdAt),
    index("collections_next_run_idx").on(t.nextRunAt),
  ],
);

// Each cadence fire (or single fire for instant/batch) is a run.
// Candidates get linked to the run that produced them via content_hash +
// timestamp ordering; we don't FK candidates directly to runs to keep the
// dedup flow simple.
export const collectionRuns = pgTable(
  "collection_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    status: collectionStatus("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    fetchedRaw: integer("fetched_raw").notNull().default(0),
    deduped: integer("deduped").notNull().default(0),
    extracted: integer("extracted").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    sourcesSnapshot: jsonb("sources_snapshot"), // { sources_enabled, per-source caps, etc. at time of run }
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("collection_runs_collection_idx").on(t.collectionId),
    index("collection_runs_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

// ══════════════════════════════════════════════════════════════════
// JOURNEYS — Phase 8. One or more per signal; each journey is an
// attempt at driving the signal through the pipeline. Resetting from
// a stage archives the current journey and starts a new one with
// upstream stages inherited. Every per-signal execution artifact
// (agent_outputs, agent_conversations, signal_decades, agent_logs,
// decision_history) tags to the journey it belongs to via journey_id.
// ══════════════════════════════════════════════════════════════════

export const journeys = pgTable(
  "journeys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    // Per-signal monotonic counter: 1, 2, 3... Easier to reference in
    // UI ("Journey 2") than a UUID.
    sequenceNumber: integer("sequence_number").notNull(),
    status: journeyStatus("status").notNull().default("active"),
    // When a reset happens, the new journey's previous_journey_id
    // points at the archived one. Builds a chain; usually linear in
    // practice (J1 → J2 → J3) rather than a tree.
    previousJourneyId: uuid("previous_journey_id").references(
      (): AnyPgColumn => journeys.id,
      { onDelete: "set null" },
    ),
    // Which stage the user reset from. Null on the initial journey
    // (Journey 1) — no reset happened; it's the first attempt.
    resetFromStage: agentName("reset_from_stage"),
    resetReason: text("reset_reason"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // Sequence numbers are per-signal monotonic
    uniqueIndex("journeys_signal_sequence_uq").on(t.signalId, t.sequenceNumber),
    // At most one active journey per signal at any time. Partial
    // index — archived/dismissed journeys don't compete for the slot.
    uniqueIndex("journeys_signal_active_uidx")
      .on(t.signalId)
      .where(sql`${t.status} = 'active'`),
    index("journeys_signal_idx").on(t.signalId),
    index("journeys_previous_idx").on(t.previousJourneyId),
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
    // Phase 8 — each journey gets its own conversation per agent.
    // Resetting starts a fresh ORC thread for the new journey; the
    // archived journey's thread stays readable via the history view.
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    agentName: agentName("agent_name").notNull(),
    messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`), // array of {role, content, ts, stage}
    // Phase 8 — per-conversation state for the context economy:
    // { summary, summary_through_index, summary_updated_at,
    //   gemini_cache_name, gemini_cache_expires_at }
    // Default '{}' so pre-Phase-8 rows don't need a data backfill;
    // populated lazily on first ORC reply turn.
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("agent_conversations_signal_idx").on(t.signalId),
    // Phase 8 — one thread per (journey, agent). Replaces Phase 7's
    // (signal, agent) constraint. Each journey owns its ORC thread;
    // archived journeys retain their threads for audit/readback.
    uniqueIndex("agent_conversations_journey_agent_uidx").on(
      t.journeyId,
      t.agentName,
    ),
    index("agent_conversations_journey_idx").on(t.journeyId),
  ],
);

export const agentOutputs = pgTable(
  "agent_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    // Phase 8 — outputs scoped to a journey. Queries for "current
    // state of the signal" filter by the active journey's id.
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
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
    index("agent_outputs_journey_idx").on(t.journeyId),
    index("agent_outputs_journey_agent_idx").on(t.journeyId, t.agentName),
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
    // Phase 8 — nullable. Pre-signal BUNKER extraction logs and
    // cron-triggered source fetches have no journey to tag to.
    // Post-signal agent calls populate it so observability queries
    // can scope by "this journey's costs."
    journeyId: uuid("journey_id").references(() => journeys.id, {
      onDelete: "set null",
    }),
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
    index("agent_logs_journey_idx").on(t.journeyId),
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
    // Phase 8 — every decision (approve / reject / reset / etc.) is
    // bound to the journey it happened within. Non-null because
    // decisions never occur outside a journey — you approve in the
    // context of an attempt.
    journeyId: uuid("journey_id")
      .notNull()
      .references(() => journeys.id, { onDelete: "cascade" }),
    agentName: agentName("agent_name").notNull(),
    decision: text("decision").notNull(), // approved / rejected / revision_requested / parked / reset_from / dismissed
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
    index("decision_history_journey_idx").on(t.journeyId),
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
  collections,
  collectionRuns,
  signals,
  signalDecades,
  bunkerCandidates,
  journeys,
  agentConversations,
  agentOutputs,
  agentLogs,
  decisionHistory,
  signalLocks,
  configBos,
  configEngineRoom,
  configAgents,
};
