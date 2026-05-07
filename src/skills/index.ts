/**
 * Skill registry — public entry point.
 *
 * Re-exports the low-level registry functions from `./registry` (which lives
 * in its own file to avoid circular imports — skill modules import from
 * `./registry` directly, callers import from here).
 *
 * Side-effect imports at the bottom ensure every implemented skill is
 * registered when this module loads. Adding a new phase's skill = append
 * one line here.
 */

export {
  registerSkill,
  loadSkill,
  listRegisteredSkills,
} from "./registry";

// ─── Auto-register all implemented skills ───────────────────────
// Each import's side effect calls registerSkill() on module evaluation.
// Keep in phase order so the load sequence mirrors the pipeline.
import "./bunker"; // Phase 6
import "./stoker"; // Phase 9
import "./furnace"; // Phase 10
// import "./boiler";  // Phase 11
// import "./engine";  // Phase 12
