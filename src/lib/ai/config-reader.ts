import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db, configAgents } from "@/db";
import type { AgentKey } from "./types";

export interface AgentConfig {
  model: string;
  /**
   * Ordered list of model IDs to try, primary first. When one fails with a
   * transient error (rate limit, overload, schema mismatch), generateStructured
   * tries the next. If undefined, falls back to [model] as a single-element chain.
   */
  modelFallbackChain: string[];
  temperature: number;
  extras: Record<string, unknown>;
}

/**
 * Read a single config_agents row.
 */
async function readKey<T = unknown>(
  orgId: string,
  agentKey: AgentKey,
  key: string,
): Promise<T | undefined> {
  const [row] = await db
    .select({ value: configAgents.value })
    .from(configAgents)
    .where(
      and(
        eq(configAgents.orgId, orgId),
        eq(configAgents.agentName, agentKey),
        eq(configAgents.key, key),
      ),
    );
  return row?.value as T | undefined;
}

/**
 * Read all config for an agent and return a normalized shape.
 * Deduped within a single request via React.cache so multiple LLM calls
 * in one action don't hit the DB repeatedly.
 */
export const getAgentConfig = cache(
  async (orgId: string, agentKey: AgentKey): Promise<AgentConfig> => {
    const rows = await db
      .select({ key: configAgents.key, value: configAgents.value })
      .from(configAgents)
      .where(
        and(
          eq(configAgents.orgId, orgId),
          eq(configAgents.agentName, agentKey),
        ),
      );

    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;

    const model = (map.model as string) ?? "gemini-2.5-flash";
    const temperature =
      typeof map.temperature === "number" ? map.temperature : 0.3;

    const rawChain = map.model_fallback_chain;
    const modelFallbackChain = Array.isArray(rawChain) && rawChain.length > 0
      ? (rawChain as string[])
      : [model]; // backward-compat: single model = single-element chain

    const extras: Record<string, unknown> = { ...map };
    delete extras.model;
    delete extras.temperature;
    delete extras.model_fallback_chain;

    return { model, modelFallbackChain, temperature, extras };
  },
);

export { readKey };
