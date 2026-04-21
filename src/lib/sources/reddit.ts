import type { SourceConnector, RawCandidate } from "./types";
import { db, configAgents } from "@/db";
import { and, eq } from "drizzle-orm";

const USER_AGENT = "blips-bos-bunker/0.1 (contact helm@blipsstore.com)";

/**
 * Reddit connector — uses public JSON endpoints, no OAuth.
 *
 * For each configured subreddit, fetches the top posts of the day:
 *   https://www.reddit.com/r/<sub>/top.json?limit=N&t=day
 *
 * Reddit rate-limits ~60 req/min per IP. Our volume: N subreddits × 1 request
 * each per 6h cron run = far below the limit.
 *
 * Config read from `config_agents.BUNKER.reddit_subreddits` (jsonb array of
 * subreddit names) and `reddit_limit_per_sub` (defaults 3).
 */

interface RedditPostData {
  title: string;
  selftext?: string;
  url?: string;
  permalink?: string;
  subreddit: string;
  author?: string;
  ups?: number;
  num_comments?: number;
  created_utc?: number;
  over_18?: boolean;
  stickied?: boolean;
  is_self?: boolean;
}

interface RedditListing {
  data: {
    children: Array<{ kind: string; data: RedditPostData }>;
  };
}

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

export const fetchRedditCandidates: SourceConnector = async ({ orgId }) => {
  const subs = await readConfigArray(orgId, "reddit_subreddits", [
    "chennai",
    "india",
    "IndianWorkplace",
    "antiwork",
    "AskMenOver30",
  ]);
  const limitPerSub = await readConfigNumber(orgId, "reddit_limit_per_sub", 3);

  const out: RawCandidate[] = [];

  for (const sub of subs) {
    try {
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?limit=${limitPerSub}&t=day`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        console.warn(`[reddit] /r/${sub} returned ${res.status}`);
        continue;
      }
      const json = (await res.json()) as RedditListing;

      for (const item of json.data?.children ?? []) {
        const p = item.data;
        if (!p || p.stickied || p.over_18) continue;
        const title = (p.title ?? "").trim();
        const selftext = (p.selftext ?? "").trim();
        // Skip link-only posts without any text body
        const body = selftext.length > 20 ? selftext : title;
        if (!title || body.length < 20) continue;

        out.push({
          source: "reddit",
          title,
          body: body.slice(0, 2000),
          url: p.permalink
            ? `https://reddit.com${p.permalink}`
            : p.url,
          metadata: {
            subreddit: p.subreddit,
            author: p.author,
            upvotes: p.ups,
            num_comments: p.num_comments,
            is_self: p.is_self,
          },
          publishedAt:
            typeof p.created_utc === "number"
              ? new Date(p.created_utc * 1000)
              : undefined,
        });
      }
    } catch (e) {
      console.error(`[reddit] /r/${sub} fetch failed:`, (e as Error).message);
      continue;
    }
  }

  return out;
};
