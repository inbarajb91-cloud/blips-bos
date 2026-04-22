import { and, eq, lte, sql } from "drizzle-orm";
import { inngest } from "../client";
import {
  db,
  bunkerCandidates,
  collections,
  collectionRuns,
} from "@/db";
import { computeContentHash } from "@/lib/sources/dedup";
import { fetchMockCandidates } from "@/lib/sources/mock";
import { fetchRedditCandidates } from "@/lib/sources/reddit";
import { fetchRssCandidates } from "@/lib/sources/rss";
import { fetchTrendsCandidates } from "@/lib/sources/trends";
import { fetchLlmSynthesisCandidates } from "@/lib/sources/llm-synthesis";
import { fetchGroundedSearchCandidates } from "@/lib/sources/grounded-search";
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
  reddit: fetchRedditCandidates,
  rss: fetchRssCandidates,
  trends: fetchTrendsCandidates,
  llm_synthesis: fetchLlmSynthesisCandidates,
};

/**
 * Core runner. Iterates enabled sources, dedups, extracts, persists.
 * Returns per-run stats for observability.
 *
 * Exported so scripts/test-bunker-real.ts can exercise it directly without
 * going through the Inngest event bus.
 */
export async function runBunkerCollection(params: {
  orgId: string;
  sources?: string[];
  limit?: number;
  collectionId?: string; // Phase 6.5: if present, tag every candidate with it
  // Phase 6.6: if reference mode, the runner ignores `sources` (standing 5)
  // and dispatches grounded-search only, driven by the collection's outline.
  searchMode?: "trend" | "reference";
  outline?: string | null;
  decadeHint?: "any" | "RCK" | "RCL" | "RCD";
}) {
  const {
    orgId,
    sources,
    limit = 20,
    collectionId,
    searchMode = "trend",
    outline,
    decadeHint = "any",
  } = params;

  // In reference mode, grounded-search is the sole source. In trend mode,
  // use the standing 5 (or caller-specified subset).
  let fetchRawByKey: Record<
    string,
    () => Promise<RawCandidate[]>
  > = {};
  if (searchMode === "reference") {
    if (!outline || outline.trim().length < 10) {
      throw new Error(
        "Reference-mode collection missing outline (≥10 chars required).",
      );
    }
    fetchRawByKey = {
      grounded_search: () =>
        fetchGroundedSearchCandidates({
          orgId,
          outline: outline.trim(),
          decadeHint,
          targetCount: Math.min(limit + 2, 10), // over-fetch slightly for dedup headroom
        }),
    };
  } else {
    const enabled = sources ?? Object.keys(SOURCES);
    for (const key of enabled) {
      const connector = SOURCES[key];
      if (!connector) {
        console.warn(`[BUNKER] unknown source: ${key}`);
        continue;
      }
      fetchRawByKey[key] = () => connector({ orgId, limit });
    }
  }

  let fetched = 0;
  let deduped = 0;
  let extracted = 0;
  let errors = 0;
  const candidates: Array<{ id: string; shortcode: string }> = [];

  for (const sourceKey of Object.keys(fetchRawByKey)) {
    let raw: RawCandidate[] = [];
    try {
      raw = await fetchRawByKey[sourceKey]();
    } catch (e) {
      console.error(`[BUNKER] ${sourceKey} fetch failed:`, (e as Error).message);
      errors++;
      continue;
    }
    fetched += raw.length;

    for (const item of raw) {
      // Respect target_count: stop extracting once we've hit the goal.
      if (extracted >= limit) break;

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

      // Persist candidate row — stamped with collectionId when present.
      const [row] = await db
        .insert(bunkerCandidates)
        .values({
          orgId,
          collectionId: collectionId ?? null,
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
    sources: Object.keys(fetchRawByKey),
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
 * Legacy on-demand BUNKER collection — no collection context.
 * Phase 6.5: the Collect-now modal uses bunker.collection.run instead
 * (which runs a specific named collection). Kept for legacy callers.
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

/**
 * Phase 6.5 — Run BUNKER against a specific collection.
 * Fired by createCollection (Instant/Batch) or the scheduled-check cron.
 * Writes a collection_runs row for observability and updates the
 * collection's status + counters in lockstep with the run.
 *
 * Resilience: onFailure handler below flips the collection + its run back
 * to 'failed' if Inngest exhausts retries. Without this, a crashed run
 * (Gemini timeout, DB hiccup, etc.) leaves the collection stuck at
 * status='running' forever — Run now won't help because it gates on
 * !isActive. onFailure is Inngest's permanent-failure hook.
 */
export const bunkerCollectionRun = inngest.createFunction(
  {
    id: "bunker-collection-run",
    triggers: [{ event: "bunker.collection.run" }],
    onFailure: async ({ event, error }) => {
      const { orgId, collectionId } = (
        event as unknown as {
          data: { event: { data: { orgId: string; collectionId: string } } };
        }
      ).data.event.data;
      const msg = (error as Error)?.message?.slice(0, 500) ?? "unknown error";
      try {
        await db
          .update(collections)
          .set({ status: "failed", updatedAt: new Date() })
          .where(
            and(
              eq(collections.id, collectionId),
              eq(collections.orgId, orgId),
            ),
          );
        await db
          .update(collectionRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            errorMessage: msg,
          })
          .where(
            and(
              eq(collectionRuns.collectionId, collectionId),
              eq(collectionRuns.orgId, orgId),
              eq(collectionRuns.status, "running"),
            ),
          );
      } catch (cleanupErr) {
        console.error(
          "[bunker-collection-run] onFailure cleanup failed:",
          cleanupErr,
        );
      }
    },
  },
  async ({ event, step }) => {
    const { orgId, collectionId, count } = event.data as {
      orgId: string;
      collectionId: string;
      /** Optional per-run override from Regenerate. Bypasses
       *  collection.targetCount so the user can top up the triage pool
       *  without mutating the collection's original intent. */
      count?: number;
    };

    // Load collection + create run row, mark running.
    const { collection, runId } = await step.run("start-run", async () => {
      const [c] = await db
        .select()
        .from(collections)
        .where(
          and(eq(collections.id, collectionId), eq(collections.orgId, orgId)),
        )
        .limit(1);
      if (!c) throw new Error("Collection not found");

      const [run] = await db
        .insert(collectionRuns)
        .values({
          collectionId,
          orgId,
          status: "running",
          startedAt: new Date(),
        })
        .returning({ id: collectionRuns.id });

      await db
        .update(collections)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(collections.id, collectionId));

      return { collection: c, runId: run.id };
    });

    // Execute BUNKER run against this collection's target.
    // Phase 6.6: pass search_mode + outline + decade_hint so the runner
    // picks grounded-search (reference) vs standing-5 (trend) per collection.
    // Inngest's step.run types the result as unknown when the return object
    // shape isn't declared upfront — explicit annotation here keeps finalize-run
    // cleanly typed without a cast.
    type CollectStats = Awaited<ReturnType<typeof runBunkerCollection>>;
    const stats: CollectStats = await step.run("collect", async () => {
      return await runBunkerCollection({
        orgId,
        // Regenerate override wins when present; else use the collection's
        // original targetCount. Don't mutate collection.targetCount.
        limit: count ?? collection.targetCount,
        collectionId,
        searchMode: collection.searchMode,
        outline: collection.outline,
        decadeHint: collection.decadeHint,
      });
    });

    // Finalize run + update collection counters.
    await step.run("finalize-run", async () => {
      await db
        .update(collectionRuns)
        .set({
          status: stats.errors > 0 && stats.extracted === 0 ? "failed" : "idle",
          completedAt: new Date(),
          fetchedRaw: stats.fetched,
          deduped: stats.deduped,
          extracted: stats.extracted,
          errors: stats.errors,
        })
        .where(eq(collectionRuns.id, runId));

      // Compute nextRunAt for scheduled collections.
      const nextRunAt =
        collection.type === "scheduled" && collection.cadence
          ? cadenceToNextRun(collection.cadence)
          : null;

      await db
        .update(collections)
        .set({
          status: "idle",
          lastRunAt: new Date(),
          nextRunAt,
          candidateCount: sql`(SELECT count(*) FROM bunker_candidates WHERE collection_id = ${collectionId} AND org_id = ${orgId} AND status = 'PENDING_REVIEW')`,
          signalCount: sql`(SELECT count(*) FROM signals WHERE collection_id = ${collectionId} AND org_id = ${orgId})`,
          updatedAt: new Date(),
        })
        .where(and(eq(collections.id, collectionId), eq(collections.orgId, orgId)));
    });

    return { runId, ...stats };
  },
);

/**
 * Hourly cron — find scheduled collections whose next_run_at has passed,
 * fan out to bunker.collection.run for each.
 */
export const bunkerScheduledCheck = inngest.createFunction(
  {
    id: "bunker-scheduled-check",
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const due = await step.run("find-due", async () => {
      return await db
        .select({
          id: collections.id,
          orgId: collections.orgId,
          name: collections.name,
        })
        .from(collections)
        .where(
          and(
            eq(collections.type, "scheduled"),
            eq(collections.status, "idle"),
            lte(collections.nextRunAt, new Date()),
          ),
        );
    });

    for (const c of due) {
      await step.sendEvent("fire-run", {
        name: "bunker.collection.run",
        data: { orgId: c.orgId, collectionId: c.id },
      });
    }

    return { fired: due.length };
  },
);

function cadenceToNextRun(cadence: string): Date {
  const now = new Date();
  const next = new Date(now);
  switch (cadence) {
    case "daily":
      next.setDate(now.getDate() + 1);
      next.setHours(6, 0, 0, 0);
      break;
    case "weekly":
      next.setDate(now.getDate() + 7);
      next.setHours(6, 0, 0, 0);
      break;
    case "monthly":
      next.setMonth(now.getMonth() + 1);
      next.setHours(6, 0, 0, 0);
      break;
    case "custom":
      // Custom cron parsing deferred; schedule 1h out so hourly check picks it up.
      next.setHours(now.getHours() + 1);
      break;
    default:
      next.setDate(now.getDate() + 7);
  }
  return next;
}
