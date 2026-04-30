import { tool } from "ai";
import { z } from "zod";
import { restartStokerProcess } from "@/lib/actions/stoker";
import { getMemoryBackend } from "@/lib/orc/memory";
import type { OrcToolContext } from "./types";

/**
 * restart_stoker — Phase 9G mutation tool (intent-only).
 *
 * Records the founder's intent to restart STOKER on a parent signal
 * and returns the manual cleanup steps required to actually re-run.
 *
 * **Phase 9G is intent-only** — does not destructively re-run STOKER
 * itself. The (parent_signal_id, manifestation_decade) partial UNIQUE
 * means a real auto-restart would either (a) DELETE existing
 * manifestation children (destroys audit), or (b) require a schema
 * migration to add journey_id to the unique index. Both are out of
 * scope for 9G.
 *
 * The tool is still useful: it writes the intent to decision_history +
 * memory so cross-signal recall can later see "we wanted to restart
 * STOKER 3 times last quarter — usually after force-adding a missing
 * decade." The returned manualSteps walk the founder through the
 * dismiss-then-re-approve flow on Bridge.
 *
 * Same voice-level guard as the other side-effect tools.
 */

export function restartStoker(ctx: OrcToolContext) {
  return tool({
    description:
      "Record intent to restart STOKER on a parent signal. PHASE 9G LIMITATION: This does NOT actually re-run STOKER yet — it logs the intent and returns the manual cleanup steps the founder needs to take (dismiss existing manifestations, then re-approve the parent on Bridge). Auto-restart needs a schema migration that's out of scope for this phase. Only call after Inba has explicitly said in the current turn to restart STOKER.",
    inputSchema: z.object({
      parentSignalId: z
        .string()
        .uuid()
        .describe("The signal id of the PARENT signal whose STOKER pass should be restarted. If the user is currently viewing a manifestation, pass its parent_signal_id."),
      reason: z
        .string()
        .min(4)
        .max(500)
        .describe("Why restart — what was wrong with STOKER's first pass that re-running would fix."),
    }),
    execute: async ({ parentSignalId, reason }) => {
      const result = await restartStokerProcess({ parentSignalId, reason });

      // Memory write — record the restart intent for cross-signal
      // recall. The fact that auto-restart isn't wired is captured in
      // the metadata.intentOnly flag.
      const memory = await getMemoryBackend();
      await memory.remember({
        orgId: ctx.orgId,
        container: "events",
        kind: "decision",
        content:
          `Restart STOKER intent recorded for parent signal. Reason: ${reason}. ` +
          `Auto-restart not wired (Phase 9G is intent-only); founder follows manual steps to actually re-run.`,
        signalId: parentSignalId,
        journeyId: ctx.journeyId,
        metadata: {
          decision: "restart_stoker",
          intentOnly: true,
        },
      });

      return {
        success: true as const,
        message: result.message,
        manualSteps: result.manualSteps,
      };
    },
  });
}
