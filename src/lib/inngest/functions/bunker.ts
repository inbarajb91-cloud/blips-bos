import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { runSkill } from "@/lib/orc/orchestrator";
import { db, bunkerCandidates, signals, type agentOutputs } from "@/db";
import { computeContentHash } from "@/lib/sources/dedup";
import { logAgentCall } from "@/lib/ai/logger";
import { fetchMockCandidates } from "@/lib/sources/mock";
import type { SourceConnector, RawCandidate } from "@/lib/sources/types";
import type { BunkerInput, BunkerOutput } from "@/skills/bunker";

/**
 * BUNKER — signal collection Inngest functions.
 *
 * Two entry points per ARCHITECTURE.md event table:
 *   - bunker.collection.scheduled — Inngest cron trigger (every 6h default)
 *   - bunker.collection.on_demand — user-fired via Bridge "Collect now" button
 *
 * Both share the same runner: iterate enabled sources, fetch raw candidates,
 * dedup via content hash, run BUNKER skill on new items only, insert to
 * bunker_candidates with status PENDING_REVIEW. Bridge's triage queue shows
 * them live via Realtime subscription.
 *
 * Phase 6: sources plumbed in order of unlock — mock first (always on in
 * dev), RSS next (no credential needed), then Reddit + NewsAPI + Trends
 * as their credentials land. `fetchMockCandidates` below stands in until
 * real sources are wired.
 */

// ─── Source registry — maps source key → connector function ──────
// As each real connector ships, add it here. Runtime source selection
// reads from config_agents.BUNKER.sources_enabled.
const SOURCES: Record<string, SourceConnector> = {
  mock: fetchMockCandidates,
  // rss: fetchRssCandidates,       // Phase 6, no credential
  // trends: fetchTrendsCandidates, // Phase 6, no credential
  // reddit: fetchRedditCandidates, // Phase 6, needs credential
  // newsapi: fetchNewsApiCandidates, // Phase 6, needs credential
};

/**
 * Core runner. Iterates enabled sources, dedups, extracts, persists.
 * Returns per-run stats for observability.
 */
async function runBunkerCollection(params: {
  orgId: string;
  sources?: string[];
  limit?: number;
}) {
  const { orgId, sources, limit = 20 } = params;
  const enabledSources = sources ?? Object.keys(SOURCES);

  let fetched = 0;
  let deduped = 0;
  let extracted = 0;
  let errors = 0;
  const candidates: Array<{ id: string; shortcode: string }> = [];

  for (const sourceKey of enabledSources) {
    const connector = SOURCES[sourceKey];
    if (!connector) {
      console.warn(`[BUNKER] unknown source: ${sourceKey}`);
      continue;
    }

    let raw: RawCandidate[] = [];
    try {
      raw = await connector({ orgId, limit });
    } catch (e) {
      console.error(`[BUNKER] ${sourceKey} fetch failed:`, (e as Error).message);
      errors++;
      continue;
    }
    fetched += raw.length;

    for (const item of raw) {
      const contentHash = computeContentHash({
        url: item.url,
        title: item.title,
        body: item.body,
      });

      // Dedup — unique(org_id, content_hash) catches repeats in Postgres.
      // Check first so we don't waste BUNKER LLM call on known dupes.
      const [existing] = await db
        .select({ id: bunkerCandidates.id })
        .from(bunkerCandidates)
        .where(
          and(
            eq(bunkerCandidates.orgId, orgId),
            eq(bunkerCandidates.contentHash, contentHash),
          ),
        )
        .limit(1);
      if (existing) {
        deduped++;
        continue;
      }

      // Run BUNKER skill. Signal doesn't exist yet (this IS the candidate
      // creation step), so we create a disposable signalId shell to satisfy
      // orchestrator's FK requirement for agent_logs — but don't persist it
      // to signals table. Candidate gets its own id below.
      //
      // Actually, runSkill writes to agent_outputs which FKs to signals —
      // for BUNKER pre-approval, we skip the agent_outputs write and just
      // insert the candidate directly. See "BUNKER is different" note in
      // the orchestrator / ARCHITECTURE.md.
      let bunkerOutput: BunkerOutput;
      try {
        const result = await runBunkerExtract({
          orgId,
          input: {
            source: item.source,
            title: item.title,
            body: item.body,
            url: item.url,
            metadata: item.metadata,
          },
        });
        bunkerOutput = result;
        extracted++;
      } catch (e) {
        console.error(`[BUNKER] extraction failed:`, (e as Error).message);
        errors++;
        continue;
      }

      // Persist candidate row
      const [row] = await db
        .insert(bunkerCandidates)
        .values({
          orgId,
          shortcode: bunkerOutput.shortcode,
          workingTitle: bunkerOutput.working_title,
          concept: bunkerOutput.concept,
          source: item.source,
          rawText: item.body.slice(0, 2000),
          rawMetadata: {
            ...item.metadata,
            url: item.url,
            source_context: bunkerOutput.source_context,
          },
          contentHash,
          status: "PENDING_REVIEW",
        })
        .returning({
          id: bunkerCandidates.id,
          shortcode: bunkerCandidates.shortcode,
        });
      candidates.push(row);
    }
  }

  return {
    sources: enabledSources,
    fetched,
    deduped,
    extracted,
    errors,
    candidateIds: candidates,
  };
}

