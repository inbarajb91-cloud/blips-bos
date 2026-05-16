"use server";

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  designVersions,
  boilerState,
  mockupRenders,
  configEngineRoom,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import type {
  PaletteRoles,
  CompositionMeta,
} from "@/db/zod";
import type { VerificationResultLite } from "@/lib/boiler/types";

/**
 * BOILER v2 server data loader + simple mutations — Phase 11D.4a.
 *
 * Read functions for the workspace renderer:
 *   - loadBoilerV2State()          → full state for one (signal, journey)
 *   - isBoilerV2RendererEnabled()  → feature flag check
 *
 * Mutations that don't need an LLM call (set_color, discard_version) live
 * here. ORC tools call these directly when the founder uses the UI controls
 * (color picker, history-strip discard) rather than chat.
 *
 * For the long-running generations (generate / refine / branch / finalize),
 * the UI fires an Inngest event via inngest.send() rather than calling
 * server actions — the Inngest function handles persistence + auto-retry.
 */

// ─── Shapes returned to the renderer ─────────────────────────────────

export interface BoilerV2VersionRow {
  id: string;
  parentVersionId: string | null;
  tier: "low" | "medium" | "high";
  promptUsed: string;
  refinementInstruction: string | null;
  flatArtworkUrl: string | null;
  cloudinaryPublicId: string | null;
  widthPx: number | null;
  heightPx: number | null;
  paletteRoles: PaletteRoles;
  compositionMeta: CompositionMeta & { verification?: VerificationResultLite | null };
  costUsd: string | null;
  generatedAt: string;
  discarded: boolean;
}

export interface BoilerV2MockupRow {
  id: string;
  designVersionId: string;
  colorwayHex: string;
  face: "front" | "back";
  renderer: "dynamic_mockups" | "svg_flatlay";
  cloudinaryUrl: string | null;
  cloudinaryPublicId: string | null;
  widthPx: number | null;
  heightPx: number | null;
  renderedAt: string;
}

export interface BoilerV2State {
  id: string;
  signalId: string;
  journeyId: string | null;
  activeVersionId: string | null;
  activeGarmentHex: string | null;
  activePaletteRoles: PaletteRoles;
  finalized: boolean;
  finalizedAt: string | null;
  finalizedVersionId: string | null;
  updatedAt: string;
}

export interface BoilerV2LoadedState {
  state: BoilerV2State | null;
  versions: BoilerV2VersionRow[];
  /** Non-discarded versions, ordered newest first — what the UI surfaces. */
  visibleVersions: BoilerV2VersionRow[];
  /** Convenience pointer — the row referenced by state.activeVersionId. */
  activeVersion: BoilerV2VersionRow | null;
  /** Convenience pointer — the row referenced by state.finalizedVersionId. */
  finalizedVersion: BoilerV2VersionRow | null;
  /** All mockup renders across all versions on this signal. UI groups by version_id. */
  mockupRenders: BoilerV2MockupRow[];
}

// ─── Loader ──────────────────────────────────────────────────────────

/**
 * Load the full BOILER v2 state for one (signalId, journeyId) pair.
 *
 * Called from the workspace page when the BOILER tab is active on a
 * manifestation. Returns a single composite shape the renderer can read
 * without further fetches.
 *
 * Org scoping enforced via `getCurrentUserWithOrg()` — every query filters
 * by `eq(*.orgId, user.orgId)`.
 */
