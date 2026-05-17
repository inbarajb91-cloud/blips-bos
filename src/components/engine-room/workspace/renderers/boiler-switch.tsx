"use client";

import { useQuery } from "@tanstack/react-query";
import { BoilerGallery } from "./boiler-gallery";
import { BoilerV2 } from "./boiler-v2";
import { loadBoilerV2State } from "@/lib/actions/boiler-v2";
import type { RendererProps } from "./registry";

/**
 * BoilerSwitch — Phase 11D.4c + 11D.4d.1.
 *
 * Routes the BOILER tab between the legacy 4-variant gallery renderer
 * (`BoilerGallery`, Phase 11) and the new single-design + ORC iteration
 * renderer (`BoilerV2`, Phase 11D).
 *
 * Driven by `boilerV2Enabled` (server-resolved from
 * `config_engine_room.boiler_v2_renderer`, threaded through props by
 * the workspace page).
 *
 * 11D.4d.1 change: the flag check used to be a client-side TanStack
 * Query — which meant the dispatcher rendered v1 BoilerGallery for the
 * first ~100–300ms while the query was in flight, THEN swapped to v2.
 * For v2-enabled orgs (currently all of them), that was a guaranteed
 * v1→v2 flash on every BOILER tab visit. Inba reported it directly.
 * Server-resolving the flag eliminates the flash entirely — SSR knows
 * the flag value and renders the right component on first paint.
 *
 * v2 state still loads via TanStack Query (signal-scoped, refetched
 * by realtime in `BoilerV2Realtime`). The v2 renderer renders its
 * empty state while the state query is in flight, which is the correct
 * "no design yet" UX — not the v1 flash.
 */
export function BoilerSwitch(props: RendererProps) {
  const signalId = props.activeManifestation?.id ?? null;
  const boilerV2Enabled = props.boilerV2Enabled ?? false;

  // v2 state — signal-scoped. loadBoilerV2State resolves the active journey
  // server-side via findActiveJourney() so the renderer's read and ORC tools'
  // writes converge on the same (signalId, journeyId) boilerState row.
  const v2Query = useQuery({
    queryKey: ["boiler-v2-state", signalId],
    queryFn: () => loadBoilerV2State({ signalId: signalId! }),
    enabled: boilerV2Enabled && signalId !== null,
    staleTime: 30 * 1000,
  });

  if (!boilerV2Enabled) {
    return <BoilerGallery {...props} />;
  }

  return <BoilerV2 {...props} boilerV2State={v2Query.data ?? null} />;
}
