"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  db,
  designVersions,
  boilerState,
  mockupRenders,
  configEngineRoom,
  signals as signalsTable,
  decisionHistory,
} from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { findActiveJourney } from "@/lib/orc/journey";
import { inngest } from "@/lib/inngest/client";
import { getMemoryBackend } from "@/lib/orc/memory";
import {
  paletteRoleNameSchema,
  tierSchema,
  type PaletteRoles,
  type CompositionMeta,
  type Tier,
} from "@/db/zod";
import type { VerificationResultLite } from "@/lib/boiler/types";

/**
 * BOILER v2 server data loader + UI mutations — Phase 11D.4a + 11D.4d.
 *
 * Read functions for the workspace renderer:
 *   - loadBoilerV2State()          → full state for one (signal, journey)
 *   - isBoilerV2RendererEnabled()  → feature flag check
 *
 * UI mutations (11D.4d) — server-action wrappers around the same logic the
 * ORC tools implement. The renderer's interactive surfaces (color picker
 * popover, action stack buttons) call these directly rather than going
 * through ORC chat. ORC tools STAY wired and authoritative for chat-driven
 * flows; this is a parallel UI lane that does the same thing without an
 * LLM round-trip. Keeping two implementations in sync is the cost; the
 * trade is that "click button" feels like 100ms instead of "wait for
 * ORC's turn to finish."
 *
 * For long-running generations (generate / refine / branch / finalize),
 * the action fires the Inngest event and returns immediately — the
 * Inngest handler does the gpt-image-1 call + Cloudinary upload + verifier
 * + persist. The UI subscribes to design_versions realtime to pick up the
 * new row when it lands (11D.4e).
 */

/** Helper — resolve and validate auth + journey + signal in one shot.
 *  Throws if any check fails; returns the resolved (user, journeyId) tuple
 *  for the mutation to use. Centralizing this keeps the per-action code
 *  short and prevents copy-paste mistakes on auth scoping. */
async function resolveContext(signalId: string) {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Not authenticated");
  const journey = await findActiveJourney(signalId);
  if (!journey) {
    throw new Error(
      `No active journey for signal ${signalId} — cannot mutate BOILER state.`,
    );
  }
  return { user, journeyId: journey.id };
}

/** Workspace page path — server actions call revalidatePath() to refresh
 *  the rendered page after a mutation. The TanStack Query on the client
 *  also invalidates separately for snappier UX, but this is the server
 *  cache invalidation. */
