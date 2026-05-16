/**
 * Phase 11D.3b — set_color (BOILER v2).
 *
 * Update one palette role on the current boiler_state. Doesn't trigger a
 * regeneration on its own — the SVG renderer can preview the swap immediately
 * (live colorway preview), and the next generate/refine call uses the
 * updated palette automatically.
 *
 * Mirrors the workspace's per-role color picker (clicking a chip and changing
 * the hex). ORC's tool exists so the founder can also say:
 *   "darker on the garment, almost burgundy" → set_color(garment_base, #4A1A1A)
 *   "swap front ink to bone white"            → set_color(front_ink, #F2EFE9)
 *
 * Pure DB write. No LLM, no Inngest. Returns the new palette + ack.
 */

import { tool } from "ai";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { boilerState } from "@/db/schema";
import { paletteRoleNameSchema, type PaletteRoleName } from "@/db/zod";
import { z } from "zod";
import type { OrcToolContext } from "./types";

export function boilerV2SetColorTool(ctx: OrcToolContext) {
  return tool({
    description:
      "Update one palette role on the current BOILER design state. Roles: garment_base, ring_outer, ring_inner, front_ink, back_ink. Takes effect on the next generate/refine call — does NOT trigger regeneration on its own. Call this when the founder describes a color change in natural language (e.g. 'darker garment, almost burgundy' → set_color(garment_base, #4A1A1A)). Use 6-digit hex with leading #.",
    inputSchema: z.object({
      role: paletteRoleNameSchema.describe(
        "Which palette role to update.",
      ),
      hex: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/u)
        .describe(
          "6-digit hex with leading #. Examples: #4A1A1A (burgundy), #F2EFE9 (bone white), #2E3A47 (slate).",
        ),
    }),
    execute: async ({ role, hex }: { role: PaletteRoleName; hex: string }) => {
      // Update the active_palette_roles jsonb in place — merge the new
      // (role, hex) into the existing object. UPSERT pattern so a missing
      // boiler_state row is created on first set_color call.
      const [existing] = await db
        .select()
        .from(boilerState)
        .where(
          and(
            eq(boilerState.orgId, ctx.orgId),
            eq(boilerState.signalId, ctx.signalId),
            eq(boilerState.journeyId, ctx.journeyId),
          ),
        )
        .limit(1);

      const existingPalette = (existing?.activePaletteRoles ?? {}) as Record<
        string,
        string
      >;
      const newPalette = { ...existingPalette, [role]: hex };

      if (existing) {
        await db
          .update(boilerState)
          .set({
            activePaletteRoles: newPalette,
            ...(role === "garment_base" && { activeGarmentHex: hex }),
            updatedAt: sql`NOW()`,
          })
          .where(eq(boilerState.id, existing.id));
      } else {
        await db.insert(boilerState).values({
          orgId: ctx.orgId,
          signalId: ctx.signalId,
          journeyId: ctx.journeyId,
          activePaletteRoles: newPalette,
          activeGarmentHex: role === "garment_base" ? hex : null,
        });
      }

      return {
        success: true as const,
        role,
        hex,
        message: `Set ${role} to ${hex}. Will apply on the next generate/refine call.`,
        newPalette,
      };
    },
  });
}
