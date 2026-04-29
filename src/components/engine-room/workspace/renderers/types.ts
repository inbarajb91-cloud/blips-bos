/**
 * Shared renderer types — Phase 9F + 9.5.
 *
 * Pulled out of registry.tsx so server pages can import the data shapes
 * without dragging the renderer components themselves into the server
 * bundle.
 */

import type { SignalStatus } from "@/components/engine-room/stage-pips";
import type { DecadeKey } from "@/components/engine-room/workspace/manifestation-selector";

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

/**
 * Phase 9.5 — single source of truth for a manifestation child seen
 * from the parent workspace. The parent page pre-fetches one of these
 * per child signal, so the canvas can swap between manifestations
 * without a network round-trip.
 *
 * `id` is the child's `signals.id`. `shortcode` and `title` are what
 * the dropdown surface uses; `decade` keys both the tint and the
 * URL `?m=` param value; `status` drives the "this manifestation is
 * dismissed" filter.
 *
 * Per-stage outputs are keyed by agent name (`STOKER`, `FURNACE`,
 * `BOILER`, `ENGINE`, `PROPELLER`) so future renderers can read
 * `activeManifestation.outputs.FURNACE` once Phase 10 ships, without
 * needing another schema change. Phase 9.5 only populates STOKER
 * (everything else is null because their pipelines haven't run yet).
 */
export interface ManifestationSummary {
  id: string;
  shortcode: string;
  title: string;
  decade: DecadeKey;
  status: SignalStatus;
  outputs: Partial<Record<string, ManifestationOwnDetail | null>>;
}
