import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db, configAgents } from "@/db";
import type { AgentKey } from "./types";

export interface AgentConfig {
  model: string;
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

    const extras: Record<string, unknown> = { ...map };
    delete extras.model;
    delete extras.temperature;

    return { model, temperature, extras };
  },
);

export { readKey };
