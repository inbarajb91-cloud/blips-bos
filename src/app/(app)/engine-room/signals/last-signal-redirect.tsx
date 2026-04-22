"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side redirect to the user's last-viewed signal.
 *
 * Reads `ws.lastSignalShortcode` from localStorage (written by
 * `WorkspaceFrame` on mount) and calls `router.replace` so the URL ends
 * up on the real signal page without a history entry for the landing.
 *
 * If no shortcode is stored — first visit, or the user has never opened
 * a signal — shows an editorial empty state directing them to Bridge.
 *
 * Two states while the component mounts:
 *   - `checking`: brief moment before we read localStorage. Shows nothing
 *     so there's no flash of the empty state before the redirect fires.
 *   - `empty`: no last signal found. Shows the empty state.
 *
 * Note: we trust the stored shortcode. If the signal was archived or
 * deleted, the redirect lands on `notFound()` from the signal page,
 * which is an acceptable failure mode for an edge case.
 */
const LAST_SIGNAL_KEY = "ws.lastSignalShortcode";

type State = "checking" | "empty";

export function LastSignalRedirect() {
  const router = useRouter();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let shortcode: string | null = null;
    try {
      shortcode = localStorage.getItem(LAST_SIGNAL_KEY);
    } catch {
      /* localStorage unavailable */
    }
    if (shortcode && shortcode.trim().length > 0) {
      router.replace(`/engine-room/signals/${encodeURIComponent(shortcode)}`);
    } else {
      setState("empty");
    }
  }, [router]);

  if (state === "checking") {
    // Render nothing — brief pre-redirect moment. Ink background from the
    // shell shows through, user sees no flash of empty-state copy.
    return <div className="h-full bg-ink" aria-hidden />;
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-16 gap-6 text-center">
      <p className="font-editorial italic text-warm-bright text-3xl leading-tight max-w-md">
        Pick a signal to open its workspace.
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-warm-muted max-w-sm leading-relaxed">
        From the Bridge, click any signal row in a collection&rsquo;s pipeline.
      </p>
    </div>
  );
}
