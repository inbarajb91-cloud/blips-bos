import { inngest } from "../client";
import { runSkill } from "@/lib/orc/orchestrator";

/**
 * Pipeline stage-transition Inngest functions.
 *
 * Pattern — each stage has two functions:
 *   1. "<agent>.ready" handler — runs the skill via runSkill(),
 *      then fires "<agent>.complete" for human gate
 *   2. "<agent>.output.approved" handler — user approved the output;
 *      fire "<next-agent>.ready" to advance the pipeline
 *
 * Phase 5 ships the template — `stokerReady` as the exemplar. Other stages
 * are wired in their own phases (STOKER=9, FURNACE=10, BOILER=11, ENGINE=12).
 * Until each phase's skill is registered, the .ready handlers will throw at
 * `loadSkill` — that's by design; Phase 5 is infrastructure only.
 *
 * Inngest v4 takes trigger as part of the options object (via `triggers: [...]`),
 * not as a separate argument to createFunction.
 */

export const stokerReady = inngest.createFunction(
  {
    id: "stoker-ready",
    triggers: [{ event: "stoker.ready" }],
  },
  async ({ event, step }) => {
    const data = event.data as { orgId: string; signalId: string };
    const { orgId, signalId } = data;

    const result = await step.run("run-stoker-skill", async () => {
      return await runSkill({
        agentKey: "STOKER",
        orgId,
        signalId,
        input: { signalId }, // STOKER's input schema lands in Phase 9
      });
    });

    await step.sendEvent("fire-stoker-complete", {
      name: "stoker.complete",
      data: { orgId, signalId, outputId: result.outputId },
    });

    return { outputId: result.outputId };
  },
);

/**
 * Test function — validates the orchestrator end-to-end via the real Inngest
 * event bus (vs. scripts/test-orchestrator.ts which calls runSkill directly).
 * Used when we want to verify event delivery, durability, retries.
 */
export const testRun = inngest.createFunction(
  {
    id: "test-run",
    triggers: [{ event: "test.run" }],
  },
  async ({ event, step }) => {
    const data = event.data as {
      orgId: string;
      signalId: string;
      message: string;
    };
    const { orgId, signalId, message } = data;

    const result = await step.run("run-test-skill", async () => {
      return await runSkill({
        agentKey: "BUNKER",
        orgId,
        signalId,
        input: { message },
      });
    });

    return {
      outputId: result.outputId,
      model: result.model,
      tokens: result.usage.totalTokens,
    };
  },
);
