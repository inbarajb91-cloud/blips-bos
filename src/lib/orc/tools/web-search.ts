import { tool } from "ai";
import { z } from "zod";
import { getWebSearchBackend } from "@/lib/orc/web-search";
import { logAgentCall } from "@/lib/ai/logger";
import type { OrcToolContext } from "./types";

/**
 * web_search — let ORC look things up on the live web.
 *
 * A swappable backend (default: Gemini grounded search) runs as a
 * contained subroutine; the result returned to ORC is a bounded digest
 * + source list. ORC quotes from the digest in its reply and cites the
 * sources — it must never claim a web fact it didn't pull through this
 * tool, and must never invent URLs.
 *
 * Backend lives at src/lib/orc/web-search/. Swapping the default
 * (Anthropic web_search subroutine, Tavily, etc.) is a one-file change
 * to src/lib/orc/web-search/index.ts.
 *
 * Why this is a custom tool with a backend rather than a provider-
 * native search tool bound into ORC's stream: ORC's chat model is
 * configurable and has a fallback chain (Phase 3.5). A native tool
 * binds to one provider; the OpenAI-compatible providers in the
 * registry have no native search at all. This pattern gives ORC ONE
 * consistent search capability regardless of which model it's running.
 *
 * Cost: ~$0.03 per call on the default Gemini-grounded backend (the
 * grounded-search fee dominates over Flash inference). Logged to
 * agent_logs as a 'tool_call' so per-org observability lands in the
 * same place as every other ORC LLM call.
 */
export function webSearch(ctx: OrcToolContext) {
  return tool({
    description:
      "Search the live web. Use when (a) the user explicitly asks you to look something up / check online / research a topic, OR (b) you hit a concept or current fact you genuinely cannot reason about from context, memory, or your training. DO NOT use for things you already know — search is for new / current / verifiable information. Returns a concise digest + cited sources. Quote the digest in your reply and cite the sources by URL — never claim a web fact you didn't pull through this tool, and never fabricate a URL.",
    inputSchema: z.object({
      query: z
        .string()
        .min(3)
        .max(300)
        .describe(
          "What to search for. Phrase as a direct question or specific topic — e.g. 'what is the FUEGO design movement', 'recent press on indigo selvedge denim 2026'. Avoid vague queries.",
        ),
    }),
    execute: async ({ query }) => {
      const start = Date.now();
      const backend = getWebSearchBackend();
      const result = await backend.search(query);

      // Best-effort observability log. Fire-and-forget pattern matches
      // the orchestrator's stage-completion memory hook — slow logging
      // cannot extend the tool call's wall-clock cost.
      //
      // Logged as 'llm_call' (the constrained AgentLogAction values
      // don't include 'tool_call' — and semantically this IS an LLM
      // call: the backend runs a grounded generateText against Gemini
      // Flash). `metadata.tool` distinguishes it in queries. Cost is
      // approximated at $0.03 — the documented grounded-search fee
      // from src/lib/sources/grounded-search.ts, dominant over Flash
      // inference. Not exact, but close enough for usage tracking;
      // skipped entirely for the degraded path (no API call made).
      void logAgentCall({
        orgId: ctx.orgId,
        signalId: ctx.signalId,
        journeyId: ctx.journeyId,
        agentName: "ORC",
        action: "llm_call",
        model: "gemini-2.5-flash",
        costUsd: result.degraded ? 0 : 0.03,
        durationMs: Date.now() - start,
        status: result.degraded ? "error" : "success",
        metadata: {
          tool: "web_search",
          query: result.query,
          source_count: result.sources.length,
          digest_chars: result.digest.length,
          degraded: Boolean(result.degraded),
        },
      });

      return result;
    },
  });
}
