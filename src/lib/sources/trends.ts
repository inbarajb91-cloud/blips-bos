import Parser from "rss-parser";
import type { SourceConnector, RawCandidate } from "./types";
import { db, configAgents } from "@/db";
import { and, eq } from "drizzle-orm";

/**
 * Google Trends connector via public daily trends RSS.
 *
 *   https://trends.google.com/trending/rss?geo=IN
 *   https://trends.google.com/trending/rss?geo=US
 *
 * Returns the day's top trending searches for that geo — no auth, no API key.
 * Items include the search term as title, and related-news snippets in
 * description/content.
 *
 * Config read from `config_agents.BUNKER.trends_geos` (jsonb array of ISO
 * country codes, defaults ["IN", "US"]).
 */

const parser = new Parser({
  headers: {
    "User-Agent": "blips-bos-bunker/0.1 (contact helm@blipsstore.com)",
  },
  timeout: 10_000,
});

async function readConfigArray(
  orgId: string,
  key: string,
  fallback: string[],
): Promise<string[]> {
  const [row] = await db
    .select({ value: configAgents.value })
    .from(configAgents)
    .where(
      and(
        eq(configAgents.orgId, orgId),
        eq(configAgents.agentName, "BUNKER"),
        eq(configAgents.key, key),
      ),
    );
  if (Array.isArray(row?.value)) return row.value as string[];
  return fallback;
}

export const fetchTrendsCandidates: SourceConnector = async ({ orgId }) => {
  const geos = await readConfigArray(orgId, "trends_geos", ["IN", "US"]);
  const out: RawCandidate[] = [];

  for (const geo of geos) {
    try {
      const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
      const feed = await parser.parseURL(url);

      // Take top 5 per geo; more is noise (cricket scores, movie names, etc.
      // that BUNKER would reject anyway)
      const items = (feed.items ?? []).slice(0, 5);

      for (const item of items) {
        const title = (item.title ?? "").trim();
        const body = (item.contentSnippet ?? item.content ?? "").trim();
        if (!title) continue;
        // Some trending items have no body; use title as body so BUNKER can
        // still reason about the topic
        const finalBody = body.length > 20 ? body : title;

        out.push({
          source: "trends",
          title,
          body: finalBody.slice(0, 2000),
          url: item.link,
          metadata: {
            geo,
            trending_since: item.isoDate,
          },
          publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
        });
      }
    } catch (e) {
      console.error(
        `[trends] geo=${geo} fetch failed:`,
        (e as Error).message,
      );
      continue;
    }
  }

  return out;
};
