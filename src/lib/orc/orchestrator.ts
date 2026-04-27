import { eq } from "drizzle-orm";
import { db, agentOutputs, signals } from "@/db";
import { generateStructured } from "@/lib/ai/generate";
import { loadSkill } from "@/skills";
import { logAgentCall } from "@/lib/ai/logger";
import type { AgentKey } from "@/lib/ai/types";
import { getActiveJourney } from "@/lib/orc/journey";
import { getMemoryBackend } from "@/lib/orc/memory";

export interface RunSkillParams<TInput> {
  agentKey: AgentKey;
  orgId: string;
  signalId: string;
  input: TInput;
}

export interface RunSkillResult<TOutput> {
  output: TOutput;
  outputId: string;
  model: string;
  usage: { tokensInput: number; tokensOutput: number; totalTokens: number };
  durationMs: number;
}

/**
 * ORC's core operation — load a skill, run it via the LLM, persist the output.
 *
 * Called by Inngest functions (one per stage event) and by test scripts. The
 * per-stage Inngest function decides which skill to load based on the event
 * it's handling; the orchestrator itself is skill-agnostic.
 *
 * Steps:
 *   1. Load the skill from the registry (fails fast if not registered)
 *   2. Validate input via skill.inputSchema
 *   3. Build the prompt (static systemPrompt + dynamic buildPrompt(input))
 *   4. Call generateStructured — LLM routing from config_agents,
 *      agent_logs written automatically, output validated via skill.outputSchema
 *   5. Insert row into agent_outputs with status=PENDING (human gate)
 *   6. Return the output + its persisted id
 *
 * Downstream Inngest function receives this result and decides whether to
 * fire the next event directly (auto-advance) or wait for human approval.
 */
export async function runSkill<TInput, TOutput>(
  params: RunSkillParams<TInput>,
): Promise<RunSkillResult<TOutput>> {
  const { agentKey, orgId, signalId, input } = params;
  const skill = loadSkill<TInput, TOutput>(agentKey);

  // Phase 8 — resolve the signal's active journey up front. Every
  // per-signal artifact we produce (agent_output + agent_log rows)
  // tags to this journey so the workspace's stage views + future
  // observability queries can scope correctly. Throws if no active
  // journey exists, which indicates a data integrity issue (signal
  // created without its initial journey) that's worth failing on
  // rather than silently writing orphaned outputs.
  const journey = await getActiveJourney(signalId);

  // 1. Log skill load for observability
  void logAgentCall({
    orgId,
    signalId,
    journeyId: journey.id,
    agentName: agentKey,
    action: "skill_loaded",
    status: "success",
    metadata: { skillName: skill.name, description: skill.description },
  });

  // 2. Validate input
  const validatedInput = skill.inputSchema.parse(input);

  // 3. Build prompt + run LLM
  const result = await generateStructured<TOutput>({
    agentKey,
    orgId,
    signalId,
    system: skill.systemPrompt,
    prompt: skill.buildPrompt(validatedInput),
    schema: skill.outputSchema,
  });

  // 4. Persist output scoped to the active journey
  const [row] = await db
    .insert(agentOutputs)
    .values({
      signalId,
      journeyId: journey.id,
      agentName: agentKey,
      outputType: agentKey.toLowerCase(),
      content: result.object as object,
      status: "PENDING",
    })
    .returning({ id: agentOutputs.id });

  // 5. Log output write
  void logAgentCall({
    orgId,
    signalId,
    journeyId: journey.id,
    agentName: agentKey,
    action: "output_written",
    status: "success",
    metadata: { outputId: row.id, outputType: agentKey.toLowerCase() },
  });

  // 6. Memory write — Phase 8K stage-completion hook. Records that
  // this stage's output landed so ORC can later recall "show me how
  // BUNKER handled signals like this" or detect patterns across many
  // stage runs. Fire-and-forget by design (memory failures must not
  // break the pipeline). Wrapped in try/catch as a final safety net
  // even though the backend swallows its own errors — anything
  // unexpected here would otherwise propagate up and fail the
  // skill's Inngest function unnecessarily.
  try {
    const [signalRow] = await db
      .select({
        shortcode: signals.shortcode,
        workingTitle: signals.workingTitle,
      })
      .from(signals)
      .where(eq(signals.id, signalId))
      .limit(1);

    if (signalRow) {
      const memory = await getMemoryBackend();
      await memory.remember({
        orgId,
        container: "events",
        kind: "stage_completion",
        content:
          `Stage ${agentKey} produced output for signal ${signalRow.shortcode} ` +
          `"${signalRow.workingTitle}". Output id ${row.id} written with status PENDING ` +
          `(awaiting human gate before advancing).`,
        signalId,
        journeyId: journey.id,
        metadata: {
          stage: agentKey,
          shortcode: signalRow.shortcode,
          outputId: row.id,
          outputStatus: "PENDING",
        },
      });
    }
  } catch (err) {
    // Don't let a memory write failure surface as a skill failure.
    // The backend already swallows its own errors; this catch is the
    // safety net for anything else (e.g. signal lookup failure).
    console.error("[orchestrator] stage-completion memory write failed:", err);
  }

  return {
    output: result.object,
    outputId: row.id,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs,
  };
}
