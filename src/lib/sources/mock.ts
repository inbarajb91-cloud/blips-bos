import type { SourceConnector, RawCandidate } from "./types";

/**
 * Mock source for Phase 6 dev + eval harness.
 *
 * Returns a curated set of brand-relevant raw candidates — things that
 * actually echo BLIPS's cultural tension vocabulary (work/rest/identity,
 * quiet rebellion, post-digital fatigue). Used to exercise the BUNKER
 * extraction pipeline before Reddit / RSS / NewsAPI credentials are wired.
 *
 * Not shipped to production — only dev scripts import this.
 */
const FIXTURES: RawCandidate[] = [
  {
    source: "direct",
    title: "'Revenge bedtime procrastination' is finally getting named",
    body: "People who feel stripped of autonomy during the day are reclaiming the night — scrolling, watching, refusing to sleep. It's self-harming, it's comforting, it's a protest against a life they didn't choose. Researchers are starting to call it 'revenge bedtime procrastination' and it's a perfect emblem of 2026's quiet rebellion.",
    url: "https://example.com/revenge-bedtime",
    metadata: { fixture_id: "RBP", category: "burnout-coping" },
    publishedAt: new Date("2026-04-14T10:00:00Z"),
  },
  {
    source: "direct",
    title: "Quiet quitting evolved into 'resenteeism'",
    body: "Workers aren't leaving jobs they hate anymore. They're staying, bitter, watching the clock, refusing to go above and beyond. Loyalty is dead but the paycheck is good. It's a slower, meaner version of quiet quitting — resenteeism. Cultural observers note the shift reflects a deeper exhaustion with performed enthusiasm.",
    url: "https://example.com/resenteeism",
    metadata: { fixture_id: "RES", category: "work-culture" },
    publishedAt: new Date("2026-04-09T15:20:00Z"),
  },
  {
    source: "direct",
    title: "Gen Z is nostalgic for a pre-algorithmic internet they never had",
    body: "Teenagers in 2026 romanticize the 2008 web: forums, chronological feeds, personal blogs. They weren't alive for it. The nostalgia is for a version of online that felt human, unbossed, slow — before every scroll was optimized to extract attention. A quiet longing for a digital life that wasn't marketed at them.",
    url: "https://example.com/pre-algo-nostalgia",
    metadata: { fixture_id: "PRE", category: "digital-identity" },
    publishedAt: new Date("2026-03-28T08:00:00Z"),
  },
];

export const fetchMockCandidates: SourceConnector = async ({ limit = 50 }) => {
  // Simulate async fetch
  await new Promise((r) => setTimeout(r, 50));
  return FIXTURES.slice(0, limit);
};
