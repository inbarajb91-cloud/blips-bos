"use client";

import { motion } from "framer-motion";
import { AGENT_KEYS, type AgentKey, type StageState } from "./types";

/**
 * Agent Tab Strip — Phase 7.
 *
 * Six tabs, one per pipeline stage. Click a completed or active stage to
 * swap the canvas to that stage's renderer. Future stages are disabled
 * (can't "jump ahead" to a stage that hasn't happened yet).
 *
 * Breathing underline uses Framer Motion's `layoutId="tab-underline"` so
 * the underline flows smoothly between tabs on click (same pattern as
 * the Engine Room SectionTabs). Active stage's dot also breathes in the
 * workspace's parent-collection decade color.
 *
 * A11y: role="tablist" + role="tab" + aria-selected + aria-controls
 * pointing at the canvas region so screen readers can announce tab
 * position and navigate to content.
 */
export function AgentTabStrip({
  states,
  activeTab,
  onTabChange,
}: {
  states: Record<AgentKey, StageState>;
  activeTab: AgentKey;
  onTabChange: (tab: AgentKey) => void;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Pipeline stages"
      className="flex border-t border-rule-1 -mx-11 px-11 relative"
      style={{ height: 56 }}
    >
      {AGENT_KEYS.map((key) => {
        const state = states[key];
        const isActive = key === activeTab;
        const isCompleted = state === "completed";
        const isFuture = state === "future";
        const isStateActive = state === "active";

        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls="workspace-canvas"
            disabled={isFuture}
            onClick={() => !isFuture && onTabChange(key)}
            className={`flex-1 flex items-center justify-center gap-[10px] font-mono text-[10.5px] tracking-[0.24em] uppercase transition-colors relative px-3 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 ${
              isFuture
                ? "text-t5 cursor-not-allowed"
                : isActive
                  ? "text-t1"
                  : isCompleted
                    ? "text-t2 hover:text-t1"
                    : "text-t5 hover:text-t2"
            }`}
          >
            <span
              className={`rounded-full transition-all ${
                isStateActive ? "breathe" : ""
              }`}
              style={{
                width: 6,
                height: 6,
                background: isStateActive
                  ? "rgba(var(--d), 1)"
                  : isCompleted
                    ? "var(--color-t2)"
                    : isFuture
                      ? "transparent"
                      : "var(--color-t5)",
                border: isFuture ? "1px solid var(--color-rule-2)" : "none",
                boxShadow: isStateActive
                  ? "0 0 8px rgba(var(--d), 0.5)"
                  : "none",
              }}
              aria-hidden
            />
            {key}
            {/* Breathing underline — Framer Motion handles the slide
                between tabs via shared layoutId. Only the active tab
                renders it, so on change the motion.div unmounts from the
                old tab and mounts on the new one with a smooth transition. */}
            {isActive && (
              <motion.span
                layoutId="tab-underline"
                aria-hidden
                className="breathe absolute bottom-0 left-0 right-0"
                style={{
                  height: 2,
                  background: "rgba(var(--d), 0.9)",
                  boxShadow: "0 0 12px rgba(var(--d), 0.5)",
                }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
