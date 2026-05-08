"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, configAgents } from "@/db";
import { requireFounder } from "@/lib/auth/require-founder";
import { AGENT_KEYS, type AgentKey } from "@/lib/ai/types";
import { resolveProvider } from "@/lib/ai/providers";

/**
 * Server actions for the agent-models settings UI — Phase 3.5.
 *
 * Reads / writes config_agents rows. requireFounder()-gated. Same
 * "config-driven LLM routing" promise from Phase 3, now with a
 * founder-facing affordance to swap models per agent + bulk-apply.
 *
 * Validation philosophy:
 *   - Model strings are validated by `resolveProvider()` before write —
 *     unknown providers / unrecognized prefixes get a clear error
 *     instead of being saved and breaking every call.
 *   - Temperature is bounded 0-2 (Vercel AI SDK accepts higher but
 *     anything > 1.5 is generally noise).
 *   - Fallback chains must contain at least one model + each entry
 *     must validate via resolveProvider().
 *   - All writes happen in a single transaction per agent so a
 *     partial save can't leave (model, fallback chain) inconsistent.
 *
 * No supermemory sync — config_agents is purely operational, not
 * something ORC needs to recall about itself.
 */

// ─── Types ────────────────────────────────────────────────────────

export interface AgentConfigSummary {
  agentName: AgentKey;
  /** Currently-configured primary model. Always present (seed enforces). */
  model: string;
  temperature: number;
  /** Ordered fallback chain. First entry duplicates `model` by convention. */
  modelFallbackChain: string[];
  /** Provider id resolved from `model`. Null if model is unrecognized
   *  (e.g. someone manually edited the DB to an invalid string). */
  provider: string | null;
  /** Whether all fallback entries resolve to valid providers. UI can
   *  flag misconfigured agents at a glance. */
  fallbackChainValid: boolean;
}

// ─── Read ─────────────────────────────────────────────────────────

/**
 * Read all agents' configurations. Returns a row per agent (7 rows for
 * the current pipeline: ORC + 6 stages). Founder-only; non-founder
 * callers throw before reading any data.
 */
export async function listAgentConfigs(): Promise<AgentConfigSummary[]> {
  const user = await requireFounder();

  const rows = await db
    .select()
    .from(configAgents)
    .where(eq(configAgents.orgId, user.orgId));

  // Group rows by agent_name + key.
  type ConfigMap = Record<string, Record<string, unknown>>;
  const byAgent: ConfigMap = {};
  for (const r of rows) {
    if (!byAgent[r.agentName]) byAgent[r.agentName] = {};
    byAgent[r.agentName][r.key] = r.value as unknown;
  }

  return AGENT_KEYS.map<AgentConfigSummary>((agentName) => {
    const cfg = byAgent[agentName] ?? {};
    const model = (cfg.model as string) ?? "";
    const temperature =
      typeof cfg.temperature === "number" ? cfg.temperature : 0.5;
    const fallbackChain = Array.isArray(cfg.model_fallback_chain)
      ? (cfg.model_fallback_chain as string[])
      : [model].filter(Boolean);
    const resolved = model ? resolveProvider(model) : null;
    const fallbackChainValid = fallbackChain.every(
      (id) => id.length > 0 && resolveProvider(id) !== null,
    );
    return {
      agentName,
      model,
      temperature,
      modelFallbackChain: fallbackChain,
      provider: resolved?.provider.id ?? null,
      fallbackChainValid,
    };
  });
}

// ─── Write — single agent ─────────────────────────────────────────

interface UpdateAgentConfigInput {
  agentName: AgentKey;
  model: string;
  temperature: number;
  modelFallbackChain: string[];
}

/**
 * Update a single agent's config. Writes three rows (model,
 * temperature, model_fallback_chain) in one transaction so a save
 * either lands fully or not at all.
 *
 * Validates every model string via the provider registry before any
 * write — unknown models throw with a clear message rather than
 * silently saving + then crashing every subsequent call.
 */
export async function updateAgentConfig(
  input: UpdateAgentConfigInput,
): Promise<{ ok: true }> {
  const user = await requireFounder();

  if (!AGENT_KEYS.includes(input.agentName)) {
    throw new Error(`Unknown agent: ${input.agentName}`);
  }
  validateModelString(input.model);
  if (input.temperature < 0 || input.temperature > 2) {
    throw new Error("Temperature must be between 0 and 2.");
  }
  if (!Array.isArray(input.modelFallbackChain) || input.modelFallbackChain.length === 0) {
    throw new Error("Model fallback chain must contain at least one entry.");
  }
  for (const id of input.modelFallbackChain) {
    validateModelString(id);
  }

  await db.transaction(async (tx) => {
    await upsertConfig(tx, user.orgId, input.agentName, "model", input.model);
    await upsertConfig(
      tx,
      user.orgId,
      input.agentName,
      "temperature",
      input.temperature,
    );
    await upsertConfig(
      tx,
      user.orgId,
      input.agentName,
      "model_fallback_chain",
      input.modelFallbackChain,
    );
  });

  revalidatePath("/engine-room/settings/agents");
  revalidatePath("/engine-room/agents");

  return { ok: true };
}