/**
 * Thin wrapper around generateStructured for BUNKER extraction.
 * BUNKER is different from later stages (STOKER/FURNACE/etc.) — those take
 * a signal and write to agent_outputs, but BUNKER creates candidates which
 * are pre-signal. So we bypass the orchestrator's agent_outputs write and
 * call the LLM directly with the skill's schemas + prompt.
 */
async function runBunkerExtract(params: {
  orgId: string;
  input: BunkerInput;
}): Promise<BunkerOutput> {
  const { generateStructured } = await import("@/lib/ai/generate");
  const { loadSkill } = await import("@/skills");
  const skill = loadSkill<BunkerInput, BunkerOutput>("BUNKER");

  const result = await generateStructured<BunkerOutput>({
    agentKey: "BUNKER",
    orgId: params.orgId,
    system: skill.systemPrompt,
    prompt: skill.buildPrompt(skill.inputSchema.parse(params.input)),
    schema: skill.outputSchema,
  });

  return result.object;
}

// ─── Inngest functions ───────────────────────────────────────────

/**
 * Scheduled BUNKER collection — fires every 6 hours by default.
 * Interval configurable later via config_engine_room (not yet wired).
 */
export const bunkerCollectionScheduled = inngest.createFunction(
  {
    id: "bunker-collection-scheduled",
    triggers: [{ cron: "0 */6 * * *" }],
  },
  async ({ step }) => {
    // For now, single-org — BLIPS. Multi-org rollout queries orgs + fans out.
    const orgId = await step.run("resolve-blips-org", async () => {
      const { orgs } = await import("@/db");
      const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
      if (!org) throw new Error("BLIPS org not found — seed not run?");
      return org.id;
    });

    const stats = await step.run("run-collection", async () => {
      return await runBunkerCollection({ orgId });
    });

    return stats;
  },
);

/**
 * On-demand BUNKER collection — fired from the Bridge "Collect now" button.
 * User can restrict to specific sources via event data.
 */
export const bunkerCollectionOnDemand = inngest.createFunction(
  {
    id: "bunker-collection-on-demand",
    triggers: [{ event: "bunker.collection.on_demand" }],
  },
  async ({ event, step }) => {
    const data = event.data as { orgId: string; sources?: string[] };
    const stats = await step.run("run-collection", async () => {
      return await runBunkerCollection({
        orgId: data.orgId,
        sources: data.sources,
      });
    });
    return stats;
  },
);
