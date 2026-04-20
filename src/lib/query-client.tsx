"use client";

import {
  QueryClient,
  QueryClientProvider,
  isServer,
} from "@tanstack/react-query";
import { useState } from "react";

/**
 * Creates a new QueryClient. In browser, we reuse a single client across
 * renders to preserve cache. On the server (during SSR streaming), each
 * request gets a fresh client to avoid cross-request state leaking.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 30 seconds — UI feels instant, fresh data arrives on focus/reconnect
        staleTime: 30 * 1000,
        // Don't refetch on window focus aggressively — let staleTime drive
        refetchOnWindowFocus: true,
        // Retry once on failure, then give up (app shows error state)
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState so the client stays stable across re-renders
  const [client] = useState(() => getQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
