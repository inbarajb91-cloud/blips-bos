/**
 * Shared renderer types — Phase 9F.
 *
 * Pulled out of registry.tsx so server pages can import the data shapes
 * without dragging the renderer components themselves into the server
 * bundle.
 */

/** Basic reference to a manifestation's parent signal — used by the
 *  inherited BUNKER banner + workspace breadcrumbs on manifestation
 *  workspaces. Server page populates from a single query. */
export interface ParentReference {
  id: string;
  shortcode: string;
  workingTitle: string;
  concept: string | null;
}

/** This manifestation's own STOKER agent_outputs row — drives the
 *  manifestation workspace's STOKER tab single-card detail. */
export interface ManifestationOwnDetail {
  id: string;
  content: Record<string, unknown>;
  status: string;
  revisionsCount: number;
}
