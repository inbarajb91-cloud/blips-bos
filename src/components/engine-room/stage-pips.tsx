import type { ComponentProps } from "react";

/**
 * 6-stage pipeline indicator.
 *
 * Maps a signal's current status to its position in the pipeline. Completed
 * stages are filled; the current stage breathes; future stages are muted.
 *
 * Stages in order: BUNKER → STOKER → FURNACE → BOILER → ENGINE → PROPELLER.
 * Terminal statuses (DOCKED / DISMISSED / COLD_BUNKER / BUNKER_FAILED) are
 * handled as all-filled (DOCKED) or all-dim (DISMISSED/FAILED).
 */
export type SignalStatus =
  | "IN_BUNKER"
  | "IN_STOKER"
  | "IN_FURNACE"
  | "IN_BOILER"
  | "IN_ENGINE"
  | "AT_PROPELLER"
  | "DOCKED"
  | "COLD_BUNKER"
  | "DISMISSED"
  | "BUNKER_FAILED"
  | "EXTRACTION_FAILED"
  // Phase 9 — STOKER terminal states for parent signals.
  | "FANNED_OUT" // STOKER produced 1+ approved manifestation children
  | "STOKER_REFUSED"; // STOKER refused (no decade scored >= 50)

const STAGES = [
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
] as const;

function currentStageIndex(status: SignalStatus): number {
  switch (status) {
    case "IN_BUNKER":
      return 0;
    case "IN_STOKER":
      return 1;
    case "IN_FURNACE":
      return 2;
    case "IN_BOILER":
      return 3;
    case "IN_ENGINE":
      return 4;
    case "AT_PROPELLER":
      return 5;
    case "DOCKED":
      return 6; // all six complete
    case "FANNED_OUT":
      // Parent terminal state after STOKER produces children. STOKER
      // is "complete" for the parent (children take over), but the
      // parent itself never proceeds past STOKER — show two pips lit.
      return 2;
    case "STOKER_REFUSED":
      // STOKER ran but refused to manifest. BUNKER is still "complete"
      // (parent was BUNKER-extracted) but STOKER produced no output —
      // show one pip lit, second pip empty (refusal isn't a failure of
      // BUNKER, just a STOKER outcome).
      return 1;
    case "COLD_BUNKER":
    case "DISMISSED":
    case "BUNKER_FAILED":
    case "EXTRACTION_FAILED":
      return -1; // none lit
    default:
      return 0;
  }
}

export interface StagePipsProps extends ComponentProps<"div"> {
  status: SignalStatus;
  /** Show the stage label text next to the pips. Default true. */
  showLabel?: boolean;
  /** Dot size in pixels. Default 6. */
  size?: number;
}

export function StagePips({
  status,
  showLabel = true,
  size = 6,
  className = "",
  ...rest
}: StagePipsProps) {
  const current = currentStageIndex(status);
  const label = STAGES[current] ?? (status === "DOCKED" ? "DOCKED" : "—");

  return (
    <div
      className={`flex items-center gap-2.5 ${className}`}
      {...rest}
    >
      <div className="flex items-center gap-1.5">
        {STAGES.map((stage, i) => {
          const isCompleted = i < current;
          const isActive = i === current;
          const style = { width: size, height: size } as const;
          const base = "rounded-full transition-colors duration-200";
          const cls = isActive
            ? `${base} bg-t1 breathe`
            : isCompleted
              ? `${base} bg-t2`
              : `${base} bg-t5`;
          return (
            <span
              key={stage}
              className={cls}
              style={style}
              aria-label={`${stage}${isActive ? " (active)" : isCompleted ? " (done)" : ""}`}
            />
          );
        })}
      </div>
      {showLabel && (
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t3 whitespace-nowrap">
          {label}
        </span>
      )}
    </div>
  );
}
