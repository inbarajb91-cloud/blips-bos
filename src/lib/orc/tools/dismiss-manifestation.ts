import { tool } from "ai";
import { z } from "zod";
import { dismissStokerManifestation } from "@/lib/actions/stoker";
import { getMemoryBackend } from "@/lib/orc/memory";
import { db, signals } from "@/db";
import { and, eq } from "drizzle-orm";
import type { OrcToolContext } from "./types";

/**
 * dismiss_manifestation — Phase 9G mutation tool.
 *
 * Wraps `dismissStokerManifestation` so ORC can dismiss a specific
 * decade manifestation when the founder asks. Differs from the
 * generic `dismiss` tool (which dismisses the whole signal):
 * dismiss_manifestation operates on a child manifestation only.
 *
 * Past-gate dismissals (manifestation in FURNACE / BOILER / ENGINE /
 * PROPELLER) require the `cascade` flag. The action will throw on
 * non-IN_STOKER status without it. ORC sets cascade=true when the
 * user explicitly asks to dismiss a manifestation that's past STOKER.
 *
 * Same voice-level guard as the other side-effect tools.
 */

export function dismissManifestation(ctx: OrcToolContext) {
  return tool({
    description:
      "Dismiss a specific decade manifestation. For manifestations past STOKER (status not IN_STOKER), pass cascade=true. Only call after Inba has explicitly said in the current turn to dismiss it. Use this — not the plain dismiss() — when the user wants to drop one decade-card while keeping the rest.",
    inputSchema: z.object({
      manifestationSignalId: z
        .string()
        .uuid()
        .describe(
          "The signal id of the manifestation child to dismiss. Look it up via search_collection or get_full_signal_field if you don't have it.",
        ),
      reason: z
        .string()
        .min(4)
        .max(500)
        .describe(
          "Short reason for dismissing — why this manifestation doesn't merit pipeline work. Recorded in the audit trail.",
        ),
      cascade: z
        .boolean()
        .optional()
        .describe(
          "Set true to dismiss past-gate manifestations (already in FURNACE+). Without this, the action throws on non-IN_STOKER status.",
        ),
    }),
    execute: async ({ manifestationSignalId, reason, cascade }) => {
      const result = await dismissStokerManifestation({
        manifestationSignalId,
        reason,
        cascade,
      });

      // Memory write — same pattern as edit. Records the dismissal so
      // ORC can later see "we dismiss RCK manifestations on signals
      // about caretaking 70% of the time" — useful pattern recall.
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
        // Best-effort memory write — see edit_manifestation_framing
        // for rationale. Action already succeeded; transient
        // supermemory errors must not surface as tool failures.
        try {
          const memory = await getMemoryBackend();
          await memory.remember({
            orgId: ctx.orgId,
            container: "events",
            kind: "decision",
            content:
              `Dismissed manifestation ${child.shortcode} (${child.decade}). ` +
              (cascade ? "Past-gate dismissal with cascade. " : "Pre-gate dismissal. ") +
              `Reason: ${reason}.`,
            signalId: manifestationSignalId,
            journeyId: ctx.journeyId,
            metadata: {
              decision: "dismiss_manifestation",
              shortcode: child.shortcode,
              decade: child.decade,
              cascade: cascade === true,
            },
          });
        } catch (err) {
          console.warn(
            "[dismiss_manifestation] memory write failed (best-effort, continuing):",
            err,
          );
        }
      }

      return {
        success: true as const,
        childShortcode: result.childShortcode,
        message: `Manifestation ${result.childShortcode} dismissed.${cascade ? " Past-gate dismissal — cascade flag set." : ""}`,
      };
    },
  });
}
