import { and, eq, ilike } from "drizzle-orm";
import { inngest } from "../client";
import {
  db,
  signals as signalsTable,
  agentOutputs,
  knowledgeDocuments,
  signalStatus,
} from "@/db";
import { runSkill } from "@/lib/orc/orchestrator";
import { resolveShortcode } from "@/lib/signals/resolve-shortcode";
import { createInitialJourney } from "@/lib/orc/journey";
import "@/skills"; // ensure skill registry is populated
import type { StokerInput, StokerOutput } from "@/skills/stoker";

// CR nitpick on PR #8: type aliases sit AFTER the import block so
// there's a single contiguous import section. Prior shape had a type
// declaration sandwiched between import groups.
type SignalStatus = (typeof signalStatus.enumValues)[number];
type DecadeKey = "RCK" | "RCL" | "RCD";

/**
 * STOKER Inngest function — Phase 9C.
 *
 * Triggered by `bunker.candidate.approved`. Orchestrates the STOKER
 * pipeline stage end-to-end:
 *
 *   1. Move parent signal IN_BUNKER → IN_STOKER
 *   2. Fetch the three Decade Playbooks from knowledge_documents
 *   3. Build STOKER input + call the skill via runSkill (one LLM call,
 *      one agent_outputs row on the parent — the decade_resonance row
 *      that the parent's STOKER tab renderer reads)
 *   4. For each decade in the result with resonanceScore >= 50:
 *      - Mint a unique child shortcode (parent shortcode + decade suffix)
 *      - INSERT a child signal row (parent_signal_id + manifestation_decade
 *        SET, status IN_STOKER, source 'stoker_manifestation')
 *      - createInitialJourney for the child
 *      - INSERT the child's STOKER agent_outputs row carrying just that
 *        decade's framing (status PENDING for the per-card founder gate)
 *   5. Update parent status:
 *      - FANNED_OUT if at least one manifestation child created
 *      - STOKER_REFUSED if STOKER returned refused=true
 *      - (Won't reach a state where neither — the skill's refine()
 *        invariant guarantees refused iff all scores < 50.)
 *
 * Design alignment with Model 3 (agents/STOKER.md):
 *   - Manifestation IS a signal — same `signals` table, no separate
 *     manifestations table.
 *   - Each child gets its own journey (Phase 8 architecture). Parent's
 *     journey ends at FANNED_OUT.
 *   - Founder gate uses the existing pattern: signal at IN_STOKER +
 *     agent_outputs.status='PENDING' = "awaiting founder approval".
 *
 * Failure handling: each step uses Inngest's step.run() so transient
 * failures retry independently. If runSkill itself fails (LLM error,
 * fallback chain exhausted), the function fails and Inngest retries
 * per its default backoff. Parent stays at IN_STOKER until either the
 * retry succeeds or the function gives up.
 */
