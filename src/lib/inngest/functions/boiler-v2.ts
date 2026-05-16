/**
 * Phase 11D.3a — BOILER v2 unified Inngest handler.
 *
 * One function handles all four generation flavors (fresh / refine / branch /
 * finalize) — dispatched on `event.data.mode`. Each flow uses the same
 * underlying service (`@/lib/boiler/generateDesign`), but assembles inputs
 * differently:
 *
 *   - fresh    : no parent. Just FURNACE brief + current palette + tier.
 *   - refine   : parent set. Sends instruction + parent image (multipart) to
 *                gpt-image-1 /v1/images/edits.
 *   - branch   : parent set, no instruction. Forks a new lineage from a
 *                historical version (parent_version_id ← branch source).
 *   - finalize : parent = current active version, tier forced to 'high'. The
 *                approved canonical artwork.
 *
 * Auto-retry policy (low tier only):
 *   - If verifier returns passed=false AND mode='fresh' AND tier='low' AND
 *     retryDepth < 2 → re-fire boiler.v2.generate with mode='refine',
 *     refinementInstruction = top verifier suggestions, retryDepth++.
 *   - Medium/high tier failures persist with the verifier verdict but do NOT
 *     auto-retry (more expensive — explicit human/ORC loop).
 *
 * Persistence:
 *   - Each call writes one design_versions row.
 *   - Updates boiler_state.active_version_id to the new row.
 *   - composition_meta.verification embeds the full verifier verdict.
 *   - Finalize: sets boiler_state.finalized_version_id (not finalized=true —
 *     that's gated on explicit approve_and_advance ORC tool).
 *
 * Triggered by ORC tools (Phase 11D.3c) via `inngest.send({ name: 'boiler.v2.generate', data: ... })`.
 */

import { and, desc, eq, ilike } from "drizzle-orm";
import { inngest } from "@/lib/inngest/client";
import { db } from "@/db";
import {
  agentOutputs,
  designVersions,
  boilerState,
  signals,
  knowledgeDocuments,
} from "@/db/schema";
import { generateDesign } from "@/lib/boiler/generate-design";
import type {
  GenerateDesignInput,
  PaletteRoles,
  CompositionMeta,
  Tier,
} from "@/lib/boiler/types";

const MAX_AUTO_RETRY_DEPTH = 2;

/**
 * Default palette roles when FURNACE hasn't supplied one explicitly. The
 * RCK Season 01 Raw Industrial palette is the safest default — every cohort
 * resolves to one of the three decade palettes if FURNACE doesn't override.
 * Real production usage: FURNACE brief schema upgrade carries hex codes.
 */
const DEFAULT_PALETTE_BY_DECADE: Record<"RCK" | "RCL" | "RCD", PaletteRoles> = {
  RCK: {
    garment_base: "#5A2020",
    ring_outer: "#2A0F0F",
    ring_inner: "#9E5050",
    front_ink: "#E8D5D2",
    back_ink: "#A04040",
  },
  RCL: {
    garment_base: "#2A3744",
    ring_outer: "#1A2632",
    ring_inner: "#6F7E91",
    front_ink: "#B9C4D2",
    back_ink: "#4A5867",
  },
  RCD: {
    garment_base: "#5A3622",
    ring_outer: "#3A2412",
    ring_inner: "#C47A3A",
    front_ink: "#D8C4A8",
    back_ink: "#8C4A28",
  },
};

