import { inngest } from "../client";

/**
 * Inngest functions.
 *
 * Phase 5 ships only the test function — pure event-bus plumbing check.
 * Real pipeline functions land phase-by-phase:
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
 * Event-bus ping test.
 *
 * Validates end-to-end: event firing → Inngest Cloud → Vercel function →
 * return value back to Inngest dashboard. No skill, no LLM, no DB — pure
 * plumbing check. Always succeeds.
 *
 * Fire from `scripts/fire-test-event.ts` (local) or Inngest dashboard
 * (Events → Send test event).
 */
export const testRun = inngest.createFunction(
  {
    id: "test-run",
    triggers: [{ event: "test.run" }],
  },
  async ({ event, step }) => {
    const data = event.data as { message: string };

    const echo = await step.run("echo", async () => ({
      received: data.message,
      echoed_at: new Date().toISOString(),
      env: process.env.NODE_ENV ?? "unknown",
      node_version: process.version,
    }));

    return echo;
  },
);
