"use client";

import { useState, useTransition } from "react";
import {
  approveCandidate,
  dismissCandidate,
} from "@/lib/actions/candidates";

export interface CandidateCardProps {
  id: string;
  shortcode: string;
  workingTitle: string;
  concept: string | null;
  source: string;
  createdAt: Date;
  rawMetadata?: Record<string, unknown> | null;
}

/**
 * One row in the Bridge's Triage Queue.
 * BUNKER extracted this; founder decides approve or dismiss.
 */
export function CandidateCard(props: CandidateCardProps) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"approve" | "dismiss" | null>(null);

  const handleApprove = () => {
    setAction("approve");
    startTransition(async () => {
      await approveCandidate(props.id);
    });
  };

  const handleDismiss = () => {
    setAction("dismiss");
    startTransition(async () => {
      await dismissCandidate(props.id);
    });
  };

  const age = formatAge(props.createdAt);

  return (
    <div
      className={`bg-ink border border-deep-divider rounded-md p-5 flex flex-col gap-3 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center h-7 px-2.5 rounded border border-off-white text-off-white font-mono text-[10px] tracking-[0.15em] font-medium">
            {props.shortcode}
          </span>
          <span className="font-display text-base font-semibold text-off-white leading-tight">
            {props.workingTitle}
          </span>
        </div>
        <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-muted whitespace-nowrap mt-1">
          {props.source} · {age}
        </span>
      </div>

      {props.concept && (
        <p className="font-editorial italic text-warm-bright text-[15px] leading-snug">
          &ldquo;{props.concept}&rdquo;
        </p>
      )}

      <div className="pt-3 border-t border-deep-divider flex items-center justify-between gap-4">
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-warm-muted">
          BUNKER candidate · awaiting triage
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={pending}
            className="px-3 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white hover:border-warm-muted border border-transparent transition-colors disabled:cursor-wait focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white"
          >
            {pending && action === "dismiss" ? "Dismissing..." : "Dismiss"}
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={pending}
            className="px-4 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-[0.18em] bg-off-white text-ink hover:bg-warm-bright transition-colors disabled:opacity-70 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
          >
            {pending && action === "approve" ? "Approving..." : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAge(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