export const boilerV2Generate = inngest.createFunction(
  {
    id: "boiler-v2-generate",
    triggers: [{ event: "boiler.v2.generate" }],
    // gpt-image-1 calls are heavy ($0.05-0.21/call on med/high tier + 30-60s).
    // Cap concurrency per-org so a click-spammer can't burn the API budget.
    concurrency: { limit: 3, key: "event.data.orgId" },
    onFailure: async ({ event, error }) => {
      // Persist a verifier-failure marker in boiler_state so the renderer
      // can surface "this run failed — retry?" instead of silently hanging.
      // Best-effort; don't re-throw.
      try {
        const data = (event.data as { event?: { data?: unknown } }).event?.data as
          | {
              orgId?: string;
              signalId?: string;
              journeyId?: string;
            }
          | undefined;
        if (!data?.orgId || !data?.signalId) {
          console.error(
            "[BOILER v2] onFailure — no orgId/signalId in event; skipping marker",
          );
          return;
        }
        console.error(
          `[BOILER v2] onFailure for signal ${data.signalId}: ${error?.message ?? "unknown"}`,
        );
        // No marker write here — the existing boiler_state row stays as-is.
        // ORC's `generate_design` tool returns the inngest run id; the
        // workspace renderer can poll it for status.
      } catch (e) {
        console.error("[BOILER v2] onFailure handler crashed:", e);
      }
    },
  },
  async ({ event, step }) => {
    const data = event.data;
    const {
      orgId,
      signalId,
      journeyId,
      tier,
      mode,
      parentVersionId,
      refinementInstruction,
      paletteRolesOverride,
      retryDepth = 0,
      triggeredBy,
    } = data;

    // ─── 1. Load context (signal, brief, parent if any, current state) ──
    const context = await step.run("load-context", async () => {
      // The signal (manifestation child) — gives us shortcode + decade
      const [signal] = await db
        .select({
          id: signals.id,
          shortcode: signals.shortcode,
          workingTitle: signals.workingTitle,
          manifestationDecade: signals.manifestationDecade,
        })
        .from(signals)
        .where(and(eq(signals.id, signalId), eq(signals.orgId, orgId)))
        .limit(1);
      if (!signal) throw new Error(`[BOILER v2] signal ${signalId} not found`);

      const decade = (signal.manifestationDecade ?? "RCK") as
        | "RCK"
        | "RCL"
        | "RCD";

      // FURNACE brief — most-recent APPROVED FURNACE output on this signal
      const [briefRow] = await db
        .select({
          id: agentOutputs.id,
          content: agentOutputs.content,
        })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, signalId),
            eq(agentOutputs.agentName, "FURNACE"),
            eq(agentOutputs.status, "APPROVED"),
          ),
        )
        .orderBy(desc(agentOutputs.createdAt))
        .limit(1);
      if (!briefRow) {
        throw new Error(
          `[BOILER v2] no APPROVED FURNACE brief on signal ${signal.shortcode}. Cannot generate without brief.`,
        );
      }

      // STOKER framing hook (optional but used in prompt context)
      const [stokerRow] = await db
        .select({ content: agentOutputs.content })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, signalId),
            eq(agentOutputs.agentName, "STOKER"),
          ),
        )
        .orderBy(desc(agentOutputs.createdAt))
        .limit(1);
      const stokerContent = (stokerRow?.content as
        | Record<string, unknown>
        | undefined) ?? {};

      // Current boiler_state — to get active palette + active version
      const [state] = await db
        .select()
        .from(boilerState)
        .where(
          and(
            eq(boilerState.signalId, signalId),
            ...(journeyId
              ? [eq(boilerState.journeyId, journeyId)]
              : []),
          ),
        )
        .limit(1);

      // Parent design_versions row if mode is refine/branch/finalize
      let parent:
        | {
            id: string;
            flatArtworkUrl: string | null;
            paletteRoles: PaletteRoles;
            compositionMeta: CompositionMeta;
          }
        | null = null;
      if (parentVersionId) {
        const [p] = await db
          .select()
          .from(designVersions)
          .where(
            and(
              eq(designVersions.id, parentVersionId),
              eq(designVersions.orgId, orgId),
            ),
          )
          .limit(1);
        if (!p) {
          throw new Error(
            `[BOILER v2] parent_version_id ${parentVersionId} not found`,
          );
        }
        parent = {
          id: p.id,
          flatArtworkUrl: p.flatArtworkUrl,
          paletteRoles: p.paletteRoles as PaletteRoles,
          compositionMeta: p.compositionMeta as CompositionMeta,
        };
      }

      // Decide effective palette: override > parent > state > decade default
      const paletteRoles: PaletteRoles =
        (paletteRolesOverride as PaletteRoles | undefined) ??
        parent?.paletteRoles ??
        (state?.activePaletteRoles as PaletteRoles | undefined) ??
        DEFAULT_PALETTE_BY_DECADE[decade];

      // Composition meta carries forward from parent (mostly stable across iterations)
      const compositionMeta: CompositionMeta = parent?.compositionMeta ?? {
        exact_text: {
          front: "AHEAD ON PAPER.",
          back: "BEHIND ON SOMETHING.",
        },
        print_spec: {
          method: "screen",
          separations: 2,
          halftones: false,
          full_bleed: true,
        },
      };

      return {
        signal,
        decade,
        brief: briefRow.content as Record<string, unknown>,
        framingHook:
          (stokerContent.framingHook as string | undefined) ??
          signal.workingTitle,
        state,
        parent,
        paletteRoles,
        compositionMeta,
      };
    });

    // ─── 2. Recall knowledge context (decade playbook, BLIPS identity, etc.) ─
    const knowledgeContext = await step.run(
      "fetch-knowledge",
      async () => {
        const fetchByTitle = async (title: string): Promise<string> => {
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
          return doc?.content ?? "";
        };

        const playbookTitle =
          context.decade === "RCK"
            ? "RCK Decade Playbook"
            : context.decade === "RCL"
              ? "RCL Decade Playbook"
              : "RCD Decade Playbook";

        return {
          decadePlaybook: await fetchByTitle(playbookTitle),
          brandIdentity: await fetchByTitle("BLIPS Brand Identity"),
          materialsVocabulary: await fetchByTitle("Materials Playbook"),
          fashionSkills: await fetchByTitle("Fashion Design + Digital Tools Playbook"),
        };
      },
    );

    // ─── 3. Compose generate-design input ────────────────────────────
    const effectiveTier: Tier = mode === "finalize" ? "high" : tier;
    const brief = context.brief;

    const generateInput: GenerateDesignInput = {
      context: {
        signalId: context.signal.id,
        shortcode: context.signal.shortcode,
        manifestationDecade: context.decade,
        season: "S01 Raw Industrial", // TODO: read from signal_decades when populated
        framingHook: context.framingHook,
      },
      furnaceBrief: {
        designDirection: (brief.designDirection as string) ?? "",
        tactileIntent: (brief.tactileIntent as string) ?? "",
        moodAndTone: (brief.moodAndTone as string) ?? "",
        compositionApproach: (brief.compositionApproach as string) ?? "",
        colorTreatment: (brief.colorTreatment as string) ?? "",
        typographicTreatment: (brief.typographicTreatment as string) ?? "",
        artDirection: (brief.artDirection as string) ?? "",
        referenceAnchors: (brief.referenceAnchors as string) ?? "",
        placementIntent: (brief.placementIntent as string) ?? "",
        voiceInVisual: (brief.voiceInVisual as string) ?? "",
        brandFitScore: (brief.brandFitScore as number) ?? 75,
        brandFitRationale: (brief.brandFitRationale as string) ?? "",
        addenda:
          (brief.addenda as Array<{ label: string; content: string }>) ?? [],
      },
      paletteRoles: context.paletteRoles,
      compositionMeta: context.compositionMeta,
      tier: effectiveTier,
      refinementInstruction:
        mode === "refine" ? refinementInstruction : undefined,
      parent:
        context.parent && context.parent.flatArtworkUrl
          ? {
              parentVersionId: context.parent.id,
              parentFlatArtworkUrl: context.parent.flatArtworkUrl,
            }
          : undefined,
      knowledgeContext,
    };

    // ─── 4. Call the service (image-gen + Cloudinary + verifier) ─────
    const result = await step.run("generate-design", async () => {
      return await generateDesign(generateInput);
    });

    // ─── 5. Persist design_versions + update boiler_state ────────────
    const versionId = await step.run("persist-version", async () => {
      const [row] = await db
        .insert(designVersions)
        .values({
          orgId,
          signalId,
          journeyId: journeyId ?? null,
          parentVersionId: context.parent?.id ?? null,
          tier: effectiveTier,
          promptUsed: result.promptUsed,
          refinementInstruction:
            mode === "refine" ? (refinementInstruction ?? null) : null,
          previousResponseId: null, // unused on Images API
          gptImage2ResponseId: result.gptImage2ResponseId,
          flatArtworkUrl: result.flatArtworkUrl,
          cloudinaryPublicId: result.cloudinaryPublicId,
          widthPx: result.widthPx,
          heightPx: result.heightPx,
          paletteRoles: context.paletteRoles,
          // Embed verification result into composition_meta — survives the
          // jsonb column without a new column add. Renderer reads it.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          compositionMeta: {
            ...context.compositionMeta,
            verification: result.verification ?? null,
          } as any,
          costUsd: result.costUsd.toString(),
          createdBy: triggeredBy ?? null,
        })
        .returning({ id: designVersions.id });

      // Upsert boiler_state — make this version the active one.
      // Finalize also stamps finalized_version_id (but NOT finalized=true).
      await db
        .insert(boilerState)
        .values({
          orgId,
          signalId,
          journeyId: journeyId ?? null,
          activeVersionId: row.id,
          activeGarmentHex: context.paletteRoles.garment_base,
          activePaletteRoles: context.paletteRoles,
          finalizedVersionId: mode === "finalize" ? row.id : null,
        })
        .onConflictDoUpdate({
          target: [boilerState.signalId, boilerState.journeyId],
          set: {
            activeVersionId: row.id,
            activeGarmentHex: context.paletteRoles.garment_base,
            activePaletteRoles: context.paletteRoles,
            ...(mode === "finalize" && { finalizedVersionId: row.id }),
          },
        });

      return row.id;
    });

    // ─── 6. Auto-retry on verifier failure (low tier only) ───────────
    const v = result.verification;
    const shouldAutoRetry =
      v &&
      v.passed === false &&
      effectiveTier === "low" &&
      mode === "fresh" &&
      retryDepth < MAX_AUTO_RETRY_DEPTH;

    if (shouldAutoRetry) {
      // Compose a refinement instruction from the verifier's suggestions.
      const issueLines: string[] = [];
      if (v.text_legibility.score < 60 && v.text_legibility.issues) {
        issueLines.push(`Text: ${v.text_legibility.issues}`);
      }
      if (v.palette_adherence.score < 50 && v.palette_adherence.issues) {
        issueLines.push(`Palette: ${v.palette_adherence.issues}`);
      }
      if (v.composition.score < 65 && v.composition.issues) {
        issueLines.push(`Composition: ${v.composition.issues}`);
      }
      if (v.conceptual_fit.score < 60 && v.conceptual_fit.issues) {
        issueLines.push(`Brief fit: ${v.conceptual_fit.issues}`);
      }
      const suggestionLines = v.refinement_suggestions.slice(0, 5);

      const refinement = [
        "The previous draft did not pass verification. Fix these specific issues:",
        ...issueLines.map((l) => `- ${l}`),
        "",
        "Apply these refinements:",
        ...suggestionLines.map((s) => `- ${s}`),
      ].join("\n");

      await step.sendEvent("auto-retry-on-verify-failure", {
        name: "boiler.v2.generate",
        data: {
          orgId,
          signalId,
          journeyId,
          tier: "low",
          mode: "refine",
          parentVersionId: versionId,
          refinementInstruction: refinement,
          paletteRolesOverride: paletteRolesOverride,
          retryDepth: retryDepth + 1,
          triggeredBy,
        },
      });

      console.log(
        `[BOILER v2] auto-retry fired for ${context.signal.shortcode} (depth ${retryDepth + 1}/${MAX_AUTO_RETRY_DEPTH}): verifier failed with ${v.overall_score}/100`,
      );
    }

    return {
      versionId,
      tier: effectiveTier,
      mode,
      cost: result.costUsd,
      durationMs: result.durationMs,
      verification: {
        passed: v?.passed ?? null,
        score: v?.overall_score ?? null,
      },
      autoRetryFired: shouldAutoRetry,
    };
  },
);
