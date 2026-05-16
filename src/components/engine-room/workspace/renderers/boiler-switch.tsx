"use client";

import { useQuery } from "@tanstack/react-query";
import { BoilerGallery } from "./boiler-gallery";
import { BoilerV2 } from "./boiler-v2";
import {
  loadBoilerV2State,
  isBoilerV2RendererEnabled,
} from "@/lib/actions/boiler-v2";
import type { RendererProps } from "./registry";

/**
 * BoilerSwitch — Phase 11D.4c.
 *
 * Routes the BOILER tab between the legacy 4-variant gallery renderer
 * (`BoilerGallery`, Phase 11) and the new single-design + ORC iteration
 * renderer (`BoilerV2`, Phase 11D).
 *
 * The switch is driven by `config_engine_room.boiler_v2_renderer`. Defaults
 * to false — the existing gallery keeps working until the founder flips the
 * flag (or until the eval gate passes in Phase 11D.6).
 *
 * This component self-loads via TanStack Query — no page edits needed. Both
 * the feature flag and the v2 state are server actions with auth checks
 * inside, so RLS scoping happens automatically.
 *
 * Loading UX: while the flag check is in flight, we render the legacy
 * gallery (zero downtime on first paint). Once the flag resolves, the
 * renderer swaps. v2 state loads in parallel; the v2 renderer handles its
 * own loading state (renders empty-state while undefined).
 *
 * Realtime: subscribed in `boiler-v2.tsx` itself (Phase 11D.4e) — the
 * TanStack query invalidates on design_versions / boiler_state / mockup_renders
 * changes, so the switch re-renders with fresh data automatically.
 */
export function BoilerSwitch(props: RendererProps) {
  const signalId = props.activeManifestation?.id ?? null;

  // Feature flag — org-scoped, cached for the session
  const flagQuery = useQuery({
    queryKey: ["boiler-v2-enabled"],
    queryFn: () => isBoilerV2RendererEnabled(),
    staleTime: 5 * 60 * 1000, // 5min — flag rarely changes
  });

  // v2 state — signal-scoped. loadBoilerV2State resolves the active journey
  // server-side via findActiveJourney() so the renderer's read and ORC tools'
  // writes converge on the same (signalId, journeyId) boilerState row. Earlier
  // version of this file passed signalId as both signal and journey — that was
  // a real bug (renderer read a row that no ORC tool ever wrote to). Fixed.
  const v2Query = useQuery({
    queryKey: ["boiler-v2-state", signalId],
    queryFn: () => loadBoilerV2State({ signalId: signalId! }),
    enabled: flagQuery.data === true && signalId !== null,
    staleTime: 30 * 1000,
  });

  // Default to legacy renderer while the flag check is in flight or returned false
  if (flagQuery.data !== true) {
    return <BoilerGallery {...props} />;
  }

  return <BoilerV2 {...props} boilerV2State={v2Query.data ?? null} />;
}