function workspacePath(shortcode: string) {
  return `/engine-room/signals/${shortcode}`;
}

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
 * Load the full BOILER v2 state for a manifestation signal.
 *
 * Resolves the active journey internally via `findActiveJourney()` — caller
 * passes only `signalId`. This mirrors how ORC tools work (they read
 * `ctx.journeyId` which is server-resolved at the route boundary), so the
 * renderer's read and the tools' writes converge on the same
 * `(signalId, journeyId)` boilerState row.
 *
 * Returns an empty-state object (state=null, versions=[]) when:
 *   - The signal has no active journey (data oddity — should never happen)
 *   - No boiler_state row exists yet (BOILER hasn't been run on this signal)
 *   - No design_versions exist yet
 *
 * Org scoping enforced via `getCurrentUserWithOrg()` — every query filters
 * by `eq(*.orgId, user.orgId)`.
 */
export async function loadBoilerV2State(opts: {
  signalId: string;
}): Promise<BoilerV2LoadedState> {
  const user = await getCurrentUserWithOrg();
  if (!user) throw new Error("Not authenticated");

  // Resolve the active journey for this manifestation. Read path: degrade
  // gracefully if no journey exists (return empty state). Production data
  // always has exactly one active journey per signal (Phase 8 invariant).
  const journey = await findActiveJourney(opts.signalId);
  if (!journey) {
    return {
      state: null,
      versions: [],
      visibleVersions: [],
      activeVersion: null,
      finalizedVersion: null,
      mockupRenders: [],
    };
  }
  const journeyId = journey.id;

  // 1. boiler_state row (may be null if no generation has run yet)
  const [stateRow] = await db
    .select()
    .from(boilerState)
    .where(
      and(
        eq(boilerState.orgId, user.orgId),
        eq(boilerState.signalId, opts.signalId),
        eq(boilerState.journeyId, journeyId),
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
        eq(designVersions.journeyId, journeyId),
      ),
    )
    .orderBy(desc(designVersions.generatedAt));

  // 3. All mockup_renders for those design versions (single batched fetch).
  // Uses `inArray()` so multi-version signals get their mockup rows. The
  // earlier single-version fallback silently dropped mockups on signals
  // with ≥2 versions — fixed in PR #46 critical-fix follow-up.
  const versionIds = versionRows.map((v) => v.id);
  const mockupRows =
    versionIds.length > 0
      ? await db
          .select()
          .from(mockupRenders)
          .where(
            and(
              eq(mockupRenders.orgId, user.orgId),
              inArray(mockupRenders.designVersionId, versionIds),
            ),
          )
      : [];

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

// ─── UI mutation server actions (Phase 11D.4d) ───────────────────────
//
// Shared return shape — UI shows a toast on failure with the message.
// Success cases return the relevant id/state so optimistic-update callers
// can reconcile without an extra fetch.

export type BoilerV2ActionResult<TOk = Record<string, unknown>> =
  | ({ success: true } & TOk)
  | { success: false; message: string };

// ─── set_color: update palette role on boiler_state ──────────────────
//
// Mirrors `boilerV2SetColorTool` in `src/lib/orc/tools/boiler-v2-set-color.ts`.
// UPSERT pattern — creates the boiler_state row if it doesn't exist yet
// (founder picks a color before the first generation has run). Pure DB
// write, no LLM, no Inngest.

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/u;

export async function boilerV2SetColorAction(input: {
  signalId: string;
  shortcode: string;
  role: string;
  hex: string;
}): Promise<BoilerV2ActionResult<{ newPalette: Record<string, string> }>> {
  // Validate inputs early — never trust the client. Role must be one of the
  // known palette roles; hex must be 6-digit with leading #.
  const parsedRole = paletteRoleNameSchema.safeParse(input.role);
  if (!parsedRole.success) {
    return {
      success: false,
      message: `Unknown palette role: ${input.role}`,
    };
  }
  if (!HEX_REGEX.test(input.hex)) {
    return {
      success: false,
      message: `Invalid hex: ${input.hex} (must be #RRGGBB)`,
    };
  }

  const { user, journeyId } = await resolveContext(input.signalId);

  // UPSERT — read existing row to merge palette, then update OR insert
  const [existing] = await db
    .select()
    .from(boilerState)
    .where(
      and(
        eq(boilerState.orgId, user.orgId),
        eq(boilerState.signalId, input.signalId),
        eq(boilerState.journeyId, journeyId),
      ),
    )
    .limit(1);

  const existingPalette = (existing?.activePaletteRoles ?? {}) as Record<
    string,
    string
  >;
  const newPalette = { ...existingPalette, [parsedRole.data]: input.hex };

  if (existing) {
    await db
      .update(boilerState)
      .set({
        activePaletteRoles: newPalette,
        ...(parsedRole.data === "garment_base" && { activeGarmentHex: input.hex }),
        updatedAt: sql`NOW()`,
      })
      .where(eq(boilerState.id, existing.id));
  } else {
    await db.insert(boilerState).values({
      orgId: user.orgId,
      signalId: input.signalId,
      journeyId,
      activePaletteRoles: newPalette,
      activeGarmentHex: parsedRole.data === "garment_base" ? input.hex : null,
    });
  }

  revalidatePath(workspacePath(input.shortcode));
  return { success: true, newPalette };
}

// ─── discard_version: soft-delete from history strip ─────────────────
//
// Mirrors `boilerV2DiscardVersionTool`. Guards: cannot discard the active
// or finalized version. UI sends the version id explicitly (founder picks
// from the history strip).

export async function boilerV2DiscardVersionAction(input: {
  signalId: string;
  shortcode: string;
  versionId: string;
}): Promise<BoilerV2ActionResult<{ versionId: string }>> {
  const { user, journeyId } = await resolveContext(input.signalId);

  const [version] = await db
    .select()
    .from(designVersions)
    .where(
      and(
        eq(designVersions.id, input.versionId),
        eq(designVersions.orgId, user.orgId),
        eq(designVersions.signalId, input.signalId),
      ),
    )
    .limit(1);
  if (!version) {
    return {
      success: false,
      message: `Version ${input.versionId} not found on this signal.`,
    };
  }
  if (version.discarded) {
    return {
      success: false,
      message: `Version ${input.versionId} is already discarded.`,
    };
  }

  const [state] = await db
    .select()
    .from(boilerState)
    .where(
      and(
        eq(boilerState.orgId, user.orgId),
        eq(boilerState.signalId, input.signalId),
        eq(boilerState.journeyId, journeyId),
      ),
    )
    .limit(1);
  if (state?.activeVersionId === input.versionId) {
    return {
      success: false,
      message:
        "Can't discard the currently-active version. Switch active first (branch or pick another) and then discard.",
    };
  }
  if (state?.finalizedVersionId === input.versionId) {
    return {
      success: false,
      message:
        "Can't discard the finalized version — it's locked as the canonical artwork.",
    };
  }

  await db
    .update(designVersions)
    .set({ discarded: true, discardedAt: new Date() })
    .where(eq(designVersions.id, input.versionId));

  revalidatePath(workspacePath(input.shortcode));
  return { success: true, versionId: input.versionId };
}

// ─── finalize: fire Inngest event with mode=finalize, tier=high ──────
//
// Mirrors `boilerV2FinalizeTool`. Tier is FORCED to 'high' regardless of
// caller — finalize is the canonical pass and must be the best-quality
// render. Cost: $0.211/call. Refuses if no active version exists or if
// the state is already approved.

export async function boilerV2FinalizeAction(input: {
  signalId: string;
  shortcode: string;
}): Promise<
  BoilerV2ActionResult<{ inngestEventIds: string[]; parentVersionId: string }>
> {
  const { user, journeyId } = await resolveContext(input.signalId);

  const [state] = await db
    .select()
    .from(boilerState)
    .where(
      and(
        eq(boilerState.orgId, user.orgId),
        eq(boilerState.signalId, input.signalId),
        eq(boilerState.journeyId, journeyId),
      ),
    )
    .limit(1);

  if (!state?.activeVersionId) {
    return {
      success: false,
      message:
        "No active design to finalize. Generate one first, iterate via refine, then finalize.",
    };
  }
  if (state.finalized) {
    return {
      success: false,
      message: "Already approved + advanced. Cannot finalize after approve.",
    };
  }

  const send = await inngest.send({
    name: "boiler.v2.generate",
    data: {
      orgId: user.orgId,
      signalId: input.signalId,
      journeyId,
      tier: "high",
      mode: "finalize",
      parentVersionId: state.activeVersionId,
      retryDepth: 0,
      triggeredBy: user.authId,
    },
  });

  // No revalidate here — the new design_version lands async via Inngest +
  // the client picks it up via the design_versions realtime subscription
  // (Phase 11D.4e). Revalidating now would refresh stale data.
  return {
    success: true,
    inngestEventIds: send.ids,
    parentVersionId: state.activeVersionId,
  };
}

// ─── branch: fire Inngest event with mode=branch ─────────────────────
//
// Mirrors `boilerV2BranchTool`. UI picks fromVersionId from the history
// strip (or defaults to the currently-active version). Tier picker on the
// UI — defaults to medium ($0.053) per the spec; branching at low wastes
// the comparison.

export async function boilerV2BranchAction(input: {
  signalId: string;
  shortcode: string;
  fromVersionId: string;
  tier?: Tier;
}): Promise<
  BoilerV2ActionResult<{ inngestEventIds: string[]; fromVersionId: string }>
> {
  const tier = tierSchema.parse(input.tier ?? "medium");
  const { user, journeyId } = await resolveContext(input.signalId);

  const [parent] = await db
    .select()
    .from(designVersions)
    .where(
      and(
        eq(designVersions.id, input.fromVersionId),
        eq(designVersions.orgId, user.orgId),
        eq(designVersions.signalId, input.signalId),
      ),
    )
    .limit(1);
  if (!parent) {
    return {
      success: false,
      message: `Source version ${input.fromVersionId} not found on this signal.`,
    };
  }
  if (parent.discarded) {
    return {
      success: false,
      message: `Source version was discarded. Restore it or pick a different parent.`,
    };
  }
  if (!parent.flatArtworkUrl) {
    return {
      success: false,
      message: `Source version has no flat artwork (failed generation). Pick a successful parent.`,
    };
  }

  const send = await inngest.send({
    name: "boiler.v2.generate",
    data: {
      orgId: user.orgId,
      signalId: input.signalId,
      journeyId,
      tier,
      mode: "branch",
      parentVersionId: input.fromVersionId,
      retryDepth: 0,
      triggeredBy: user.authId,
    },
  });

  return {
    success: true,
    inngestEventIds: send.ids,
    fromVersionId: input.fromVersionId,
  };
}

// ─── generate: fire Inngest event with mode=fresh ────────────────────
//
// Mirrors `boilerV2GenerateTool`. Used by the empty-state "Generate first
// draft" button on the canvas and by founder-driven "start over" intent.
// Tier defaults to medium; UI can pass 'low' from a tier selector.

export async function boilerV2GenerateAction(input: {
  signalId: string;
  shortcode: string;
  tier?: Tier;
}): Promise<BoilerV2ActionResult<{ inngestEventIds: string[]; tier: Tier }>> {
  const tier = tierSchema.parse(input.tier ?? "medium");
  const { user, journeyId } = await resolveContext(input.signalId);

  const send = await inngest.send({
    name: "boiler.v2.generate",
    data: {
      orgId: user.orgId,
      signalId: input.signalId,
      journeyId,
      tier,
      mode: "fresh",
      retryDepth: 0,
      triggeredBy: user.authId,
    },
  });

  return { success: true, inngestEventIds: send.ids, tier };
}

// ─── approve_and_advance: transaction + fire engine.ready ────────────
//
// Mirrors `boilerV2ApproveAndAdvanceTool`. Single transaction updates
// boiler_state.finalized + signals.status = IN_ENGINE + writes decision
// history, then fires engine.ready (best-effort) + writes a memory event
// (best-effort). Both side effects are non-blocking — DB state is the
// source of truth.

export async function boilerV2ApproveAndAdvanceAction(input: {
  signalId: string;
  shortcode: string;
}): Promise<BoilerV2ActionResult<{ finalizedVersionId: string }>> {
  const { user, journeyId } = await resolveContext(input.signalId);

  const [state] = await db
    .select()
    .from(boilerState)
    .where(
      and(
        eq(boilerState.orgId, user.orgId),
        eq(boilerState.signalId, input.signalId),
        eq(boilerState.journeyId, journeyId),
      ),
    )
    .limit(1);

  if (!state || !state.finalizedVersionId) {
    return {
      success: false,
      message:
        "No finalized version yet. Run Finalize first (re-runs the active design at High tier), then approve.",
    };
  }
  if (state.finalized) {
    return {
      success: false,
      message: "Already approved + advanced.",
    };
  }

  const [finalizedVersion] = await db
    .select()
    .from(designVersions)
    .where(
      and(
        eq(designVersions.id, state.finalizedVersionId),
        eq(designVersions.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!finalizedVersion || finalizedVersion.discarded) {
    return {
      success: false,
      message:
        "Finalized version is missing or discarded. Re-run Finalize and try again.",
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(boilerState)
      .set({ finalized: true, finalizedAt: new Date() })
      .where(eq(boilerState.id, state.id));
    await tx
      .update(signalsTable)
      .set({ status: "IN_ENGINE", updatedAt: new Date() })
      .where(eq(signalsTable.id, input.signalId));
    await tx.insert(decisionHistory).values({
      orgId: user.orgId,
      signalId: input.signalId,
      journeyId,
      agentName: "BOILER",
      decision: "boiler_v2_approved",
      reason: `Approved finalized design ${finalizedVersion.id} (tier=${finalizedVersion.tier}) via UI. Advancing to ENGINE Step 1.`,
      decidedBy: user.authId,
    });
  });

  // Best-effort side effects — DB state is already committed.
  try {
    await inngest.send({
      name: "engine.ready",
      data: { orgId: user.orgId, signalId: input.signalId },
    });
  } catch (err) {
    console.warn(
      "[boilerV2ApproveAndAdvanceAction] inngest.send engine.ready failed:",
      err,
    );
  }
  try {
    const memory = await getMemoryBackend();
    await memory.remember({
      orgId: user.orgId,
      container: "events",
      kind: "decision",
      content: `Approved BOILER v2 design ${finalizedVersion.id} (tier=${finalizedVersion.tier}) via UI. Advancing to ENGINE Step 1.`,
      signalId: input.signalId,
      journeyId,
      metadata: {
        decision: "boiler_v2_approve_and_advance",
        versionId: finalizedVersion.id,
        tier: finalizedVersion.tier,
        source: "ui_action",
      },
    });
  } catch (err) {
    console.warn(
      "[boilerV2ApproveAndAdvanceAction] memory write failed (best-effort):",
      err,
    );
  }

  revalidatePath(workspacePath(input.shortcode));
  return { success: true, finalizedVersionId: finalizedVersion.id };
}
