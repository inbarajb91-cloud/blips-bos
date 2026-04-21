import { inngest } from "../client";
import { runSkill } from "@/lib/orc/orchestrator";

/**
 * Inngest functions.
 *
 * Phase 5 ships only the test function — it validates the event-bus →
 * orchestrator → DB pipeline end-to-end without committing to any specific
 * skill's shape. Real pipeline functions land phase-by-phase:
 *
 *   Phase 6:  bunkerCollectionScheduled (cron), bunkerCollectionOnDemand,
 *             bunkerCandidateApproved (human-gate → fires stoker.ready)
 *   Phase 9:  stokerReady → runSkill("STOKER") → fires stoker.complete
 *             stokerOutputApproved → fires furnace.ready
 *   Phase 10: furnaceReady + furnaceOutputApproved
 *   Phase 11: boilerReady + boilerConceptApproved
 *   Phase 12: engineReady + engineTechpackApproved
 *
 * Inngest v4 takes trigger as part of the options object (via `triggers: [...]`),
 * not as a separate argument to createFunction.
 */

/**
 * Test function — validates the orchestrator end-to-end via the real Inngest
 * event bus. Used to verify event delivery, durability, retries from the
 * `test.run` event. Requires a skill registered under agentKey "BUNKER" at
 * call time (test scripts register a mock inline before firing).
 *
 * In production once BUNKER is real (Phase 6), this function can stay as a
 * no-op smoke test OR be removed — its usefulness drops once real pipeline
 * functions exist.
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
