import { and, eq } from "drizzle-orm";
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
  // stage runs.
  //
  // TRULY fire-and-forget: we explicitly do NOT await the IIFE.
  // CodeRabbit on PR #5 caught that the previous shape still awaited
  // the signal lookup + memory.remember(), so a slow/hung memory
  // backend would extend every runSkill() invocation and could push
  // the enclosing Inngest step past its time budget.
  //
  // Tenant scoping (CR on PR #5): the lookup is scoped by BOTH
  // signalId AND orgId. A caller that ever passed a mismatched
  // {orgId, signalId} pair would otherwise have written a memory row
  // tagged under params.orgId carrying ANOTHER org's signal text —
  // a cross-tenant leak we close at the query boundary.
  //
  // Trade-off acknowledged: under serverless pressure a dangling
  // background promise inside an Inngest step may be cut short when
  // the step resolves. Acceptable here because (a) supermemory
  // writes typically complete in <500ms — well before the next step
  // starts — and (b) the cold-export job (8K+1) backstops dropped
  // writes for data sovereignty. If we ever need stronger delivery,
  // the right shape is a separate Inngest step, not an inline await.
  void (async () => {
    try {
      const [signalRow] = await db
        .select({
          shortcode: signals.shortcode,
          workingTitle: signals.workingTitle,
        })
        .from(signals)
        .where(and(eq(signals.id, signalId), eq(signals.orgId, orgId)))
        .limit(1);

      if (!signalRow) return;

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
    } catch (err) {
      // Final safety net — backend already swallows its own errors,
      // but a thrown signal lookup or auth-resolution failure would
      // otherwise reject the dangling promise unhandled.
      console.error(
        "[orchestrator] stage-completion memory write failed:",
        err,
      );
    }
  })();

  return {
    output: result.object,
    outputId: row.id,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs,
  };
}
