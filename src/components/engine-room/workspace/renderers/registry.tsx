import type { signals, collections } from "@/db/schema";
import type { AgentKey, StageState } from "../types";
import { BunkerRetrospective } from "./bunker-retrospective";
import { StagePlaceholder } from "./placeholder";
import {
  StokerResonance,
  type ParentStokerData,
} from "./stoker-resonance";
import { FurnaceBrief } from "./furnace-brief";
import type {
  ParentReference,
  ManifestationOwnDetail,
  ManifestationSummary,
} from "./types";

/**
 * Renderer Registry — Phase 7.
 *
 * Each agent key maps to a React component that renders that stage's
 * output for a given signal. BUNKER ships first (Phase 7). STOKER
 * (Phase 9), FURNACE (10), BOILER (11), ENGINE (12) and PROPELLER
 * (post-launch) each replace their placeholder when their phase lands.
 *
 * Contract:
 *   - A renderer receives the signal row + optional parent collection
 *     + the stage's current state (completed/active/future) so it can
 *     switch between retrospective and live views.
 *   - Renderers are client components (they render inside the client
 *     `<WorkspaceFrame>` and often carry their own interactivity —
 *     timeline expansion, approval buttons, etc.)
 *   - Renderers must not fetch data. All data comes via props; the
 *     server page does the fetching once per page load.
 */

export interface RendererProps {
  signal: typeof signals.$inferSelect;
  collection: typeof collections.$inferSelect | null;
  state: StageState;
  /**
   * Phase 9D — eagerly-loaded STOKER data for the parent's STOKER tab
   * renderer. Null when STOKER hasn't run, or when the signal is a
   * manifestation child (manifestation workspaces have a different
   * STOKER tab — see Phase 9F).
   */
  stokerData: ParentStokerData | null;
  /**
   * Phase 9F — when the signal is a manifestation child, basic info
   * about its parent for the inherited BUNKER banner + breadcrumbs.
   * Null on raw signals.
   */
  parentRef: ParentReference | null;
  /**
   * Phase 9F — manifestation child's own STOKER agent_outputs row,
   * used to render the manifestation's single-card STOKER tab detail
   * (not the 3-card grid that lives on the parent's STOKER tab).
   * Null on raw signals.
   */
  manifestationDetail: ManifestationOwnDetail | null;
  /**
   * Phase 9.5 — full set of manifestation children for this parent,
   * pre-fetched so the canvas can switch between them without a
   * network round-trip. Empty array on parents that haven't fanned
   * out yet (pre-STOKER, COLD_BUNKER, STOKER_REFUSED) and on
   * manifestation children (children don't get their own selector;
   * direct child URLs redirect to the parent).
   */
  manifestations: ManifestationSummary[];
  /**
   * Phase 9.5 — the manifestation the user is currently focused on,
   * for post-STOKER renderers (FURNACE / BOILER / ENGINE /
   * PROPELLER). Null on the BUNKER and STOKER tabs (they render
   * parent-side data only) and on parents with zero non-dismissed
   * manifestations. Renderers that need it should guard against
   * null with an empty state, not crash.
   */
  activeManifestation: ManifestationSummary | null;
  /**
   * Phase 9.5 polish — workspace-level callback for "switch the
   * canvas to this manifestation, on this stage". Used by the STOKER
   * renderer's per-card "open" arrow + the fan-out preview pills,
   * which both need to (a) flip the active manifestation and (b)
   * advance the active stage tab in one click. Renderers that don't
   * need to drive workspace navigation should ignore this prop.
   * The function flips both the activeTab state and the active
   * manifestation URL param atomically.
   */
  onSwitchToManifestation?: (
    decade: ManifestationSummary["decade"],
    stage: AgentKey,
  ) => void;
}

export type Renderer = React.ComponentType<RendererProps>;

/**
 * Registry — one entry per agent key. When a new stage renderer ships,
 * swap its placeholder here and the tab click routes to the new
 * component automatically. Nothing else changes.
 */
export const RENDERERS: Record<AgentKey, Renderer> = {
  BUNKER: BunkerRetrospective,
  STOKER: StokerResonance,
  FURNACE: FurnaceBrief,
  BOILER: (props) => (
    <StagePlaceholder
      stage="BOILER"
      phase="Phase 11"
      description="BOILER will generate concept art and render the mockup via Dynamic Mockups."
      {...props}
    />
  ),
  ENGINE: (props) => (
    <StagePlaceholder
      stage="ENGINE"
      phase="Phase 12"
      description="ENGINE will produce the tech pack: fabric, measurements, print placement, trims, packaging, care labels."
      {...props}
    />
  ),
  PROPELLER: (props) => (
    <StagePlaceholder
      stage="PROPELLER"
      phase="Post-launch"
      description="PROPELLER bundles the tech pack with vendor briefs and production order details for factory handoff."
      {...props}
    />
  ),
};

/**
 * Stage keys whose renderers operate on a child manifestation rather
 * than the parent signal. The post-STOKER stages all live on a
 * manifestation: FURNACE scores brand fit per decade-card, BOILER
 * concepts a single decade-card, ENGINE produces the tech pack
 * for that decade-card, PROPELLER bundles the vendor brief.
 *
 * The workspace shows the ManifestationSelector when activeTab is
 * one of these AND the parent has at least one non-dismissed child.
 */
export const POST_STOKER_STAGES: ReadonlySet<AgentKey> = new Set([
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
]);
