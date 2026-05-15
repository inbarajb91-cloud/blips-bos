import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type {
  WebSearchBackend,
  WebSearchResult,
  WebSearchSource,
} from "./types";

/**
 * Gemini grounded search — default WebSearchBackend.
 *
 * Calls Gemini 2.5 Flash with `googleSearch` as a *contained subroutine*
 * — independent of whatever chat model ORC itself is running this turn.
 * Same provider-tool pattern BUNKER's reference mode uses
 * (src/lib/sources/grounded-search.ts), but with a neutral research
 * system prompt and a bounded-digest output shape suitable for re-entry
 * into ORC's per-turn context.
 *
 * Cost: ~$0.03 per call (the grounded-search fee dominates over the
 * ~$0.001 Flash inference). Founder-scale usage is negligible — ORC
 * only calls this when it explicitly needs to look something up.
 *
 * Result safety:
 *   - Digest capped at MAX_DIGEST_CHARS (truncated defensively after
 *     the model returns).
 *   - Sources capped at MAX_SOURCES.
 *   - Throwing is forbidden — failures return a degraded result.
 *
 * Why hard-coded `gemini-2.5-flash` rather than the agent-config router:
 * this is a *subroutine*, not ORC's brain. The grounded-search call's
 * job is "fetch live web content + produce a tight digest" — a fixed
 * model that's known to behave well with grounded-search keeps the
 * subroutine stable regardless of how ORC's chat model gets reconfigured.
 * Same reasoning as the existing BUNKER grounded-search.ts.
 *
 * Why we DON'T request structured JSON output: Gemini in grounded-search
 * mode reliably ignores strict-format instructions (verified via
 * scripts/verify-orc-web-search.ts on the first iteration — every
 * response came back as conversational prose despite an explicit
 * "ONLY JSON" prompt). Same area Phase 10G's MEMORY.md flagged:
 * Gemini structured-output + provider tools don't mix well. Taking the
 * prose response as-is + extracting sources from grounding metadata is
 * the reliable shape.
 */

const SYSTEM_PROMPT = `You are a research assistant. You receive a single search query and produce a concise factual digest from live web content.

OUTPUT:
- One to three short paragraphs of plain prose, neutral tone.
- Synthesize what you found into a useful summary — describe the substance, not "I searched for".
- Maximum ~1500 characters.
- No editorializing ("Interestingly,", "Notably,", etc.). Just the facts.
- No marketing copy lifted from source pages — extract substance.
- If the query is ambiguous or returns no useful results, say so plainly. Do not fabricate.

Source URLs are extracted automatically from the grounding metadata — do NOT list them inline in your prose.`;

const MAX_DIGEST_CHARS = 1500;
const MAX_SOURCES = 8;

/**
 * Pull source URLs out of `result.providerMetadata.google` after a
 * grounded-search call. The AI SDK surfaces grounded-search citations
 * as `groundingChunks: [{ web: { uri, title } }, ...]`. The exact
 * nesting varies slightly across @ai-sdk/google versions — we try the
 * documented (nested) path first, then a flatter fallback. If neither
 * yields chunks, we log the actual structure once so the next iteration
 * can adapt the extractor to whatever the SDK is currently emitting.
 */
function extractSourcesFromMetadata(
  providerMetadata: unknown,
): WebSearchSource[] {
  if (!providerMetadata || typeof providerMetadata !== "object") return [];
  const pm = providerMetadata as Record<string, unknown>;
  const google = pm.google as Record<string, unknown> | undefined;
  if (!google || typeof google !== "object") return [];

  // Two shapes seen across SDK versions:
  //   (a) google.groundingMetadata.groundingChunks  — nested
  //   (b) google.groundingChunks                    — flat
  const gm = google.groundingMetadata as Record<string, unknown> | undefined;
  const chunksA = Array.isArray(gm?.groundingChunks)
    ? (gm!.groundingChunks as unknown[])
    : null;
  const chunksB = Array.isArray(google.groundingChunks)
    ? (google.groundingChunks as unknown[])
    : null;
  const chunks = chunksA ?? chunksB ?? [];

  if (chunks.length === 0) {
    console.warn(
      "[web-search/gemini-grounded] no groundingChunks at known paths; providerMetadata.google keys:",
      Object.keys(google),
    );
    return [];
  }

  const sources: WebSearchSource[] = chunks
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const web = (c as Record<string, unknown>).web;
      if (!web || typeof web !== "object") return null;
      const w = web as { uri?: unknown; title?: unknown };
      const url = typeof w.uri === "string" ? w.uri.trim() : "";
      const title = typeof w.title === "string" ? w.title.slice(0, 200).trim() : "";
      return url.length > 0 ? { title, url } : null;
    })
    .filter((s): s is WebSearchSource => s !== null)
    .slice(0, MAX_SOURCES);

  return sources;
}

class GeminiGroundedBackend implements WebSearchBackend {
  async search(query: string): Promise<WebSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        query,
        digest: "Empty query — nothing to search.",
        sources: [],
        degraded: true,
      };
    }

    try {
      // @ai-sdk/google v3.0+ exposes grounded search via the `tools`
      // API. Tool name MUST be `google_search` per provider contract
      // (same shape used in src/lib/sources/grounded-search.ts).
      //
      // We deliberately don't hoist `result` into an outer-scope let:
      // GenerateTextResult parameterised with a specific ToolSet doesn't
      // widen cleanly to the generic ToolSet type, and there's no need
      // — every consumer of the result lives inside this try block.
      const result = await generateText({
        model: google("gemini-2.5-flash"),
        tools: {
          google_search: google.tools.googleSearch({}),
        },
        system: SYSTEM_PROMPT,
        prompt: `SEARCH QUERY: ${trimmed}\n\nRun grounded web search now and return a concise factual digest per the instructions.`,
        temperature: 0.2,
      });

      // Take the prose response directly. Bound to MAX_DIGEST_CHARS in
      // case Gemini ignored the soft cap in the prompt.
      const digest = (result.text ?? "").trim().slice(0, MAX_DIGEST_CHARS);
      const sources = extractSourcesFromMetadata(result.providerMetadata);

      if (!digest) {
        return {
          query: trimmed,
          digest:
            "Web search returned no usable digest. Try a more specific query.",
          sources,
          degraded: true,
        };
      }

      return {
        query: trimmed,
        digest,
        sources,
      };
    } catch (e) {
      console.error(
        "[web-search/gemini-grounded] grounded search call failed:",
        (e as Error).message,
      );
      return {
        query: trimmed,
        digest:
          "Web search is currently unavailable (Gemini grounded search call failed). Try again or proceed without external sources.",
        sources: [],
        degraded: true,
      };
    }
  }
}

export function createGeminiGroundedBackend(): WebSearchBackend {
  return new GeminiGroundedBackend();
}
