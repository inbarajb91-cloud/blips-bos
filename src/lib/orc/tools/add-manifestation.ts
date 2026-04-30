import { tool } from "ai";
import { z } from "zod";
import { addStokerManifestation } from "@/lib/actions/stoker";
import { getMemoryBackend } from "@/lib/orc/memory";
import type { OrcToolContext } from "./types";

/**
 * add_manifestation — Phase 9G mutation tool.
 *
 * Force-adds a manifestation for a decade STOKER refused or missed.
 * Use case: STOKER scored RCD at 32 and refused to produce a
 * manifestation, but the founder thinks the signal IS RCD-coded with
 * a specific angle STOKER missed. ORC calls this with the founder's
 * provided framing.
 *
 * The created child signal lands at status IN_STOKER with PENDING
 * agent_outputs — even force-added manifestations need explicit
 * per-card founder approval before advancing to FURNACE. The
 * agent_outputs row carries `forceAdded: true` so the renderer can
 * surface "founder force-added — STOKER did not generate this."
 *
 * Validates parent: must be in same org, must be a parent (not itself
 * a manifestation), must be post-STOKER (FANNED_OUT or STOKER_REFUSED),
 * and the requested decade must not already have a child manifestation.
 *
 * Same voice-level guard. Force-add is an authoring action — ORC
 * must have specific framing fields from Inba in the current turn,
 * not synthesised on its own.
 */

export function addManifestation(ctx: OrcToolContext) {
  return tool({
    description:
      "Force-add a manifestation for a decade STOKER refused (no manifestation produced for that decade). Requires the founder's framing fields — don't synthesise on your own. Validates that the parent has run through STOKER and the decade isn't already taken. Created manifestation lands at IN_STOKER for explicit per-card approval. Only call after Inba has explicitly said in the current turn to force-add this decade.",
    inputSchema: z.object({
      parentSignalId: z
        .string()
        .uuid()
        .describe(
          "The signal id of the PARENT signal (not a manifestation child). If the user is currently viewing a manifestation, pass its parent_signal_id instead.",
        ),
      decade: z
        .enum(["RCK", "RCL", "RCD"])
        .describe("Which decade to add a manifestation for. Must not already have a child manifestation."),
      framingHook: z
        .string()
        .min(10)
        .max(150)
        .describe("Editorial one-liner. 10-150 chars. Decade-specific, present-tense, names the trap."),
      tensionAxis: z
        .string()
        .min(10)
        .max(200)
        .describe("The specific psychological tension this signal cuts at, in this decade."),
      narrativeAngle: z
        .string()
        .min(50)
        .max(800)
        .describe("2-3 sentences expanding the hook into the manifestation's core idea."),
      reason: z
        .string()
        .min(4)
        .max(500)
        .describe("Why STOKER missed this — what about the signal makes the decade resonate that the original pass didn't see."),
    }),
    execute: async ({
      parentSignalId,
      decade,
      framingHook,
      tensionAxis,
      narrativeAngle,
      reason,
    }) => {
      const result = await addStokerManifestation({
        parentSignalId,
        decade,
        framingHook,
        tensionAxis,
        narrativeAngle,
        reason,
      });

      // Memory write — pattern recall: "we force-added RCD on
      // caretaking signals 4 times last quarter — STOKER may need
      // playbook tuning for that decade." High-signal data for the
      // founder.
      const memory = await getMemoryBackend();
      await memory.remember({
        orgId: ctx.orgId,
        container: "events",
        kind: "decision",
        content:
          `Force-added ${decade} manifestation on parent (created child ${result.childShortcode}). ` +
          `Hook: "${framingHook}". ` +
          `Reason STOKER missed it: ${reason}.`,
        signalId: parentSignalId,
        journeyId: ctx.journeyId,
        metadata: {
          decision: "add_manifestation",
          decade,
          childShortcode: result.childShortcode,
          forceAdded: true,
        },
      });

      return {
        success: true as const,
        childShortcode: result.childShortcode,
        childSignalId: result.childSignalId,
        decade,
        message: `Force-added ${decade} manifestation as ${result.childShortcode}. Awaiting per-card approval at the parent's STOKER tab — same gate as STOKER-generated manifestations.`,
      };
    },
  });
}
