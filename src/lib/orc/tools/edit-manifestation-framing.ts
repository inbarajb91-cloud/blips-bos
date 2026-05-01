import { tool } from "ai";
import { z } from "zod";
import { editStokerManifestation } from "@/lib/actions/stoker";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * edit_manifestation_framing — Phase 9G mutation tool.
 *
 * Wraps `editStokerManifestation` so ORC can re-frame a manifestation's
 * hook / tension / angle when the founder asks. Past-gate edits
 * (manifestation already advanced into FURNACE / BOILER / ENGINE /
 * PROPELLER) require the `cascade` flag — otherwise the action throws.
 * ORC sets cascade=true when the user explicitly asks to edit a
 * manifestation that's past STOKER. Future stages will use the
 * revisions array's `cascade` flag to invalidate their own outputs.
 *
 * Same voice-level guard as approve_and_advance / dismiss: the system
 * prompt requires Inba's explicit word in the current turn before ORC
 * calls this. The runtime gate (allowMutation in route.ts) is the
 * defense-in-depth — the tool isn't bound unless the user said an
 * edit-intent word.
 */

export function editManifestationFraming(ctx: OrcToolContext) {
  return tool({
    description:
      "Edit a manifestation's framing (framingHook / tensionAxis / narrativeAngle). Pass at least one of the three fields. For past-gate manifestations (status not IN_STOKER), pass cascade=true. Only call after Inba has explicitly said in the current turn to edit it. Records each edit in the manifestation's revision history with a cascade flag for downstream stages.",
    inputSchema: z.object({
      manifestationSignalId: z
        .string()
        .uuid()
        .describe(
          "The signal id of the manifestation child to edit. Look it up via search_collection or get_full_signal_field if you don't have it.",
        ),
      framingHook: z
        .string()
        .min(10)
        .max(150)
        .optional()
        .describe(
          "New editorial one-liner. 10-150 chars. Decade-specific, present-tense, names the trap.",
        ),
      tensionAxis: z
        .string()
        .min(10)
        .max(200)
        .optional()
        .describe("New tension axis. 10-200 chars. The specific psychological tension this signal cuts at, in this decade."),
      narrativeAngle: z
        .string()
        .min(50)
        .max(800)
        .optional()
        .describe("New narrative angle. 50-800 chars. 2-3 sentences expanding the hook into the manifestation's core idea."),
      reason: z
        .string()
        .min(4)
        .max(500)
        .optional()
        .describe("Why the edit. Recorded in the revision history."),
      cascade: z
        .boolean()
        .optional()
        .describe(
          "Set true to allow editing past-gate manifestations (already in FURNACE+). Without this, the action throws on non-IN_STOKER status. Future stages use the cascade flag to invalidate their own outputs.",
        ),
    }),
    execute: async ({
      manifestationSignalId,
      framingHook,
      tensionAxis,
      narrativeAngle,
      reason,
      cascade,
    }) => {
      const fields: {
        framingHook?: string;
        tensionAxis?: string;
        narrativeAngle?: string;
      } = {};
      if (framingHook !== undefined) fields.framingHook = framingHook;
      if (tensionAxis !== undefined) fields.tensionAxis = tensionAxis;
      if (narrativeAngle !== undefined) fields.narrativeAngle = narrativeAngle;
      if (Object.keys(fields).length === 0) {
        return {
          success: false as const,
          message:
            "Provide at least one of framingHook, tensionAxis, or narrativeAngle to edit. No-op.",
        };
      }

      // The action enforces same-org via getCurrentUserWithOrg; ORC's
      // ctx.orgId scoping is enforced at the route level. We trust the
      // action's check here rather than re-checking on the tool side.
      const result = await editStokerManifestation({
        manifestationSignalId,
        fields,
        reason,
        cascade,
      });

      // Memory write — Phase 8K hook. Records the edit so future
      // recall calls can surface "we re-framed RCD manifestations away
      // from generic regret framings on April 30." The decade hint is
      // useful for cross-signal pattern recall.
      const [child] = await db
        .select({
          shortcode: signals.shortcode,
          decade: signals.manifestationDecade,
        })
        .from(signals)
        .where(
          and(
            eq(signals.id, manifestationSignalId),
            eq(signals.orgId, ctx.orgId),
          ),
        )
        .limit(1);

      if (child) {
        // Memory write is best-effort — supermemory is a hosted
        // dependency (transient outages happen) and the tool's
        // primary work (the edit) already succeeded. Swallow the
        // error rather than tearing the tool down. CR pass on PR #12
        // caught the unwrapped await — a memory hiccup would have
        // surfaced as a tool failure to ORC despite the edit landing.
        try {
          const memory = await getMemoryBackend();
          const fieldList = Object.keys(fields).join(", ");
          await memory.remember({
            orgId: ctx.orgId,
            container: "events",
            kind: "decision",
            content:
              `Edited manifestation ${child.shortcode} (${child.decade}) — fields: ${fieldList}. ` +
              (cascade ? "Past-gate edit with cascade. " : "Pre-gate edit. ") +
              `Reason: ${reason ?? "(no reason given)"}.`,
            signalId: manifestationSignalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "edit_manifestation_framing",
              shortcode: child.shortcode,
              decade: child.decade,
              cascade: cascade === true,
            },
          });
        } catch (err) {
          console.warn(
            "[edit_manifestation_framing] memory write failed (best-effort, continuing):",
            err,
          );
        }
      }

      return {
        success: true as const,
        revisionsCount: result.revisionsCount,
        message: `Manifestation framing updated. Revision ${result.revisionsCount} recorded.${cascade ? " Cascade flag set — downstream stages will see this as past-gate." : ""}`,
      };
    },
  });
}