// ─── Write — bulk apply across all agents ─────────────────────────

interface BulkApplyInput {
  /** New primary model — applied to every agent. */
  model: string;
  /**
   * If true, also rewrites each agent's fallback chain to a sensible
   * default: [model, ...rest-of-existing-chain-minus-this-model]. So
   * the chosen model becomes primary while the existing chain serves
   * as the safety net. Default true.
   */
  rewriteFallbackChain?: boolean;
  /**
   * Optional temperature override applied to every agent. If omitted,
   * each agent keeps its current temperature.
   */
  temperature?: number;
}

/**
 * Apply a single model to every agent — the "swap everything to model
 * X" affordance. Useful for testing a new model across the whole
 * pipeline without 7 individual save clicks.
 */
export async function bulkApplyModel(
  input: BulkApplyInput,
): Promise<{ ok: true; updated: AgentKey[] }> {
  const user = await requireFounder();

  validateModelString(input.model);
  if (input.temperature !== undefined && (input.temperature < 0 || input.temperature > 2)) {
    throw new Error("Temperature must be between 0 and 2.");
  }
  const rewriteFallbackChain = input.rewriteFallbackChain !== false;

  // Read current configs first so we can preserve fallback chains
  // when not rewriting.
  const current = await listAgentConfigs();

  await db.transaction(async (tx) => {
    for (const agent of current) {
      await upsertConfig(tx, user.orgId, agent.agentName, "model", input.model);
      if (input.temperature !== undefined) {
        await upsertConfig(
          tx,
          user.orgId,
          agent.agentName,
          "temperature",
          input.temperature,
        );
      }
      if (rewriteFallbackChain) {
        // New chain: [bulk-applied model] + existing chain without
        // duplicates. Preserves the agent's safety net while making
        // the new model primary.
        const restOfChain = agent.modelFallbackChain.filter(
          (id) => id !== input.model,
        );
        const newChain = [input.model, ...restOfChain];
        await upsertConfig(
          tx,
          user.orgId,
          agent.agentName,
          "model_fallback_chain",
          newChain,
        );
      }
    }
  });

  revalidatePath("/engine-room/settings/agents");
  revalidatePath("/engine-room/agents");

  return { ok: true, updated: current.map((a) => a.agentName) };
}

// ─── Probe — health-check a model string before saving ────────────

interface ProbeResult {
  modelId: string;
  ok: boolean;
  durationMs: number;
  errorMessage?: string;
  /** How the provider was resolved (anthropic / google / openai-compatible / etc.) */
  resolvedProvider?: string;
}

/**
 * Probe a model string by sending a minimal generateText call. Used by
 * the Settings UI's "Test" button to confirm a model is valid + the
 * right env keys are set, without making the founder save first and
 * then watch every agent fail.
 */
export async function probeModel(modelId: string): Promise<ProbeResult> {
  await requireFounder();

  const start = Date.now();
  let resolvedProvider: string | undefined;
  try {
    validateModelString(modelId);
    const resolved = resolveProvider(modelId);
    resolvedProvider = resolved?.provider.id;

    // Lazy-import the AI SDK + router so this server action stays
    // light when the form just renders (no probe yet).
    const { getModel } = await import("@/lib/ai/model-router");
    const { generateText } = await import("ai");
    await generateText({
      model: getModel(modelId),
      prompt: "Reply with the single word OK.",
      maxOutputTokens: 4,
      temperature: 0.0,
    });
    return {
      modelId,
      ok: true,
      durationMs: Date.now() - start,
      resolvedProvider,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      modelId,
      ok: false,
      durationMs: Date.now() - start,
      errorMessage: err.message,
      resolvedProvider,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function validateModelString(modelId: string): void {
  if (!modelId || typeof modelId !== "string") {
    throw new Error("Model id must be a non-empty string.");
  }
  if (resolveProvider(modelId) === null) {
    throw new Error(
      `Unknown model "${modelId}". Use a provider-prefixed form (e.g. "openai/gpt-4o", "openrouter/moonshotai/kimi-k2") or a known bare id ("gemini-2.5-pro", "claude-sonnet-4.7"). Add new providers to src/lib/ai/providers.ts.`,
    );
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Insert-or-update a single config_agents row. Uses an explicit
 * conflict target (org_id, agent_name, key) since that's the unique
 * index we have. JSONB-encoded value goes in as-is.
 */
async function upsertConfig(
  tx: Tx,
  orgId: string,
  agentName: AgentKey,
  key: string,
  value: unknown,
): Promise<void> {
  // Check if exists
  const [existing] = await tx
    .select({ id: configAgents.id })
    .from(configAgents)
    .where(
      and(
        eq(configAgents.orgId, orgId),
        eq(configAgents.agentName, agentName),
        eq(configAgents.key, key),
      ),
    )
    .limit(1);

  if (existing) {
    await tx
      .update(configAgents)
      .set({
        value: value as never,
        updatedAt: new Date(),
      })
      .where(eq(configAgents.id, existing.id));
  } else {
    await tx.insert(configAgents).values({
      orgId,
      agentName,
      key,
      value: value as never,
    });
  }
}
