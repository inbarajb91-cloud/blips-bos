import Parser from "rss-parser";
import type { SourceConnector, RawCandidate } from "./types";
import { db, configAgents } from "@/db";
import { and, eq } from "drizzle-orm";

/**
 * RSS connector — fetches configured feeds via rss-parser.
 *
 * rss-parser handles both RSS 2.0 and Atom formats, extracts title/link/
 * pubDate/contentSnippet/content from each item, normalizes into a
 * consistent shape.
 *
 * Config read from `config_agents.BUNKER.rss_feeds` (jsonb array of feed
 * URLs) and `rss_limit_per_feed` (defaults 2).
 */

const parser = new Parser({
  headers: {
    "User-Agent": "blips-bos-bunker/0.1 (contact helm@blipsstore.com)",
  },
  timeout: 10_000, // 10s per feed; skip slow/dead feeds
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

async function readConfigNumber(
  orgId: string,
  key: string,
  fallback: number,
): Promise<number> {
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
  if (typeof row?.value === "number") return row.value as number;
  return fallback;
}

export const fetchRssCandidates: SourceConnector = async ({ orgId }) => {
  const feeds = await readConfigArray(orgId, "rss_feeds", [
    "https://aeon.co/feed.rss",
    "https://www.theatlantic.com/feed/channel/ideas/",
  ]);
  const limitPerFeed = await readConfigNumber(orgId, "rss_limit_per_feed", 2);

  const out: RawCandidate[] = [];

  for (const feedUrl of feeds) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const items = (feed.items ?? []).slice(0, limitPerFeed);

      for (const item of items) {
        const title = (item.title ?? "").trim();
        const body =
          (item.contentSnippet ?? item.content ?? item.summary ?? "").trim();
        if (!title || body.length < 20) continue;

        out.push({
          source: "rss",
          title,
          body: body.slice(0, 2000),
          url: item.link,
          metadata: {
            feed_title: feed.title,
            feed_url: feedUrl,
            author: item.creator ?? item.author,
            categories: item.categories,
          },
          publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
        });
      }
    } catch (e) {
      console.error(
        `[rss] ${feedUrl} fetch/parse failed:`,
        (e as Error).message,
      );
      continue;
    }
  }

  return out;
};
