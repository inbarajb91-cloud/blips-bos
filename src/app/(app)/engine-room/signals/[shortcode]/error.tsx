"use client";

/**
 * DIAGNOSTIC error boundary — Phase 10 verification (May 6, 2026).
 *
 * Inba reported a masked "Server Components render" error inside RCL
 * cards across multiple signals (RANSOM, DUTY-2). My client-side
 * CardErrorBoundary in stoker-resonance.tsx didn't catch it — meaning
 * the error is in a Server Component path. Next.js's route-level
 * error.tsx is the only thing that catches Server Component errors at
 * that route segment.
 *
 * This boundary surfaces:
 *   - error.message (the actual, unmasked error text)
 *   - error.digest (the production-build digest hex string)
 *   - error.name + stack
 *
 * In production builds, error.message IS available to client error
 * boundaries even when Next.js masks it from the user. The "masked"
 * version Inba sees is React's automatic fallback when there's no
 * route-level error.tsx — which we now have.
 *
 * Once the underlying error is identified + fixed, this can stay as a
 * defensive boundary OR be replaced with a more user-friendly error UI.
 */

import { useEffect } from "react";

export default function SignalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Vercel runtime logs catch this on the server side; browser console
    // catches it client side.
    console.error("[signal route error]", error, "\ndigest:", error.digest);
  }, [error]);

  return (
    <div className="m-8 p-6 border-2 border-[#d4908a] bg-[#a04040]/12 rounded-md">
      <div className="font-mono text-[12px] tracking-[0.2em] uppercase text-[#d4908a] mb-3">
        Signal route error · Phase 10 diagnostic
      </div>
      <div className="font-display text-lg font-semibold text-t1 mb-3">
        {error.name}: {error.message}
      </div>
      {error.digest && (
        <div className="font-mono text-[11px] text-t3 mb-3">
          <strong>Digest:</strong> {error.digest}
        </div>
      )}
      {error.stack && (
        <pre className="font-mono text-[10px] text-t4 whitespace-pre-wrap overflow-x-auto bg-black/40 p-3 rounded mb-3">
          {error.stack.slice(0, 2000)}
        </pre>
      )}
      <button
        type="button"
        onClick={() => reset()}
        className="font-mono text-[10px] tracking-[0.2em] uppercase px-4 py-2 border border-rule-2 text-t2 hover:text-t1 transition-colors rounded-sm"
      >
        Retry
      </button>
    </div>
  );
}
