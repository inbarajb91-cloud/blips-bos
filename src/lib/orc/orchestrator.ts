import { db, agentOutputs } from "@/db";
import { generateStructured } from "@/lib/ai/generate";
import { loadSkill } from "@/skills";
import { logAgentCall } from "@/lib/ai/logger";
import type { AgentKey } from "@/lib/ai/types";

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

  // 1. Log skill load for observability
  void logAgentCall({
    orgId,
    signalId,
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

  // 4. Persist output
  const [row] = await db
    .insert(agentOutputs)
    .values({
      signalId,
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
    agentName: agentKey,
    action: "output_written",
    status: "success",
    metadata: { outputId: row.id, outputType: agentKey.toLowerCase() },
  });

  return {
    output: result.object,
    outputId: row.id,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs,
  };
}
