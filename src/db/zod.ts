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
  // Phase 11D — BOILER v2
  designVersions,
  mockupRenders,
  boilerState,
} from "./schema";

import { z } from "zod";

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

// ─── Phase 11D — BOILER v2 ──────────────────────────────────────
// Auto-generated DB-shape schemas + hand-rolled shape schemas for the
// JSONB content (palette_roles, composition_meta). The hand-rolled ones
// are what the BOILER skill validates LLM outputs against; the auto-
// generated ones are what server actions / API routes validate request
// bodies against.

export const selectDesignVersion = createSelectSchema(designVersions);
export const insertDesignVersion = createInsertSchema(designVersions);
export const updateDesignVersion = createUpdateSchema(designVersions);

export const selectMockupRender = createSelectSchema(mockupRenders);
export const insertMockupRender = createInsertSchema(mockupRenders);
export const updateMockupRender = createUpdateSchema(mockupRenders);

export const selectBoilerState = createSelectSchema(boilerState);
export const insertBoilerState = createInsertSchema(boilerState);
export const updateBoilerState = createUpdateSchema(boilerState);

// ─── BOILER v2 — content-shape schemas ──────────────────────────
// Five palette roles per design (locked at the FURNACE-brief stage,
// editable per-row in the workspace color picker). Each value is a
// 6-digit hex color with leading #.

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/u, "must be a 6-digit hex with leading #");

export const paletteRolesSchema = z.object({
  garment_base: hexColor,
  ring_outer: hexColor,
  ring_inner: hexColor,
  front_ink: hexColor,
  back_ink: hexColor,
});
export type PaletteRoles = z.infer<typeof paletteRolesSchema>;

// Open-ended composition meta — locked elements documented by FURNACE
// schema upgrade. Validation is loose here (z.unknown() per field) so
// the skill can evolve without a migration; tightened at the FURNACE
// schema level where the structure is defined.
export const compositionMetaSchema = z.object({
  exact_text: z
    .object({ front: z.string().optional(), back: z.string().optional() })
    .optional(),
  typography: z
    .object({
      front_weight: z.number().optional(),
      front_tracking: z.string().optional(),
      back_weight: z.number().optional(),
      back_tracking: z.string().optional(),
    })
    .optional(),
  composition_rules: z.record(z.string(), z.unknown()).optional(),
  print_spec: z
    .object({
      method: z.string().optional(),
      separations: z.number().optional(),
      halftones: z.boolean().optional(),
      full_bleed: z.boolean().optional(),
    })
    .optional(),
});
export type CompositionMeta = z.infer<typeof compositionMetaSchema>;

// Tier + face enums as standalone schemas for tool-input validation
export const tierSchema = z.enum(["low", "medium", "high"]);
export type Tier = z.infer<typeof tierSchema>;

export const faceSchema = z.enum(["front", "back"]);
export type Face = z.infer<typeof faceSchema>;

// Palette role names used by the per-role color picker + set_color tool
export const paletteRoleNameSchema = z.enum([
  "garment_base",
  "ring_outer",
  "ring_inner",
  "front_ink",
  "back_ink",
]);
export type PaletteRoleName = z.infer<typeof paletteRoleNameSchema>;
