/**
 * Sync gaps between OLD and NEW Supabase project after the May 9 migration.
 *
 * Diffs found:
 *   1. signal_source enum missing 'llm_synthesis' + 'grounded_search' (Phase 6.6)
 *   2. supabase_realtime publication missing 'collections' + 'collection_runs'
 *   3. config_agents missing ~15 rows: model_fallback_chain for every agent,
 *      image_model + image_model_fallback_chain for BOILER, BUNKER's source
 *      configs (reddit subs, RSS feeds, trends geos, LLM synthesis topics).
 *
 * Idempotent — safe to re-run.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const envFile = readFileSync(
  "/Users/inbaraj/blips-bos/.env.local",
  "utf-8",
);
for (const line of envFile.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  const v = t
    .slice(eq + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!process.env[k]) process.env[k] = v;
}

// Config agent rows pulled from old project (Phase 3.5 + Phase 6 + Phase 6.6 + Phase 11A additions).
// Values are JSONB; we serialize via JSON.stringify in the INSERT.
const CONFIG_AGENT_ROWS: Array<{
  agent: string;
  key: string;
  value: unknown;
}> = [
  // Phase 3.5 — fallback chains for every agent
  {
    agent: "ORC",
    key: "model_fallback_chain",
    value: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    agent: "BUNKER",
    key: "model_fallback_chain",
    value: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
  },
  {
    agent: "STOKER",
    key: "model_fallback_chain",
    value: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
  },
  {
    agent: "FURNACE",
    key: "model_fallback_chain",
    value: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    agent: "BOILER",
    key: "model_fallback_chain",
    value: [
      "claude-sonnet-4.7",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
    ],
  },
  {
    agent: "ENGINE",
    key: "model_fallback_chain",
    value: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  {
    agent: "PROPELLER",
    key: "model_fallback_chain",
    value: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
  },
  // Phase 11A — BOILER image model + chain
  { agent: "BOILER", key: "image_model", value: "imagen-4.0-generate-001" },
  {
    agent: "BOILER",
    key: "image_model_fallback_chain",
    value: [
      "imagen-4.0-generate-001",
      "gemini-2.5-flash-image",
      "imagen-4.0-fast-generate-001",
    ],
  },
  // Phase 6 + 6.6 — BUNKER source configs (these are LIVE-DRIVING values; without
  // them BUNKER doesn't know what to scrape)
  { agent: "BUNKER", key: "reddit_limit_per_sub", value: 3 },
  {
    agent: "BUNKER",
    key: "reddit_subreddits",
    value: [
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
      "chennai",
      "india",
      "IndianWorkplace",
      "IndianFIRE",
      "fatFIRE_India",
      "TwoXIndia",
      "IndianParenting",
    ],
  },
  {
    agent: "BUNKER",
    key: "rss_feeds",
    value: [
      "https://aeon.co/feed.rss",
      "https://psyche.co/feed.rss",
      "https://www.theatlantic.com/feed/channel/ideas/",
      "https://stratechery.com/feed/",
      "https://www.notboring.co/feed",
      "https://fs.blog/feed/",
      "https://www.lennysnewsletter.com/feed",
      "http://www.aaronsw.com/2002/feeds/pgessays.rss",
      "https://www.thehindu.com/feeder/default.rss",
      "https://indianexpress.com/feed/",
      "https://ankurwarikoo.substack.com/feed",
      "https://feeds.npr.org/1039/rss.xml",
      "https://www.filmcompanion.in/feed",
    ],
  },
  { agent: "BUNKER", key: "rss_limit_per_feed", value: 2 },
  { agent: "BUNKER", key: "trends_geos", value: ["IN", "US"] },
  { agent: "BUNKER", key: "llm_synthesis_temperature", value: 0.3 },
  {
    agent: "BUNKER",
    key: "llm_synthesis_topics",
    value: [
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
    ],
  },
  { agent: "BUNKER", key: "llm_synthesis_topics_per_run", value: 2 },
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  try {
    // Step 1 — signal_source enum additions
    console.log("→ Adding missing signal_source enum values...");
    await sql`ALTER TYPE signal_source ADD VALUE IF NOT EXISTS 'llm_synthesis'`;
    await sql`ALTER TYPE signal_source ADD VALUE IF NOT EXISTS 'grounded_search'`;
    const r1 =
      (await sql`SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'signal_source') ORDER BY enumsortorder`) as Array<{
        enumlabel: string;
      }>;
    console.log(
      `  ✓ signal_source now has ${r1.length} values:`,
      r1.map((r) => r.enumlabel).join(", "),
    );

    // Step 2 — Realtime publication
    console.log("\n→ Adding collections + collection_runs to realtime...");
    for (const t of ["collections", "collection_runs"]) {
      const has = await sql`SELECT 1 FROM pg_publication_tables
                            WHERE pubname = 'supabase_realtime' AND tablename = ${t}`;
      if (has.length === 0) {
        await sql.unsafe(`ALTER PUBLICATION supabase_realtime ADD TABLE ${t}`);
        console.log(`  + ${t} added`);
      } else {
        console.log(`  ~ ${t} already in publication`);
      }
    }
    const r2 =
      (await sql`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY tablename`) as Array<{
        tablename: string;
      }>;
    console.log(
      `  ✓ Realtime publication (${r2.length} tables):`,
      r2.map((r) => r.tablename).join(", "),
    );

    // Step 3 — config_agents row inserts
    console.log("\n→ Inserting missing config_agents rows...");
    const [org] =
      (await sql`SELECT id FROM orgs WHERE slug = 'blips' LIMIT 1`) as Array<{
        id: string;
      }>;
    if (!org) {
      throw new Error("BLIPS org not found — run scripts/seed.ts first");
    }
    let inserted = 0;
    let skipped = 0;
    for (const row of CONFIG_AGENT_ROWS) {
      const existing = await sql`
        SELECT 1 FROM config_agents
        WHERE org_id = ${org.id} AND agent_name = ${row.agent}::agent_name AND key = ${row.key}
      `;
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      await sql`
        INSERT INTO config_agents (org_id, agent_name, key, value)
        VALUES (${org.id}, ${row.agent}::agent_name, ${row.key}, ${JSON.stringify(row.value)}::jsonb)
      `;
      console.log(`  + ${row.agent}.${row.key}`);
      inserted++;
    }
    console.log(
      `  ✓ Inserted ${inserted}, skipped ${skipped} (already present)`,
    );

    // Final verification
    const final =
      (await sql`SELECT agent_name, COUNT(*)::int AS c FROM config_agents GROUP BY agent_name ORDER BY agent_name`) as Array<{
        agent_name: string;
        c: number;
      }>;
    console.log(`\n✓ Final config_agents row counts:`);
    final.forEach((r) => console.log(`    ${r.agent_name}: ${r.c}`));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
