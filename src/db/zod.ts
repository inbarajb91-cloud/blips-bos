/**
 * Zod schemas auto-generated from Drizzle tables via drizzle-zod.
 *
 * Three flavors per table:
 *   select*  — shape when READING from DB (all columns, defaults resolved)
 *   insert*  — shape for CREATE (server-generated cols optional)
 *   update*  — partial shape for UPDATE
 *
 * These are the validation boundary for:
 *   1. Server actions receiving form data
 *   2. API routes receiving JSON
 *   3. LLM outputs (each agent skill validates its `agent_outputs.content`
 *      against the appropriate Zod shape before DB write)
 */

import { createSelectSchema, createInsertSchema, createUpdateSchema } from "drizzle-zod";
import {
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
} from "./schema";

// ─── Core ────────────────────────────────────────────────────────
export const selectOrg = createSelectSchema(orgs);
export const insertOrg = createInsertSchema(orgs);
export const updateOrg = createUpdateSchema(orgs);

export const selectUser = createSelectSchema(users);
export const insertUser = createInsertSchema(users);
export const updateUser = createUpdateSchema(users);

// ─── Pipeline ────────────────────────────────────────────────────
export const selectBatch = createSelectSchema(batches);
export const insertBatch = createInsertSchema(batches);
export const updateBatch = createUpdateSchema(batches);

export const selectSignal = createSelectSchema(signals);
export const insertSignal = createInsertSchema(signals);
export const updateSignal = createUpdateSchema(signals);

export const selectSignalDecade = createSelectSchema(signalDecades);
export const insertSignalDecade = createInsertSchema(signalDecades);
export const updateSignalDecade = createUpdateSchema(signalDecades);

export const selectBunkerCandidate = createSelectSchema(bunkerCandidates);
export const insertBunkerCandidate = createInsertSchema(bunkerCandidates);
export const updateBunkerCandidate = createUpdateSchema(bunkerCandidates);

// ─── Agent execution ─────────────────────────────────────────────
export const selectAgentConversation = createSelectSchema(agentConversations);
export const insertAgentConversation = createInsertSchema(agentConversations);
export const updateAgentConversation = createUpdateSchema(agentConversations);

export const selectAgentOutput = createSelectSchema(agentOutputs);
export const insertAgentOutput = createInsertSchema(agentOutputs);
export const updateAgentOutput = createUpdateSchema(agentOutputs);

export const selectAgentLog = createSelectSchema(agentLogs);
export const insertAgentLog = createInsertSchema(agentLogs);

export const selectDecisionHistory = createSelectSchema(decisionHistory);
export const insertDecisionHistory = createInsertSchema(decisionHistory);

export const selectSignalLock = createSelectSchema(signalLocks);
export const insertSignalLock = createInsertSchema(signalLocks);

// ─── Config ──────────────────────────────────────────────────────
export const selectConfigBos = createSelectSchema(configBos);
export const insertConfigBos = createInsertSchema(configBos);
export const updateConfigBos = createUpdateSchema(configBos);

export const selectConfigEngineRoom = createSelectSchema(configEngineRoom);
export const insertConfigEngineRoom = createInsertSchema(configEngineRoom);
export const updateConfigEngineRoom = createUpdateSchema(configEngineRoom);

export const selectConfigAgents = createSelectSchema(configAgents);
export const insertConfigAgents = createInsertSchema(configAgents);
export const updateConfigAgents = createUpdateSchema(configAgents);
