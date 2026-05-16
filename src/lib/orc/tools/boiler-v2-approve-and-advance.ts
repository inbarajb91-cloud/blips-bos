/**
 * Phase 11D.3b — boiler_v2_approve_and_advance.
 *
 * Commit the finalized BOILER design and advance the journey to ENGINE Step 1.
 *
 * Preconditions (validated server-side; tool refuses if not met):
 *   - boiler_state.finalized_version_id is set (founder ran finalize_design first)
 *   - The finalized version exists and isn't discarded
 *   - The finalized version's verifier passed (or founder explicitly bypassed
 *     via a recorded "ship it anyway" decision — Phase 12 concern)
 *
 * Side effects (one transaction):
 *   - boiler_state.finalized = true, finalized_at = now()
 *   - signals.status = IN_ENGINE
 *   - agent_outputs row (BOILER skill) updated to status=APPROVED so the
 *     existing pipeline-status logic recognizes BOILER as done
 *   - decision_history row recording the approval
 *   - engine.ready event fired (Phase 12 picks it up when ready)
 *
 * Pure DB write + event fire. Gated by allowMutation in the tools index.
 */

import { tool } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  designVersions,
  boilerState,
  signals as signalsTable,
  decisionHistory,
} from "@/db/schema";
import { inngest } from "@/lib/inngest/client";
import { getMemoryBackend } from "@/lib/orc/memory";
import type { OrcToolContext } from "./types";

export function boilerV2ApproveAndAdvanceTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Commit the finalized BOILER design and advance the journey from IN_BOILER to IN_ENGINE. Requires that finalize_design has already run and produced a finalized version. Only call when the founder has EXPLICITLY said approve / commit / ship / go-to-engine in the current turn. Returns refusal with explanation if the preconditions aren't met.",
    inputSchema: z.object({
      // No inputs — the active state is fully implied by the bound context.
      // Keeping the field for AI SDK compatibility (tools without args still
      // need the schema present).
      _confirm: z
        .boolean()
        .default(true)
        .describe(
          "Always true. AI SDK requires a non-empty schema for tools.",
        ),
    }),
    execute: async () => {
      // ─── Load state + validate preconditions ──────────────────────
      const [state] = await db
        .select()
        .from(boilerState)
        .where(
          and(
            eq(boilerState.signalId, ctx.signalId),
            eq(boilerState.journeyId, ctx.journeyId),
          ),
        )
        .limit(1);

      if (!state || !state.finalizedVersionId) {
        return {
          success: false as const,
          message:
            "No finalized version yet. Run finalize_design first (re-runs the active design at High tier to produce the canonical artwork), then approve.",
        };
      }
      if (state.finalized) {
        return {
          success: false as const,
          message: "This BOILER state is already approved + advanced.",
        };
      }

      const [finalizedVersion] = await db
        .select()
        .from(designVersions)
        .where(
          and(
            eq(designVersions.id, state.finalizedVersionId),
            eq(designVersions.orgId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!finalizedVersion || finalizedVersion.discarded) {
        return {
          success: false as const,
          message:
            "Finalized version is missing or discarded. Re-run finalize_design and try again.",
        };
      }

      // ─── Commit transaction ───────────────────────────────────────
      await db.transaction(async (tx) => {
        await tx
          .update(boilerState)
          .set({
            finalized: true,
            finalizedAt: new Date(),
          })
          .where(eq(boilerState.id, state.id));

        await tx
          .update(signalsTable)
          .set({ status: "IN_ENGINE", updatedAt: new Date() })
          .where(eq(signalsTable.id, ctx.signalId));

        await tx.insert(decisionHistory).values({
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          agentName: "BOILER",
          decision: "boiler_v2_approved",
          reason: `Approved finalized design ${finalizedVersion.id} (tier=${finalizedVersion.tier}). Advancing to ENGINE Step 1.`,
          decidedBy: ctx.userId,
        });
      });

      // Fire engine.ready — Phase 12 ENGINE handler picks it up when shipped.
      try {
        await inngest.send({
          name: "engine.ready",
          data: {
            orgId: ctx.orgId,
            signalId: ctx.signalId,
          },
        });
      } catch (err) {
        console.warn(
          "[boiler_v2_approve_and_advance] inngest.send engine.ready failed (state still IN_ENGINE in DB):",
          err,
        );
      }

      // Best-effort memory write — Tier 3 events container records the
      // approval so cross-signal recall can learn approval patterns.
      try {
        const memory = await getMemoryBackend();
        await memory.remember({
          orgId: ctx.orgId,
          container: "events",
          kind: "decision",
          content: `Approved BOILER v2 design ${finalizedVersion.id} (tier=${finalizedVersion.tier}). Advancing to ENGINE Step 1.`,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          metadata: {
            decision: "boiler_v2_approve_and_advance",
            versionId: finalizedVersion.id,
            tier: finalizedVersion.tier,
          },
        });
      } catch (err) {
        console.warn(
          "[boiler_v2_approve_and_advance] memory write failed (best-effort):",
          err,
        );
      }

      return {
        success: true as const,
        finalizedVersionId: finalizedVersion.id,
        message: `Design ${finalizedVersion.id} approved → signal advancing to ENGINE Step 1 (product spec).`,
      };
    },
  });
}
