"use client";

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
 *
 * Style matches the canvas vocabulary — same renderer-header +
 * section-label + dashed-card patterns used by real renderers.
 */
export function StagePlaceholder({
  stage,
  phase,
  description,
  state,
}: {
  stage: string;
  phase: string;
  description: string;
  state: RendererProps["state"];
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

      <div className="p-12 border border-dashed border-rule-2 rounded-md bg-wash-1 text-center">
        <p className="font-editorial italic text-[15px] leading-[1.55] text-t3 max-w-[52ch] mx-auto">
          {description}
        </p>
        <p className="mt-5 font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
          Renderer lands in {phase}
        </p>
      </div>
    </div>
  );
}
