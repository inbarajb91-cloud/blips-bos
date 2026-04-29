import type { SignalStatus } from "@/components/engine-room/stage-pips";

/**
 * Agent keys for the workspace tab strip + renderer registry.
 *
 * These map 1:1 to the six pipeline stages in ARCHITECTURE.md. Each key
 * addresses a registered renderer component in
 * `src/components/engine-room/workspace/renderers/registry.ts`. The order
 * below is the pipeline order — tab strip renders in this order.
 */
export const AGENT_KEYS = [
  "BUNKER",
  "STOKER",
  "FURNACE",
  "BOILER",
  "ENGINE",
  "PROPELLER",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

/**
 * UI state of a given stage tab for a given signal.
 *   - `completed` = signal has already been past this stage
 *   - `active`    = signal is currently at this stage
 *   - `future`    = signal has not yet reached this stage
 */
export type StageState = "completed" | "active" | "future";

/**
 * Maps a signal's persisted `status` → which stage is `active` + which
 * earlier stages are `completed`. Phase 7 only renders BUNKER
 * retrospective as a real renderer; other stages reuse the placeholder
 * component, but the state machine is already full so the tab strip
 * lights up correctly from day one.
 *
 * Semantics:
 *   - IN_BUNKER      → BUNKER active (not yet approved — edge case, since
 *                      approval lives on Bridge, but covered for safety)
 *   - IN_STOKER      → BUNKER completed, STOKER active
 *   - IN_FURNACE     → BUNKER/STOKER completed, FURNACE active
 *   - ...and so on
 *   - DOCKED         → all six completed
 *   - COLD_BUNKER    → BUNKER completed, rest dormant (parked, no active)
 *   - DISMISSED      → BUNKER completed (for audit), rest dormant
 *   - BUNKER_FAILED  → BUNKER active (so user sees the failure state)
 *   - EXTRACTION_FAILED → BUNKER active (same)
 */
export function computeStageStates(
  status: SignalStatus,
): Record<AgentKey, StageState> {
  const states: Record<AgentKey, StageState> = {
    BUNKER: "future",
    STOKER: "future",
    FURNACE: "future",
    BOILER: "future",
    ENGINE: "future",
    PROPELLER: "future",
  };

  switch (status) {
    case "IN_BUNKER":
    case "BUNKER_FAILED":
    case "EXTRACTION_FAILED":
      states.BUNKER = "active";
      break;
    case "IN_STOKER":
      states.BUNKER = "completed";
      states.STOKER = "active";
      break;
    case "IN_FURNACE":
      states.BUNKER = "completed";
      states.STOKER = "completed";
      states.FURNACE = "active";
      break;
    case "IN_BOILER":
      states.BUNKER = "completed";
      states.STOKER = "completed";
      states.FURNACE = "completed";
      states.BOILER = "active";
      break;
    case "IN_ENGINE":
      states.BUNKER = "completed";
      states.STOKER = "completed";
      states.FURNACE = "completed";
      states.BOILER = "completed";
      states.ENGINE = "active";
      break;
    case "AT_PROPELLER":
      states.BUNKER = "completed";
      states.STOKER = "completed";
      states.FURNACE = "completed";
      states.BOILER = "completed";
      states.ENGINE = "completed";
      states.PROPELLER = "active";
      break;
    case "DOCKED":
      states.BUNKER = "completed";
      states.STOKER = "completed";
      states.FURNACE = "completed";
      states.BOILER = "completed";
      states.ENGINE = "completed";
      states.PROPELLER = "completed";
      break;
    case "COLD_BUNKER":
    case "DISMISSED":
      states.BUNKER = "completed";
      // Later stages stay 'future' (dormant) — no active stage.
      break;
    // Phase 9 — STOKER terminal states for parent signals. Cloud CR
    // pass on PR #8 caught these missing branches: parent signals at
    // FANNED_OUT or STOKER_REFUSED would fall through to default with
    // every stage 'future', so the workspace agent-tab strip would
    // incorrectly highlight BUNKER as active.
    case "FANNED_OUT":
      // STOKER fanned the parent out into 1-3 manifestation children.
      // Parent's pipeline ends here — both stages complete, no active.
      states.BUNKER = "completed";
      states.STOKER = "completed";
      // FURNACE+ stay 'future' (dormant) — children live their own
      // pipeline lives, parent's job is done.
      break;
    case "STOKER_REFUSED":
      // BUNKER landed cleanly, STOKER ran but produced no manifestation.
      // No active stage — founder may force-add via ORC's tool (Phase 9G)
      // OR dismiss the parent. STOKER tab shows the refusal banner.
      states.BUNKER = "completed";
      states.STOKER = "completed";
      break;
  }

  return states;
}

/**
 * Given the state machine, the default tab to show on workspace entry is
 * the active stage if present, else the furthest-completed stage, else
 * BUNKER. This is what the tab strip highlights on load.
 */
export function pickInitialTab(
  states: Record<AgentKey, StageState>,
): AgentKey {
  const active = AGENT_KEYS.find((k) => states[k] === "active");
  if (active) return active;
  // Walk backward to find the furthest completed stage
  for (let i = AGENT_KEYS.length - 1; i >= 0; i--) {
    if (states[AGENT_KEYS[i]] === "completed") return AGENT_KEYS[i];
  }
  return "BUNKER";
}
