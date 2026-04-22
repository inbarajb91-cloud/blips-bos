"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Postgres changes on a table and fire a callback on every
 * insert/update/delete.
 *
 * Typical usage — pair with TanStack Query or router.refresh():
 *
 *   const queryClient = useQueryClient();
 *   useRealtimeChannel("signals", () =>
 *     queryClient.invalidateQueries({ queryKey: ["signals"] })
 *   );
 *
 * For Realtime to fire, the table must be in the `supabase_realtime`
 * publication (see scripts/apply-realtime.ts / scripts/migrate-phase-6-5.ts).
 *
 * Phase 6.6 auth fix: @supabase/ssr's browser client doesn't auto-attach
 * the user's JWT to Realtime's socket. Without JWT, RLS applies as if the
 * subscriber were anonymous and filters out every event on org-scoped
 * tables. Fix = explicitly call `supabase.realtime.setAuth(access_token)`
 * after the session loads, and re-call on token refresh events.
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
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const subscribe = async () => {
      // 1. Attach current session's access token to Realtime before
      //    subscribing. Without this, channel.subscribe() succeeds but
      //    RLS on the subscriber's role evaluates as anon → zero events
      //    reach the browser for org-scoped tables.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }

      if (cancelled) return;

      // 2. Create + subscribe. Status callback lets us log subscription
      //    state — useful for diagnosing filtered vs. missing events.
      channel = supabase
        .channel(`realtime:${table}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          (payload) => {
            onChangeRef.current(payload);
          },
        )
        .subscribe((status) => {
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            // Non-successful states — log so we can diagnose in DevTools.
            console.warn(`[realtime:${table}] ${status}`);
          }
        });
    };

    // Re-attach token on refresh so long-lived sessions don't drift.
    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      authSub.unsubscribe();
    };
  }, [table]);
}
