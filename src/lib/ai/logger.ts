import { db, agentLogs } from "@/db";
import type { AgentCallMetadata } from "./types";
import { computeCost } from "./pricing";

/**
 * Write a row to `agent_logs`.
 *
 * Fire-and-forget: log writes never block the caller or cause the LLM call
 * to fail. Errors are logged to console. In production we may route these
 * to an external observability service, but the DB row is always the source
 * of truth for token/cost accounting.
 */
export async function logAgentCall(
  m: AgentCallMetadata & { cachedTokens?: number },
): Promise<void> {
  const costUsd =
    m.costUsd ??
    (m.model && m.tokensInput !== undefined && m.tokensOutput !== undefined
      ? computeCost(
          m.model,
          m.tokensInput,
          m.tokensOutput,
          m.cachedTokens ?? 0,
        )
      : undefined);

  try {
    await db.insert(agentLogs).values({
      orgId: m.orgId,
      signalId: m.signalId ?? null,
      // Phase 8 — nullable journey_id on agent_logs. Callers that
      // operate within a journey (orchestrator runSkill, ORC replies)
      // pass it through; cron/pre-signal callers leave it unset.
      journeyId: m.journeyId ?? null,
      agentName: m.agentName,
      action: m.action,
      model: m.model ?? null,
      tokensInput: m.tokensInput ?? null,
      tokensOutput: m.tokensOutput ?? null,
      costUsd: costUsd !== undefined ? costUsd.toString() : null,
      durationMs: m.durationMs ?? null,
      status: m.status,
      errorMessage: m.errorMessage ?? null,
      metadata: m.metadata ?? null,
    });
  } catch (e) {
    // Logging must never crash the caller. Surface via console and move on.
    console.error("[agent_logs] write failed:", (e as Error).message);
  }
}
