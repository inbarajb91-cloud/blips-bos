/**
 * Phase 11D.3b — discard_version (BOILER v2).
 *
 * Soft-delete a design_versions row from the workspace history strip. The
 * row stays in the database (for audit + parent-chain integrity) but
 * `discarded = true` so the renderer hides it from the version strip.
 *
 * Pure DB write. No LLM, no Inngest.
 *
 * Guards:
 *   - Cannot discard the currently-active version (would orphan boiler_state).
 *     The founder must switch active first via branch_version or pick a sibling.
 *   - Cannot discard a finalized version (the canonical artwork is locked once
 *     it reaches finalize).
 */

import { tool } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { designVersions, boilerState } from "@/db/schema";
import type { OrcToolContext } from "./types";

export function boilerV2DiscardVersionTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Soft-delete a BOILER design version from the workspace history strip. The version stays in the DB for audit but is hidden from the UI. Cannot discard the currently-active version or a finalized version. Use when the founder says 'discard this' / 'remove version 1.2' / 'get rid of that one'. Call get_stage_output('BOILER') first if you need the version_id.",
    inputSchema: z.object({
      versionId: z
        .string()
        .uuid()
        .describe(
          "The design_versions row to soft-delete. Look up via get_stage_output('BOILER') if needed.",
        ),
    }),
    execute: async ({ versionId }) => {
      // Load the version + active state to validate guards
      const [version] = await db
        .select()
        .from(designVersions)
        .where(
          and(
            eq(designVersions.id, versionId),
            eq(designVersions.orgId, ctx.orgId),
            eq(designVersions.signalId, ctx.signalId),
          ),
        )
        .limit(1);
      if (!version) {
        return {
          success: false as const,
          message: `Version ${versionId} not found on this signal.`,
        };
      }
      if (version.discarded) {
        return {
          success: false as const,
          message: `Version ${versionId} is already discarded.`,
        };
      }

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
      if (state?.activeVersionId === versionId) {
        return {
          success: false as const,
          message: `Cannot discard the currently-active version. Switch active first (branch_version, finalize_design, or pick another) and then discard.`,
        };
      }
      if (state?.finalizedVersionId === versionId) {
        return {
          success: false as const,
          message: `Cannot discard the finalized version — it's locked as the canonical artwork.`,
        };
      }

      // Soft delete
      await db
        .update(designVersions)
        .set({
          discarded: true,
          discardedAt: new Date(),
        })
        .where(eq(designVersions.id, versionId));

      return {
        success: true as const,
        versionId,
        message: `Version ${versionId} discarded from the history strip.`,
      };
    },
  });
}
