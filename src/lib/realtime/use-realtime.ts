"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Postgres changes on a table and fire a callback on every
 * insert/update/delete.
 *
 * Typical usage — pair with TanStack Query to invalidate caches when the
 * underlying data changes server-side:
 *
 *   const queryClient = useQueryClient();
 *   useRealtimeChannel("signals", () =>
 *     queryClient.invalidateQueries({ queryKey: ["signals"] })
 *   );
 *
 * For Realtime to fire, the table must be in the `supabase_realtime`
 * publication. Apply via `scripts/apply-realtime.ts` (Phase 5 setup).
 *
 * The callback is held via ref so passing a new function on every render
 * doesn't re-subscribe. Only `table` changes trigger a new channel.
 */
export function useRealtimeChannel(
  table: string,
  onChange: (payload: unknown) => void,
): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`realtime:${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          onChangeRef.current(payload);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table]);
}
