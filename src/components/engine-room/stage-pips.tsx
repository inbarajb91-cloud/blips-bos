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
  | "STOKER_REFUSED" // STOKER refused (no decade scored >= 50)
  // Phase 10 — FURNACE refusal state for manifestation children.
  | "FURNACE_REFUSED"; // FURNACE refused (brand-fit < 50)

const STAGES = [
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
] as const;

/**
 * Stage progression for a signal — three values:
 *   - `completedThrough`: how many pips light up (0 = none, 6 = all)
 *   - `activeStage`: the breathing in-progress stage, or null if terminal
 *   - `label`: the text shown next to the pips
 *
 * CR pass on PR #8: the previous shape returned a single numeric index
 * which conflated "stage 2 in progress" with "stage 2 done, terminal."
 * Both rendered breathing pips at the same position and pulled the
 * wrong STAGES[] label for terminal states (FANNED_OUT showed
 * "FURNACE" because index=2). Replaced with a structured shape so
 * terminal states render correctly: pips up to N filled, no breathe,
 * label sourced from the status itself.
 */
interface StageProgress {
  completedThrough: number; // pips 0..completedThrough-1 are lit
  activeStage: number | null; // null = terminal, no breathing pip
  label: string;
}

function progressFor(status: SignalStatus): StageProgress {
  switch (status) {
    case "IN_BUNKER":
      return { completedThrough: 0, activeStage: 0, label: "BUNKER" };
    case "IN_STOKER":
      return { completedThrough: 1, activeStage: 1, label: "STOKER" };
    case "IN_FURNACE":
      return { completedThrough: 2, activeStage: 2, label: "FURNACE" };
    case "IN_BOILER":
      return { completedThrough: 3, activeStage: 3, label: "BOILER" };
    case "IN_ENGINE":
      return { completedThrough: 4, activeStage: 4, label: "ENGINE" };
    case "AT_PROPELLER":
      return { completedThrough: 5, activeStage: 5, label: "PROPELLER" };
    case "DOCKED":
      return { completedThrough: 6, activeStage: null, label: "DOCKED" };
    case "FANNED_OUT":
      // Parent terminal state — STOKER produced children, parent's
      // pipeline ends. Two pips filled (BUNKER + STOKER), no breathe,
      // label communicates the terminal nature.
      return { completedThrough: 2, activeStage: null, label: "FANNED OUT" };
    case "STOKER_REFUSED":
      // BUNKER complete + STOKER ran-and-refused. STOKER itself
      // succeeded (produced an agent_outputs row with refused=true);
      // refusal is a valid STOKER outcome, not a failure. So both pips
      // light up to reflect "this signal completed STOKER's review."
      // This matches workspace/types.ts computeStageStates which marks
      // BUNKER + STOKER as 'completed' for this status. Cloud CR pass
      // 2 on PR #8 caught the disagreement between the two renderers.
      return {
        completedThrough: 2,
        activeStage: null,
        label: "STOKER REFUSED",
      };
    case "FURNACE_REFUSED":
      // Phase 10 — manifestation child terminal-ish state when FURNACE
      // refuses for brand-fit reasons (score < 50). Three pips light up
      // (BUNKER + STOKER + FURNACE) — FURNACE ran successfully and
      // produced an agent_outputs row with refused=true. Refusal is a
      // valid FURNACE outcome, mirroring STOKER_REFUSED's logic. Founder
      // can force-advance via ORC or dismiss the manifestation.
      return {
        completedThrough: 3,
        activeStage: null,
        label: "FURNACE REFUSED",
      };
    // CR pass on PR #8 — collection-card.tsx's currentStageLabel uses
    // human-readable display labels for these states ("COLD" / "FAILED").
    // The previous `label: status` would surface raw enum values
    // (COLD_BUNKER / EXTRACTION_FAILED) anywhere StagePips renders the
    // label. Mirror collection-card's mapping so the visual stays
    // consistent across both renderers.
    case "COLD_BUNKER":
      return { completedThrough: 0, activeStage: null, label: "COLD" };
    case "DISMISSED":
      return { completedThrough: 0, activeStage: null, label: "DISMISSED" };
    case "BUNKER_FAILED":
    case "EXTRACTION_FAILED":
      return { completedThrough: 0, activeStage: null, label: "FAILED" };
    default:
      return { completedThrough: 0, activeStage: 0, label: "BUNKER" };
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
  const progress = progressFor(status);

  return (
    <div className={`flex items-center gap-2.5 ${className}`} {...rest}>
      <div className="flex items-center gap-1.5">
        {STAGES.map((stage, i) => {
          const isActive = progress.activeStage === i;
          const isCompleted = i < progress.completedThrough && !isActive;
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
          {progress.label}
        </span>
      )}
    </div>
  );
}
