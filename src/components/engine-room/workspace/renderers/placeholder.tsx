"use client";

import { decadeTintClass } from "@/components/engine-room/workspace/manifestation-selector";
import type { RendererProps } from "./registry";

/**
 * Placeholder renderer — used for stages that haven't shipped their
 * real renderer yet (STOKER, FURNACE, BOILER, ENGINE, PROPELLER during
 * Phase 7; each gets replaced as its phase ships).
 *
 * Renders a minimal card that:
 *   - Names the stage
 *   - Indicates which phase will build its real renderer
 *   - Describes what the stage will do (so users get oriented)
 *   - Reflects the stage's current state (future / active / completed)
 *   - Phase 9.5: surfaces the active manifestation in the header so
 *     the user can see WHICH child the post-STOKER stage will run on.
 *
 * Style matches the canvas vocabulary — same renderer-header +
 * section-label + dashed-card patterns used by real renderers.
 */
export function StagePlaceholder({
  stage,
  phase,
  description,
  state,
  activeManifestation,
}: {
  stage: string;
  phase: string;
  description: string;
  state: RendererProps["state"];
  /** Phase 9.5 — passed through from the registry. When set, the
   *  placeholder renders a "Manifestation" sub-line in the header so
   *  the user can confirm which decade-child the future renderer will
   *  operate on. Null on BUNKER/STOKER stages and on parents with no
   *  manifestations yet. */
  activeManifestation?: RendererProps["activeManifestation"];
}) {
  const stateLabel =
    state === "active"
      ? "In progress · awaiting renderer"
      : state === "completed"
        ? `Completed · record view in ${phase}`
        : `Awaiting — lands in ${phase}`;

  return (
    <div>
      <div className="flex items-baseline justify-between pb-[18px] border-b border-rule-2 mb-8">
        <span className="font-display font-semibold text-[14px] tracking-[0.22em] uppercase text-t1">
          {stage}
        </span>
        <span
          className={`font-mono text-[10px] tracking-[0.22em] uppercase ${
            state === "active"
              ? "text-t2"
              : state === "completed"
                ? "text-t3"
                : "text-t4"
          }`}
        >
          {stateLabel}
        </span>
      </div>

      {/* Active-manifestation hint — Phase 9.5. Shows the decade
          tint, the decade code, and the manifestation's title +
          shortcode so the user has full context for what the future
          renderer will operate on. Only renders for post-STOKER stages
          that have an active manifestation; BUNKER/STOKER's parent-
          scoped placeholders don't see this prop. */}
      {activeManifestation && (
        <div
          className={`${decadeTintClass(activeManifestation.decade)} mb-6 p-[14px_16px] border rounded-sm`}
          style={{
            borderColor: "rgba(var(--d), 0.35)",
            background: "rgba(var(--d), 0.05)",
            borderLeftWidth: 2,
            borderLeftColor: "rgba(var(--d), 0.7)",
          }}
        >
          <div
            className="font-mono text-[10px] tracking-[0.28em] uppercase mb-[6px]"
            style={{ color: "rgba(var(--d), 0.92)" }}
          >
            Manifestation · {activeManifestation.decade}
          </div>
          <div className="font-display font-medium text-[15px] -tracking-[0.005em] text-t1 leading-[1.3] mb-[2px]">
            {activeManifestation.title}
          </div>
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t4">
            {activeManifestation.shortcode}
          </div>
        </div>
      )}

      <div className="p-12 border border-dashed border-rule-2 rounded-md bg-wash-1 text-center">
        <p className="font-editorial text-[15px] leading-[1.55] text-t3 max-w-[52ch] mx-auto">
          {description}
        </p>
        <p className="mt-5 font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
          Renderer lands in {phase}
        </p>
      </div>
    </div>
  );
}
