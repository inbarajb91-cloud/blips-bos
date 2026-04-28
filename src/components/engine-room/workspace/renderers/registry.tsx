import type { signals, collections } from "@/db/schema";
import type { AgentKey, StageState } from "../types";
import { BunkerRetrospective } from "./bunker-retrospective";
import { StagePlaceholder } from "./placeholder";
import {
  StokerResonance,
  type ParentStokerData,
} from "./stoker-resonance";
import type {
  ParentReference,
  ManifestationOwnDetail,
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
  FURNACE: (props) => (
    <StagePlaceholder
      stage="FURNACE"
      phase="Phase 10"
      description="FURNACE will score brand fit per decade-manifestation and produce the product brief for BOILER."
      {...props}
    />
  ),
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