export const stokerProcess = inngest.createFunction(
  {
    id: "stoker-process",
    triggers: [{ event: "bunker.candidate.approved" }],
    // STOKER is bursty (founder approves a candidate, signal advances).
    // Keep concurrency small per-org so a wave of approvals doesn't
    // overload the LLM provider — Phase 9 eval may bump this up.
    concurrency: { limit: 4, key: "event.data.orgId" },
    onFailure: async ({ event }) => {
      // Trigger event from the parent failure carries the original event
      // shape. Rollback isn't possible here — STOKER's effects are split
      // across multiple step.run() boundaries. Best-effort: log so we can
      // recover manually if needed. Future: add a "STOKER stuck" signal
      // status + cron sweep that resets and retries.
      const data = (event.data as { event?: { data?: unknown } } | undefined)
        ?.event?.data;
      console.error(
        "[STOKER] onFailure — function exhausted retries:",
        JSON.stringify(data),
      );
    },
  },
  async ({ event, step }) => {
    const { orgId, signalId } = event.data;

    // ─── 1. Move parent IN_STOKER ───────────────────────────────
    const parent = await step.run("load-parent + flip-status", async () => {
      const [row] = await db
        .select()
        .from(signalsTable)
        .where(and(eq(signalsTable.id, signalId), eq(signalsTable.orgId, orgId)))
        .limit(1);
      if (!row) {
        throw new Error(
          `[STOKER] parent signal ${signalId} not found for org ${orgId}`,
        );
      }
      // Refuse to re-process a signal that already advanced past STOKER.
      // STOKER restart goes through the explicit restart_stoker tool
      // (Phase 9G), not via re-firing bunker.candidate.approved.
      if (
        row.status !== "IN_BUNKER" &&
        row.status !== "IN_STOKER"
      ) {
        throw new Error(
          `[STOKER] parent ${row.shortcode} is at status ${row.status}; refusing to re-process via bunker.candidate.approved`,
        );
      }
      // Don't write to children — manifestations have parent_signal_id set.
      // STOKER never recurses on its own outputs.
      if (row.parentSignalId !== null) {
        throw new Error(
          `[STOKER] signal ${row.shortcode} is itself a manifestation child; STOKER does not recurse on its own outputs`,
        );
      }
      // Idempotent flip — fine if already IN_STOKER.
      await db
        .update(signalsTable)
        .set({ status: "IN_STOKER", updatedAt: new Date() })
        .where(eq(signalsTable.id, signalId));
      return row;
    });

    // ─── 2. Fetch Decade Playbooks ──────────────────────────────
    // Title-based lookup (case-insensitive). Phase 9H seeds three docs
    // with canonical titles. Missing playbooks return empty strings;
    // STOKER's prompt has a "(not yet authored — fall back to brand DNA)"
    // path for empty playbook bodies.
    const playbooks = await step.run("fetch-playbooks", async () => {
      const titles: Record<DecadeKey, string> = {
        RCK: "RCK Decade Playbook",
        RCL: "RCL Decade Playbook",
        RCD: "RCD Decade Playbook",
      };
      const out: Record<DecadeKey, string> = { RCK: "", RCL: "", RCD: "" };
      for (const [decade, title] of Object.entries(titles) as [DecadeKey, string][]) {
        const [doc] = await db
          .select({ content: knowledgeDocuments.content })
          .from(knowledgeDocuments)
          .where(
            and(
              eq(knowledgeDocuments.orgId, orgId),
              eq(knowledgeDocuments.status, "active"),
              ilike(knowledgeDocuments.title, title),
            ),
          )
          .limit(1);
        out[decade] = doc?.content ?? "";
      }
      return out;
    });

    // ─── 3. Run STOKER skill ────────────────────────────────────
    // runSkill writes the parent's agent_outputs row automatically
    // (outputType='stoker', status='PENDING' for the founder gate).
    // The output JSON contains all 3 decades' resonance scores, rationales,
    // manifestation framings, and refusal state.
    //
    // Note: runSkill's outputType is `agentKey.toLowerCase()` = 'stoker'.
    // The renderer reads agent_outputs WHERE agent_name='STOKER' — the
    // outputType field is informational, not a query key.
    const skillInput: StokerInput = {
      signalId: parent.id,
      shortcode: parent.shortcode,
      workingTitle: parent.workingTitle,
      concept: parent.concept ?? "",
      rawExcerpt: (parent.rawText ?? "").slice(0, 800) || null,
      sourceUrl:
        (parent.rawMetadata as { url?: string } | null)?.url ?? null,
      decadeHintFromCollection: null, // Phase 6.6 collection lookup deferred
      playbooks: {
        rck: playbooks.RCK,
        rcl: playbooks.RCL,
        rcd: playbooks.RCD,
      },
    };

    const result = await step.run("run-stoker-skill", async () => {
      return runSkill<StokerInput, StokerOutput>({
        agentKey: "STOKER",
        orgId,
        signalId: parent.id,
        input: skillInput,
      });
    });

    const stokerOutput = result.output;

    // ─── 4. Create manifestation children for resonant decades ──
    // For each decade scoring >= 50 in skill output: create a child signal
    // row + initial journey + child's STOKER agent_outputs row carrying
    // just that decade's framing.
    //
    // Each child created in its own step.run() so a partial failure can
    // be retried without re-creating already-created siblings (idempotent
    // on shortcode-collision, which fails the unique constraint on retry
    // — caller can scan resulting agent_outputs to detect duplicates).
    const childCreations: Array<{
      decade: DecadeKey;
      childSignalId: string;
      childShortcode: string;
    }> = [];

    for (const decadeRow of stokerOutput.decades) {
      if (decadeRow.resonanceScore < 50 || !decadeRow.manifestation) continue;

      const decade = decadeRow.decade as DecadeKey;
      const created = await step.run(
        `create-manifestation-${decade}`,
        async () => {
          // Mint child shortcode: parent + decade suffix.
          // Collision-safe via the existing resolveShortcode helper.
          const taken = new Set(
            (
              await db
                .select({ shortcode: signalsTable.shortcode })
                .from(signalsTable)
                .where(eq(signalsTable.orgId, orgId))
            ).map((r) => r.shortcode),
          );
          const baseShortcode = `${parent.shortcode}-${decade}`;
          const childShortcode = resolveShortcode(baseShortcode, taken);

          // Single transaction: child signal + journey + STOKER
          // agent_outputs. If any step fails, the whole child is rolled
          // back so we don't leave half-formed manifestations.
          return await db.transaction(async (tx) => {
            const [childSignal] = await tx
              .insert(signalsTable)
              .values({
                orgId,
                shortcode: childShortcode,
                workingTitle:
                  decadeRow.manifestation!.framingHook.slice(0, 200),
                concept: decadeRow.manifestation!.narrativeAngle.slice(0, 600),
                status: "IN_STOKER",
                source: "stoker_manifestation",
                rawText: null,
                rawMetadata: null,
                collectionId: parent.collectionId,
                parentSignalId: parent.id,
                manifestationDecade: decade,
              })
              .returning({ id: signalsTable.id });

            const childJourney = await createInitialJourney(
              { signalId: childSignal.id, createdBy: null },
              tx,
            );

            await tx.insert(agentOutputs).values({
              signalId: childSignal.id,
              journeyId: childJourney.id,
              agentName: "STOKER",
              outputType: "manifestation",
              content: {
                decade,
                resonanceScore: decadeRow.resonanceScore,
                rationale: decadeRow.rationale,
                framingHook: decadeRow.manifestation!.framingHook,
                tensionAxis: decadeRow.manifestation!.tensionAxis,
                narrativeAngle: decadeRow.manifestation!.narrativeAngle,
                dimensionAlignment: decadeRow.manifestation!.dimensionAlignment,
                parentSignalId: parent.id,
                parentShortcode: parent.shortcode,
              },
              status: "PENDING",
            });

            return { childSignalId: childSignal.id, childShortcode };
          });
        },
      );

      childCreations.push({
        decade,
        childSignalId: created.childSignalId,
        childShortcode: created.childShortcode,
      });
    }

    // ─── 5. Update parent terminal status ───────────────────────
    const finalParentStatus: SignalStatus = stokerOutput.refused
      ? "STOKER_REFUSED"
      : "FANNED_OUT";

    // Defensive observability: the skill's Zod schema enforces
    // `refused iff all scores < 50` via refine(), but if that
    // invariant ever drifts (skill rewrite, schema regression, etc.)
    // we could end up at FANNED_OUT with zero children — a silent
    // data integrity issue. Surface it in the Inngest function logs
    // so the dashboard catches it. Cloud CR pass 2 on PR #8.
    if (
      finalParentStatus === "FANNED_OUT" &&
      childCreations.length === 0
    ) {
      console.warn(
        `[STOKER] Invariant violation: refused=false but no children created for parent ${parent.shortcode} (${parent.id}). Proceeding with FANNED_OUT status — review the skill output for malformed decades array.`,
      );
    }

    await step.run("flip-parent-terminal", async () => {
      await db
        .update(signalsTable)
        .set({ status: finalParentStatus, updatedAt: new Date() })
        .where(eq(signalsTable.id, parent.id));
    });

    return {
      parentSignalId: parent.id,
      parentShortcode: parent.shortcode,
      finalStatus: finalParentStatus,
      stokerOutputId: result.outputId,
      manifestationCount: childCreations.length,
      manifestations: childCreations,
      refused: stokerOutput.refused,
    };
  },
);
