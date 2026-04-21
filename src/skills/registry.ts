import type { AgentKey } from "@/lib/ai/types";
import type { Skill } from "./types";

/**
 * Low-level skill registry — lives in its own file to avoid circular imports.
 *
 * Skill modules (bunker.ts, stoker.ts, etc.) import `registerSkill` from
 * HERE, not from `./index`. `./index` re-exports + triggers the skill
 * module side-effect imports. Splitting the data container from the entry
 * point prevents the "Cannot access 'registry' before initialization"
 * crash when a skill module evaluates before the entry point finishes.
 */

const registry = new Map<AgentKey, Skill<unknown, unknown>>();

export function registerSkill<TIn, TOut>(skill: Skill<TIn, TOut>): void {
  registry.set(skill.name, skill as unknown as Skill<unknown, unknown>);
}

export function loadSkill<TIn = unknown, TOut = unknown>(
  name: AgentKey,
): Skill<TIn, TOut> {
  const s = registry.get(name);
  if (!s) {
    throw new Error(
      `Skill '${name}' is not registered. Import the skill module before use — e.g., \`import "@/skills/bunker"\`.`,
    );
  }
  return s as unknown as Skill<TIn, TOut>;
}

export function listRegisteredSkills(): AgentKey[] {
  return Array.from(registry.keys());
}