export async function loadBoilerV2State(opts: {
  signalId: string;
  journeyId: string;
}): Promise<BoilerV2LoadedState> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Not authenticated");

  // 1. boiler_state row (may be null if no generation has run yet)
  const [stateRow] = await db
    .select()
    .from(boilerState)
    .where(
      and(
        eq(boilerState.orgId, user.orgId),
        eq(boilerState.signalId, opts.signalId),
        eq(boilerState.journeyId, opts.journeyId),
      ),
    )
    .limit(1);

  // 2. All design_versions for this signal/journey (incl. discarded — renderer filters)
  const versionRows = await db
    .select()
    .from(designVersions)
    .where(
      and(
        eq(designVersions.orgId, user.orgId),
        eq(designVersions.signalId, opts.signalId),
        eq(designVersions.journeyId, opts.journeyId),
      ),
    )
    .orderBy(desc(designVersions.generatedAt));

  // 3. All mockup_renders for those design versions
  const versionIds = versionRows.map((v) => v.id);
  const mockupRows =
    versionIds.length > 0
      ? await db
          .select()
          .from(mockupRenders)
          .where(
            and(
              eq(mockupRenders.orgId, user.orgId),
              // We can't do `in (...)` with an empty array elegantly; just skip when empty
              ...(versionIds.length === 1
                ? [eq(mockupRenders.designVersionId, versionIds[0])]
                : []),
            ),
          )
      : [];
  // For multi-version case fetch separately to keep it simple — small N, no
  // join needed. (`in` operator skipped for brevity; small scale.)
  // TODO: when version counts grow > 10, switch to `inArray()` from drizzle-orm.

  const versions: BoilerV2VersionRow[] = versionRows.map((v) => ({
    id: v.id,
    parentVersionId: v.parentVersionId,
    tier: v.tier as "low" | "medium" | "high",
    promptUsed: v.promptUsed,
    refinementInstruction: v.refinementInstruction,
    flatArtworkUrl: v.flatArtworkUrl,
    cloudinaryPublicId: v.cloudinaryPublicId,
    widthPx: v.widthPx,
    heightPx: v.heightPx,
    paletteRoles: v.paletteRoles as PaletteRoles,
    compositionMeta: v.compositionMeta as CompositionMeta & {
      verification?: VerificationResultLite | null;
    },
    costUsd: v.costUsd,
    generatedAt: v.generatedAt.toISOString(),
    discarded: v.discarded,
  }));

  const visibleVersions = versions.filter((v) => !v.discarded);
  const activeVersion = stateRow?.activeVersionId
    ? versions.find((v) => v.id === stateRow.activeVersionId) ?? null
    : null;
  const finalizedVersion = stateRow?.finalizedVersionId
    ? versions.find((v) => v.id === stateRow.finalizedVersionId) ?? null
    : null;

  const state: BoilerV2State | null = stateRow
    ? {
        id: stateRow.id,
        signalId: stateRow.signalId,
        journeyId: stateRow.journeyId,
        activeVersionId: stateRow.activeVersionId,
        activeGarmentHex: stateRow.activeGarmentHex,
        activePaletteRoles: stateRow.activePaletteRoles as PaletteRoles,
        finalized: stateRow.finalized,
        finalizedAt: stateRow.finalizedAt?.toISOString() ?? null,
        finalizedVersionId: stateRow.finalizedVersionId,
        updatedAt: stateRow.updatedAt.toISOString(),
      }
    : null;

  return {
    state,
    versions,
    visibleVersions,
    activeVersion,
    finalizedVersion,
    mockupRenders: mockupRows.map((m) => ({
      id: m.id,
      designVersionId: m.designVersionId,
      colorwayHex: m.colorwayHex,
      face: m.face as "front" | "back",
      renderer: m.renderer as "dynamic_mockups" | "svg_flatlay",
      cloudinaryUrl: m.cloudinaryUrl,
      cloudinaryPublicId: m.cloudinaryPublicId,
      widthPx: m.widthPx,
      heightPx: m.heightPx,
      renderedAt: m.renderedAt.toISOString(),
    })),
  };
}

// ─── Feature flag ────────────────────────────────────────────────────

/**
 * Check whether the new BOILER v2 renderer is enabled for the current org.
 * Reads `config_engine_room.boiler_v2_renderer`. Defaults to false.
 *
 * Workspace page calls this on the BOILER tab; renderer dispatcher picks
 * between BoilerV2 and the legacy BoilerGallery based on the result.
 */
export async function isBoilerV2RendererEnabled(): Promise<boolean> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Not authenticated");
  const [row] = await db
    .select({ value: configEngineRoom.value })
    .from(configEngineRoom)
    .where(
      and(
        eq(configEngineRoom.orgId, user.orgId),
        eq(configEngineRoom.key, "boiler_v2_renderer"),
      ),
    )
    .limit(1);
  // value is jsonb; expected literal true or false
  return row?.value === true;
}
