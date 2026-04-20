import type { AgentKey } from "@/lib/ai/types";
import type { Skill } from "./types";

/**
 * Skill registry.
 *
 * Each phase adds its skill here:
 *   Phase 6:  BUNKER
 *   Phase 9:  STOKER
 *   Phase 10: FURNACE
 *   Phase 11: BOILER
 *   Phase 12: ENGINE
 *   post-launch: PROPELLER
 *   ORC (orchestrator) is written inline per-signal, not as a static skill.
 *
 * Empty for Phase 3 — the infrastructure (generateStructured, logger, router)
 * is validated via `scripts/test-llm.ts` with a throwaway Zod schema.
 */
const registry = new Map<AgentKey, Skill<unknown, unknown>>();

// Skills are registered by each phase's module import side effects.
// Example (Phase 6):
//   import "./bunker";  // registers BUNKER skill

export function registerSkill<TIn, TOut>(skill: Skill<TIn, TOut>): void {
  registry.set(skill.name, skill as unknown as Skill<unknown, unknown>);
}

export function loadSkill<TIn = unknown, TOut = unknown>(
  name: AgentKey,
): Skill<TIn, TOut> {
  const s = registry.get(name);
  if (!s) {
    throw new Error(
      `Skill '${name}' is not registered. Register it in the skill module before use.`,
    );
  }
  return s as unknown as Skill<TIn, TOut>;
}

export function listRegisteredSkills(): AgentKey[] {
  return Array.from(registry.keys());
}
