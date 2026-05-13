"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/lib/realtime/use-realtime";

interface BridgeRealtimeProps {
  hasActiveWork: boolean;
}

/**
 * Silent client component that keeps Bridge live.
 *
 * Instrumented diagnostic build (May 13 PM) — every interesting moment
 * gets a `[BridgeRealtime]` console.log so we can capture exactly where
 * the chain breaks. To be cleaned up after diagnosis.
 */
export function BridgeRealtime({ hasActiveWork }: BridgeRealtimeProps) {
  const router = useRouter();
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshCountRef = useRef(0);
  const lastRefreshAtRef = useRef<number | null>(null);

  // Log mount once.
  useEffect(() => {
    console.log("[BridgeRealtime] mount", {
      hasActiveWork,
      ts: new Date().toISOString(),
    });
    return () => {
      console.log("[BridgeRealtime] unmount", {
        ts: new Date().toISOString(),
        totalRefreshes: refreshCountRef.current,
      });
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback(
    (source: string) => {
      const sinceLast =
        lastRefreshAtRef.current === null
          ? null
          : Date.now() - lastRefreshAtRef.current;
      console.log("[BridgeRealtime] schedule called", {
        source,
        pendingExists: pendingRef.current !== null,
        sinceLastRefreshMs: sinceLast,
        ts: new Date().toISOString(),
      });
      if (pendingRef.current) return;
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        const count = ++refreshCountRef.current;
        lastRefreshAtRef.current = Date.now();
        console.log("[BridgeRealtime] router.refresh() call #" + count, {
          ts: new Date().toISOString(),
        });
        router.refresh();
        // After router.refresh resolves it doesn't return a promise; use
        // a microtask + macrotask to log the post-refresh moment.
        Promise.resolve().then(() => {
          console.log("[BridgeRealtime] router.refresh() returned sync #" + count);
        });
        setTimeout(() => {
          console.log("[BridgeRealtime] 1s after refresh #" + count, {
            href: typeof window !== "undefined" ? window.location.href : "",
            ts: new Date().toISOString(),
          });
        }, 1000);
      }, 800);
    },
    [router],
  );

  // Poll fallback — only while there's active work.
  useEffect(() => {
    if (!hasActiveWork) {
      console.log("[BridgeRealtime] poll OFF (no active work)");
      return;
    }
    console.log("[BridgeRealtime] poll ON (active work, 2s interval)");
    const id = setInterval(() => schedule("poll"), 2000);
    return () => {
      console.log("[BridgeRealtime] poll OFF (cleanup)");
      clearInterval(id);
    };
  }, [hasActiveWork, schedule]);

  // Wrap each table's onChange so we can see which table fired.
  useRealtimeChannel("bunker_candidates", () => schedule("rt:bunker_candidates"));
  useRealtimeChannel("collections", () => schedule("rt:collections"));
  useRealtimeChannel("collection_runs", () => schedule("rt:collection_runs"));
  useRealtimeChannel("signals", () => schedule("rt:signals"));

  return null;
}
