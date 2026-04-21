"use client";

import { useTransition } from "react";
import { triggerCollect } from "@/lib/actions/candidates";

/**
 * "Collect now" button — fires bunker.collection.on_demand event.
 * Actual collection runs in the background via Inngest; the button returns
 * fast and the Realtime subscription picks up new candidates as they land.
 */
export function CollectButton() {
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      await triggerCollect();
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border border-deep-divider hover:border-warm-muted font-mono text-[10px] uppercase tracking-[0.18em] text-warm-bright hover:text-off-white transition-colors disabled:opacity-70 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
    >
      {pending ? (
        <>
          <span>Collecting</span>
          <span className="inline-flex gap-[3px]">
            <span className="w-1 h-1 rounded-full bg-current animate-[pulse_1.4s_ease-in-out_infinite]" />
            <span className="w-1 h-1 rounded-full bg-current animate-[pulse_1.4s_ease-in-out_0.2s_infinite]" style={{ animationDelay: "0.2s" }} />
            <span className="w-1 h-1 rounded-full bg-current animate-[pulse_1.4s_ease-in-out_0.4s_infinite]" style={{ animationDelay: "0.4s" }} />
          </span>
        </>
      ) : (
        "Collect now"
      )}
    </button>
  );
}
