import type { AgentKey } from "@/lib/ai/types";

export interface SkillMeta {
  /** Agent key used as config_agents.agent_name value and React key */
  agentKey: AgentKey;
  stage: number;
  name: string;
  metaphor: string; // Cormorant italic — the ship metaphor
  role: string; // DM Mono — plain description of what it does
}

/**
 * The six pipeline skills in order. ORC is orchestration, not a pipeline stage,
 * so it has its own card above this grid.
 */
export const SKILLS: readonly SkillMeta[] = [
  {
    agentKey: "BUNKER",
    stage: 1,
    name: "BUNKER",
    metaphor: "where signals make landfall",
    role: "Collect · triage · intake",
  },
  {
    agentKey: "STOKER",
    stage: 2,
    name: "STOKER",
    metaphor: "feeds the furnace",
    role: "Season tag · decade derive",
  },
  {
    agentKey: "FURNACE",
    stage: 3,
    name: "FURNACE",
    metaphor: "tested by fire",
    role: "Brand fit · brief writing",
  },
  {
    agentKey: "BOILER",
    stage: 4,
    name: "BOILER",
    metaphor: "pressure and steam",
    role: "Concept · mockup render",
  },
  {
    agentKey: "ENGINE",
    stage: 5,
    name: "ENGINE",
    metaphor: "pistons turn intent into motion",
    role: "Tech pack · construction",
  },
  {
    agentKey: "PROPELLER",
    stage: 6,
    name: "PROPELLER",
    metaphor: "pushes out into the world",
    role: "Vendor bundle · production order",
  },
] as const;

/**
 * Shorten a raw model ID into something readable.
 * Falls back to the raw ID if unrecognized.
 */
export function formatModelName(modelId: string | undefined): string {
  if (!modelId) return "— not set —";
  const id = modelId.toLowerCase();
  if (id.startsWith("gemini-2.5-flash")) return "Gemini 2.5 Flash";
  if (id.startsWith("gemini-2.5-pro")) return "Gemini 2.5 Pro";
  if (id.startsWith("gemini-2.0-flash")) return "Gemini 2.0 Flash";
  if (id.startsWith("gemini-")) return modelId.replace("gemini-", "Gemini ");
  if (id.startsWith("claude-haiku")) return "Claude Haiku";
  if (id.startsWith("claude-sonnet")) return "Claude Sonnet";
  if (id.startsWith("claude-opus")) return "Claude Opus";
  if (id.startsWith("gpt-")) return modelId.toUpperCase();
  return modelId;
}
