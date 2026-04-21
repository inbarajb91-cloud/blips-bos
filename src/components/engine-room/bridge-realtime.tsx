"use client";

import { useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

/**
 * Silent client component that subscribes to `bunker_candidates` table
 * changes via Supabase Realtime. On any insert/update/delete, invalidates
 * the server-rendered Bridge page so the triage queue reflects live state.
 *
 * Rendered as a zero-height invisible sibling of the Bridge page content.
 * No visible UI.
 */
export function BridgeRealtime() {
  const router = useRouter();

  useRealtimeChannel("bunker_candidates", () => {
    router.refresh();
  });

  return null;
}
