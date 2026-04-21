/**
 * Seed / update BUNKER source configuration for the BLIPS org.
 *
 * Idempotent — uses ON CONFLICT DO UPDATE so re-running replaces existing
 * source lists with the ones in this file (the source of truth).
 *
 * Config keys written:
 *   - sources_enabled       : { direct, reddit, rss, trends, llm_synthesis }
 *   - reddit_subreddits     : string[]
 *   - reddit_limit_per_sub  : number
 *   - rss_feeds             : string[]
 *   - rss_limit_per_feed    : number
 *   - trends_geos           : string[] (ISO country codes)
 *   - llm_synthesis_topics  : string[]
 *   - llm_synthesis_topics_per_run : number
 *   - llm_synthesis_temperature   : number
 *
 * Usage: npx tsx scripts/update-bunker-sources.ts
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

const envFile = readFileSync(".env.local", "utf-8");
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

const SOURCES_ENABLED = {
  direct: true,
  reddit: true,
  rss: true,
  trends: true,
  llm_synthesis: true,
};

const REDDIT_SUBREDDITS = [
  // Global universal
  "antiwork",
  "WorkReform",
  "LateStageCapitalism",
  "careerguidance",
  "productivity",
  "overemployed",
  "AskMenOver30",
  "AskWomenOver30",
  "AskOldPeople",
  "Parenting",
  "stopdrinking",
  "personalfinance",
  // Indian-specific
  "chennai",
  "india",
  "IndianWorkplace",
  "IndianFIRE",
  "fatFIRE_India",
  "TwoXIndia",
  "IndianParenting",
];

const REDDIT_LIMIT_PER_SUB = 3;

const RSS_FEEDS = [
  // Global cultural/intellectual
  "https://aeon.co/feed.rss",
  "https://psyche.co/feed.rss",
  "https://www.theatlantic.com/feed/channel/ideas/",
  // Global founder voices + career
  "https://stratechery.com/feed/",
  "https://www.notboring.co/feed",
  "https://fs.blog/feed/",
  "https://www.lennysnewsletter.com/feed",
  "https://every.to/feed.xml",
  "http://www.aaronsw.com/2002/feeds/pgessays.rss",
  "https://feeds.hbr.org/harvardbusiness",
  // Indian mainstream
  "https://www.thehindu.com/feeder/default.rss",
  "https://indianexpress.com/feed/",
  "https://feeds.feedburner.com/scroll-full",
  "https://thewire.in/rss",
  "https://lifestyle.livemint.com/lm-feed.rss",
  // Indian founder + intellectual
  "https://ankurwarikoo.substack.com/feed",
  "https://seenunseen.in/episodes/feed.xml",
  // Music
  "https://pitchfork.com/rss/reviews/albums/",
  "https://feeds.npr.org/1039/rss.xml",
  // Sports + culture
  "https://www.theringer.com/rss/index.xml",
  // Entertainment
  "https://www.filmcompanion.in/feed",
];

const RSS_LIMIT_PER_FEED = 2;

const TRENDS_GEOS = ["IN", "US"];

const LLM_SYNTHESIS_TOPICS = [
  "Indian urban professional loneliness at 30+",
  "Ambition vs. family expectation in urban India",
  "Indian mid-career women balancing the impossible",
  "Parenting pressure in Indian metros — kids, school, future",
  "Joint family vs. nuclear family tensions at 40",
  "Financial anxiety vs. family property expectations",
  "Work culture in Indian corporations vs. startups",
  "NRI guilt — staying in India or leaving at 35+",
  "Retirement anxiety in Indian joint-family systems",
  "Meaning in Indian careers after ambition burns out",
  "Marriage/dating after 35 in urban India",
  "Childfree by choice in Indian middle class",
  "Post-COVID identity shifts in urban India",
  "Late-career Indian men and emotional labor",
];

const LLM_SYNTHESIS_TOPICS_PER_RUN = 2;
const LLM_SYNTHESIS_TEMPERATURE = 0.3;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  try {
    const [org] = await sql<{ id: string }[]>`
      SELECT id FROM orgs WHERE slug = 'blips' LIMIT 1
    `;
    if (!org) {
      console.error("✗ BLIPS org not found. Run seed.ts first.");
      process.exit(1);
    }
    console.log(`✓ BLIPS org ${org.id}`);

    const upsert = async (key: string, value: unknown) => {
      await sql`
        INSERT INTO config_agents (org_id, agent_name, key, value)
        VALUES (${org.id}::uuid, 'BUNKER'::agent_name, ${key}, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT (org_id, agent_name, key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = now()
      `;
      console.log(`  ↻ ${key}`);
    };

    console.log("\nUpserting BUNKER source config:");
    await upsert("sources_enabled", SOURCES_ENABLED);
    await upsert("reddit_subreddits", REDDIT_SUBREDDITS);
    await upsert("reddit_limit_per_sub", REDDIT_LIMIT_PER_SUB);
    await upsert("rss_feeds", RSS_FEEDS);
    await upsert("rss_limit_per_feed", RSS_LIMIT_PER_FEED);
    await upsert("trends_geos", TRENDS_GEOS);
    await upsert("llm_synthesis_topics", LLM_SYNTHESIS_TOPICS);
    await upsert("llm_synthesis_topics_per_run", LLM_SYNTHESIS_TOPICS_PER_RUN);
    await upsert("llm_synthesis_temperature", LLM_SYNTHESIS_TEMPERATURE);

    console.log(`\n✓ Updated ${9} config keys for BUNKER`);
    console.log(`  ${REDDIT_SUBREDDITS.length} subreddits`);
    console.log(`  ${RSS_FEEDS.length} RSS feeds`);
    console.log(`  ${TRENDS_GEOS.length} Trends geos`);
    console.log(`  ${LLM_SYNTHESIS_TOPICS.length} LLM synthesis topics`);
  } catch (e) {
    console.error("✗ Failed:", (e as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
