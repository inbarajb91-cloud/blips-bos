import type { ZodSchema } from "zod";
import type { AgentKey } from "@/lib/ai/types";

/**
 * Skill contract — every agent skill implements this.
 *
 * A skill file is pure data + typing:
 *   - Its system prompt (static brand context + stage instructions)
 *   - Its output schema (Zod — validated before any DB write)
 *   - Its input schema (Zod — what the caller must provide)
 *   - Tools if it needs them (Phase 6+ — BUNKER uses Reddit, RSS, Trends, NewsAPI)
 *
 * The model + temperature come from `config_agents` at runtime (not from the
 * skill file), so swapping provider is a config update, not a code edit.
 */
export interface Skill<TInput, TOutput> {
  name: AgentKey;

  /** Short description for UI + docs. */
  description: string;

  /** Zod schema the caller must satisfy. */
  inputSchema: ZodSchema<TInput>;

  /** Zod schema the LLM output must satisfy. */
  outputSchema: ZodSchema<TOutput>;

  /**
   * System prompt. Static brand context lives here; goes first so prompt
   * caching can reuse it across calls.
   */
  systemPrompt: string;

  /**
   * Given an input, produce the user prompt for this call.
   * Keeps the dynamic part of the prompt separate from the cached static prompt.
   */
  buildPrompt(input: TInput): string;

  /**
   * Optional tool definitions (Phase 6+ use case).
   * Signature matches Vercel AI SDK `tool()` schema when provided.
   */
  tools?: Record<string, unknown>;
}
