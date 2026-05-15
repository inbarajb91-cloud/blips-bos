import { and, eq, ilike, sql, desc } from "drizzle-orm";
import { generateImage } from "ai";
import { inngest } from "../client";
import {
  db,
  signals as signalsTable,
  agentOutputs,
  knowledgeDocuments,
} from "@/db";
import { runSkill } from "@/lib/orc/orchestrator";
import { getMemoryBackend } from "@/lib/orc/memory";
import { getImageModel } from "@/lib/ai/image-providers";
import { getAgentConfig } from "@/lib/ai/config-reader";
import { computeImageCost } from "@/lib/ai/pricing";
import { logAgentCall } from "@/lib/ai/logger";
import {
  uploadBase64Image,
  isCloudinaryConfigured,
} from "@/lib/cloudinary";
import "@/skills"; // ensure skill registry is populated
import type { BoilerInput, BoilerOutput } from "@/skills/boiler";

type DecadeKey = "RCK" | "RCL" | "RCD";

/**
 * BOILER Inngest function — Phase 11C.
 *
 * Triggered by `furnace.brief.approved` (fired from
 * `approveFullBrief` server action when founder approves the FURNACE
 * brief — the action lives in `src/lib/actions/furnace.ts`; the event
 * fire-line gets added in this PR's companion change). Orchestrates
 * the BOILER pipeline stage end-to-end:
 *
 *   1. Load the manifestation child signal + verify it's at IN_BOILER
 *      (set by the approve action) + load its FURNACE brief from
 *      agent_outputs (the 11 sections + addenda the gallery generates
 *      against).
 *   2. Recall knowledge context: decade playbook + BLIPS Brand Identity
 *      + Materials playbook + BLIPS Fashion Skills (skills.md, the
 *      BOILER reference doc) from knowledge_documents (fall through to
 *      empty strings when not yet authored — system prompt has fallback).
 *   3. Recall up to 3 past approved concepts for this decade from the
 *      events container (Tier 3 visual consistency learning).
 *   4. Run BOILER skill via runSkill (one LLM call → 4 detailed
 *      image-gen prompts + register classifications + per-variant model
 *      recommendations). The skill itself doesn't generate images; that's
 *      step 5.
 *   5. For each variant prompt: call AI SDK `generateImage` with the
 *      recommended model. Walks the agent's `image_model_fallback_chain`
 *      on transient errors. Returns base64 image data + usage metadata.
 *   6. Store images on Cloudinary (Phase 11C.1, shipped May 15). Each
 *      base64 PNG is uploaded via src/lib/cloudinary; the variant row
 *      stores `imageUrl` (with f_auto,q_auto applied) + `cloudinaryPublicId`,
 *      NOT the inline data URI. Drops Vercel Fast Origin Transfer +
 *      Supabase DB row size ~99%. Falls back to inline base64 only when
 *      CLOUDINARY_URL is unset (local dev only). Phase 11D will later
 *      swap in Dynamic Mockups for multi-angle mockup rendering when
 *      DYNAMIC_MOCKUPS_API_KEY is set.
 *   7. Write agent_outputs row (outputType='boiler_gallery') + advance
 *      manifestation status (IN_BOILER → keep IN_BOILER; concept gallery
 *      is a sub-state with status=PENDING awaiting founder pick).
 *   8. Best-effort write a `boiler.gallery.generated` event to the
 *      supermemory events container (Tier 3 — every gallery contributes
 *      to BLIPS's learned visual patterns).
 *
 * Design alignment with agents/BOILER.md (May 8 decisions):
 *   - 4 variants per gallery (one per register class).
 *   - Skill outputs PROMPTS; this handler RUNS them. Split rationale in
 *     skill module's docblock: image-gen failures don't lose framing
 *     context; skill is unit-testable without burning image-gen cost;
 *     founder iteration loop has two cheap levels (regenerate prompts
 *     OR regenerate just images).
 *   - Refusal-as-quality: when skill returns refused=true, manifestation
 *     flips to BOILER_REFUSED (founder reviews + force-advances or
 *     dismisses).
 */

export const boilerProcess = inngest.createFunction(
  {
    id: "boiler-process",
    triggers: [{ event: "furnace.brief.approved" }],
    // BOILER is heavier than FURNACE (4 image-gen calls per run); keep
    // concurrency tighter so we don't blow through provider quotas on
    // a wave of brief approvals. Phase 11G eval may revisit after we
    // see production patterns.
    concurrency: { limit: 2, key: "event.data.orgId" },
    onFailure: async ({ event }) => {
      // Phase 11G.3 — when Inngest exhausts all retries (Gemini structured-
      // output flakiness or other transient failure that never resolves),
      // persist a FAILURE marker row so the renderer can surface a "Retry"
      // affordance instead of spinning the breathing dot forever. Without
      // this, the manifestation sits at IN_BOILER with no agent_outputs
      // row, and the user has no way to know the run failed without
      // reading agent_logs.
      //
      // Marker shape:
      //   - agent_outputs.status = REJECTED
      //   - content.refused = false  (distinguishes technical failure
      //     from a skill-quality refusal — refusal sets refused=true)
      //   - content.error = { ... }  (drives the retry UI)
      //
      // Manifestation status stays IN_BOILER (NOT BOILER_REFUSED) so the
      // retry path can be a re-fire of furnace.brief.approved without
      // needing to re-flip the status enum.
      const failedEvent = event.data as
        | {
            event?: {
              data?: {
                orgId?: string;
                manifestationSignalId?: string;
                briefId?: string;
              };
            };
            error?: { message?: string };
          }
        | undefined;
      const inner = failedEvent?.event?.data;
      const errMsg =
        failedEvent?.error?.message ??
        "BOILER exhausted retries (likely Gemini structured-output flakiness — try the retry button).";
      try {
        if (inner?.manifestationSignalId && inner?.orgId) {
          // Don't double-write — if a row already exists (e.g. partial
          // success on a prior retry), skip. Cheap idempotency: check
          // first, then insert if missing.
          const existing = await db
            .select({ id: agentOutputs.id })
            .from(agentOutputs)
            .where(
              and(
                eq(agentOutputs.signalId, inner.manifestationSignalId),
                eq(agentOutputs.agentName, "BOILER"),
              ),
            )
            .limit(1);
          if (existing.length === 0) {
            // Resolve active journey for the FK constraint
            const { journeys } = await import("@/db/schema");
            const [activeJourney] = await db
              .select({ id: journeys.id })
              .from(journeys)
              .where(
                and(
                  eq(journeys.signalId, inner.manifestationSignalId),
                  eq(journeys.status, "active"),
                ),
              )
              .limit(1);
            if (activeJourney) {
              await db.insert(agentOutputs).values({
                signalId: inner.manifestationSignalId,
                journeyId: activeJourney.id,
                agentName: "BOILER",
                outputType: "boiler",
                content: {
                  refused: false,
                  error: {
                    message: errMsg.slice(0, 500),
                    persistedBy: "onFailure",
                    persistedAt: new Date().toISOString(),
                    retryable: true,
                  },
                },
                status: "REJECTED",
              });
              console.error(
                `[BOILER] onFailure persisted failure marker for manifestation ${inner.manifestationSignalId}`,
              );
            } else {
              console.error(
                `[BOILER] onFailure — no active journey for ${inner.manifestationSignalId}; skipping marker insert.`,
              );
            }
          } else {
            console.error(
              `[BOILER] onFailure — agent_outputs row already exists for ${inner.manifestationSignalId}; not overwriting.`,
            );
          }
        }
      } catch (err) {
        console.error(
          "[BOILER] onFailure marker insert failed (best-effort):",
          err,
        );
      }
      console.error(
        "[BOILER] onFailure — function exhausted retries:",
        JSON.stringify(inner),
      );
    },
  },
  async ({ event, step }) => {
    const { orgId, manifestationSignalId, briefId } =
      event.data as {
        orgId: string;
        manifestationSignalId: string;
        briefId: string;
      };

    // ─── 1. Load manifestation + brief context ──────────────────
    const context = await step.run("load-boiler-context", async () => {
      const [child] = await db
        .select({
          id: signalsTable.id,
          shortcode: signalsTable.shortcode,
          workingTitle: signalsTable.workingTitle,
          status: signalsTable.status,
          parentSignalId: signalsTable.parentSignalId,
          manifestationDecade: signalsTable.manifestationDecade,
        })
        .from(signalsTable)
        .where(
          and(
            eq(signalsTable.id, manifestationSignalId),
            eq(signalsTable.orgId, orgId),
          ),
        )
        .limit(1);
      if (!child) {
        throw new Error(
          `[BOILER] Manifestation signal ${manifestationSignalId} not found for org ${orgId}.`,
        );
      }
      if (child.parentSignalId === null) {
        throw new Error(
          `[BOILER] Signal ${manifestationSignalId} is not a manifestation child. BOILER only runs on STOKER-produced children.`,
        );
      }
      if (child.manifestationDecade === null) {
        throw new Error(
          `[BOILER] Signal ${manifestationSignalId} has parent_signal_id but null manifestation_decade — schema invariant violation.`,
        );
      }
      // IN_BOILER is the expected state (the approve_full_brief action
      // sets it). Allow IN_ENGINE too as an idempotent retry path — if
      // the function partially completed and the gallery was already
      // written + advanced past BOILER, a re-run shouldn't blow up.
      if (child.status !== "IN_BOILER" && child.status !== "IN_ENGINE") {
        throw new Error(
          `[BOILER] Manifestation ${child.shortcode} status is ${child.status}, expected IN_BOILER. approve_full_brief action may not have completed.`,
        );
      }

      // FURNACE agent_outputs row — the brief BOILER renders
      const [briefRow] = await db
        .select({
          id: agentOutputs.id,
          content: agentOutputs.content,
        })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.id, briefId),
            eq(agentOutputs.signalId, child.id),
            eq(agentOutputs.agentName, "FURNACE"),
          ),
        )
        .limit(1);
      if (!briefRow) {
        throw new Error(
          `[BOILER] FURNACE brief ${briefId} not found on manifestation ${child.shortcode}. Cannot generate gallery without brief.`,
        );
      }

      // STOKER framing hook (small reference field for the prompt context)
      const [stokerOutput] = await db
        .select({ content: agentOutputs.content })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, child.id),
            eq(agentOutputs.agentName, "STOKER"),
          ),
        )
        .limit(1);
      const stokerContent =
        (stokerOutput?.content as Record<string, unknown> | undefined) ?? {};

      return {
        child,
        briefId: briefRow.id,
        brief: briefRow.content as Record<string, unknown>,
        framingHook:
          (stokerContent.framingHook as string | undefined) ??
          child.workingTitle,
      };
    });

    const decade = context.child.manifestationDecade as DecadeKey;

    // ─── 2. Recall knowledge context ─────────────────────────────
    const knowledgeContext = await step.run(
      "fetch-boiler-knowledge",
      async () => {
        const playbookTitles: Record<DecadeKey, string> = {
          RCK: "RCK Decade Playbook",
          RCL: "RCL Decade Playbook",
          RCD: "RCD Decade Playbook",
        };

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

        const [
          decadePlaybook,
          brandIdentity,
          materialsVocabulary,
          fashionSkills,
        ] = await Promise.all([
          fetchByTitle(playbookTitles[decade]),
          fetchByTitle("BLIPS Brand Identity"),
          fetchByTitle("BLIPS Materials Playbook"),
          fetchByTitle("BLIPS Fashion Skills"),
        ]);

        return {
          decadePlaybook,
          brandIdentity,
          materialsVocabulary,
          fashionSkills,
        };
      },
    );

    // ─── 3. Recall past approved concepts for this decade ───────
    const pastConcepts = await step.run(
      "fetch-past-boiler-concepts",
      async () => {
        // Query agent_outputs for prior BOILER galleries on signals of
        // the same decade that have an approved variant. Tier 3 visual
        // consistency without copying.
        const rows = await db
          .select({
            content: agentOutputs.content,
            createdAt: agentOutputs.createdAt,
            signalShortcode: signalsTable.shortcode,
          })
          .from(agentOutputs)
          .innerJoin(signalsTable, eq(agentOutputs.signalId, signalsTable.id))
          .where(
            and(
              eq(signalsTable.orgId, orgId),
              eq(signalsTable.manifestationDecade, decade),
              eq(agentOutputs.agentName, "BOILER"),
              eq(agentOutputs.status, "APPROVED"),
            ),
          )
          .orderBy(desc(agentOutputs.createdAt))
          .limit(3);

        return rows.map((r) => {
          const content = r.content as Record<string, unknown>;
          const approved = content.approvedVariant as
            | { register?: string; rationale?: string }
            | undefined;
          return {
            shortcode: r.signalShortcode,
            approachUsed:
              (approved?.register as
                | "type-led"
                | "iconographic"
                | "photographic"
                | "abstract"
                | "mixed"
                | undefined) ?? "type-led",
            approvedAt: r.createdAt.toISOString(),
            notes: (approved?.rationale ?? "").slice(0, 400),
          };
        });
      },
    );

    // ─── 4. Run BOILER skill ────────────────────────────────────
    const skillResult = await step.run("run-boiler-skill", async () => {
      const skillInput: BoilerInput = {
        signalId: context.child.id,
        shortcode: context.child.shortcode,
        manifestationDecade: decade,
        framingHook: context.framingHook,
        brief: context.brief as BoilerInput["brief"],
        knowledgeContext,
        pastConceptsForDecade: pastConcepts,
      };
      return runSkill<BoilerInput, BoilerOutput>({
        agentKey: "BOILER",
        orgId,
        signalId: context.child.id,
        input: skillInput,
      });
    });

    const skillOutput = skillResult.output;

    // ─── 5. Refusal short-circuit ───────────────────────────────
    //
    // runSkill already inserted an agent_outputs row with the refused
    // content (status PENDING). Flip the manifestation status + the
    // agent_outputs row status; the renderer reads from these two for
    // the refusal banner.
    if (skillOutput.refused) {
      await step.run("flip-manifestation-boiler-refused", async () => {
        await db
          .update(signalsTable)
          .set({ status: "BOILER_REFUSED", updatedAt: new Date() })
          .where(eq(signalsTable.id, context.child.id));
        await db
          .update(agentOutputs)
          .set({ status: "REJECTED" })
          .where(eq(agentOutputs.id, skillResult.outputId));
      });
      return {
        refused: true,
        manifestationShortcode: context.child.shortcode,
        reason: skillOutput.refusalReason ?? "(no rationale provided)",
      };
    }

    // ─── 6. Generate images for each variant ────────────────────
    //
    // For each of the 4 prompts the skill produced, call `generateImage`
    // with the recommended model. Walk the agent's image_model_fallback
    // _chain on transient errors. Returns base64 image data inline; in
    // Phase 11C we store as data URIs in agent_outputs (no Cloudinary
    // yet). Phase 11C.1 swaps in upload when CLOUDINARY_URL is set.
    const imageConfig = await getAgentConfig(orgId, "BOILER");
    const imageFallbackChain =
      ((
        imageConfig as unknown as {
          image_model_fallback_chain?: string[];
        }
      ).image_model_fallback_chain) ??
      // Phase 11G.1 — Google-first default (gemini-2.5-flash-image is
      // "nano banana", $0.039 fast tier; imagen-4.0 as second hop for
      // photographic / typography-critical fall-through). Prod env as
      // of May 8 only carries GOOGLE_GENERATIVE_AI_API_KEY; OPENAI key
      // not yet provisioned. When founder adds OPENAI_API_KEY to Vercel
      // they can prepend "gpt-image-1" to this chain via the agent
      // settings UI without code change.
      ["gemini-2.5-flash-image", "imagen-4.0-generate-001"];

    // ─── 6+7 combined — image gen + persist within ONE Inngest step ─
    //
    // Phase 11G.2 fix: previously this was 2 steps. Step 6 returned the
    // 4 generated images (each ~1-3MB base64, ~5-15MB total) as the
    // step result; step 7 read that result and UPDATEd the agent_outputs
    // row. Inngest's step result has a serialization size limit
    // (~4MB on Vercel/Inngest Cloud); 4 base64 images blew past that.
    // Symptom: image gen succeeded (agent_logs showed 4 successful
    // generateImage calls + costs), step 6 looked done, but step 7
    // never fired and the agent_outputs row stayed at the skill-written
    // shape (4 variants without imageDataUri / actualModel / storageMode).
    //
    // Combining the steps means the base64 payloads stay inside the step's
    // execution, never cross the Inngest step boundary. The step's
    // RETURN value is now thin summary metadata only — galleryMood,
    // variant slugs/registers/models — under 1KB. Step 8 (memory write)
    // consumes that summary.
    //
    // Tradeoff: combining steps loses Inngest's per-step retry granularity
    // (an image-gen failure now retries the entire step including the
    // already-succeeded images). The fallback chain in the inner loop
    // already handles transient image-gen errors per variant, so the
    // outer retry rarely matters in practice.
    const summary = await step.run(
      "generate-and-persist-gallery",
      async () => {
        // Schema-narrow guards (same as before — refused branch returned
        // above; here BOTH variants and galleryMood must be present and
        // well-formed).
        const variants = skillOutput.variants;
        if (!variants || variants.length === 0) {
          throw new Error(
            "[BOILER] Inconsistent skill output: refused=false but variants is null/empty. Model emitted invalid shape.",
          );
        }
        const galleryMood = skillOutput.galleryMood;
        if (!galleryMood || galleryMood.trim().length === 0) {
          throw new Error(
            "[BOILER] Inconsistent skill output: refused=false but galleryMood is null/empty. Model emitted invalid shape.",
          );
        }

        // Phase 11C.1 — check Cloudinary availability ONCE per run. In
        // production this is always true (CLOUDINARY_URL is set on Vercel
        // env). Local dev without the key falls back to inline base64 per
        // variant — single dev-mode flow, never produces production data.
        const cloudinaryConfigured = isCloudinaryConfigured();
        if (!cloudinaryConfigured) {
          console.warn(
            "[BOILER] CLOUDINARY_URL not configured — gallery will store inline base64 (legacy Phase 11C path). Set CLOUDINARY_URL to swap to hosted URLs (~99% reduction in transfer + row size).",
          );
        }

        const results: Array<{
          variantSlug: string;
          register: string;
          rationale: string;
          imagePrompt: string;
          recommendedModel: string;
          paletteAnchors: string[];
          referenceAnchors: string[];
          /** Cloudinary delivery URL with f_auto,q_auto applied. Set when
           *  Cloudinary is configured (production). Renderer reads this
           *  first via `variant.imageUrl ?? variant.imageDataUri`. */
          imageUrl?: string;
          /** Cloudinary public id ("blips/boiler/{shortcode}/{variantSlug}").
           *  Stored for future delete / re-transform operations. */
          cloudinaryPublicId?: string;
          /** Legacy inline base64 (data:image/png;base64,...). Populated
           *  ONLY when Cloudinary is not configured (local dev fallback).
           *  Production rows have imageUrl and no imageDataUri. */
          imageDataUri?: string;
          actualModel: string;
          fallbacksUsed: number;
          imageGenMs: number;
        }> = [];

        for (const variant of variants) {
          // Build the per-variant model chain: skill's recommended model
          // first, then the agent's configured fallback chain (de-duped).
          const chain = [variant.recommendedModel, ...imageFallbackChain].filter(
            (id, i, arr) => arr.indexOf(id) === i,
          );
          let lastError: Error | undefined;
          let chosen:
            | {
                modelId: string;
                fallbacks: number;
                ms: number;
                base64: string;
              }
            | null = null;

          for (let i = 0; i < chain.length; i++) {
            const modelId = chain[i];
            const start = Date.now();
            try {
              const result = await generateImage({
                model: getImageModel(modelId),
                prompt: variant.imagePrompt,
                size: "1024x1024",
                n: 1,
              });
              const image = result.image;
              const base64 =
                image.base64 ??
                Buffer.from(image.uint8Array).toString("base64");
              chosen = {
                modelId,
                fallbacks: i,
                ms: Date.now() - start,
                base64,
              };
              break;
            } catch (e) {
              lastError = e instanceof Error ? e : new Error(String(e));
              console.warn(
                `[BOILER] image-gen failed on ${modelId} (variant ${variant.variantSlug}): ${lastError.message.slice(0, 120)}`,
              );
              // Try next model in chain
            }
          }

          if (!chosen) {
            throw new Error(
              `[BOILER] All ${chain.length} models in chain failed for variant ${variant.variantSlug}. Last error: ${lastError?.message ?? "unknown"}`,
            );
          }

          // Best-effort log of cost per variant. journeyId omitted —
          // runSkill writes its own llm_call log with journeyId for the
          // text-side prompt-generation; image gen here is a separate
          // call type and journeyId can be queried via signalId join.
          void logAgentCall({
            orgId,
            signalId: context.child.id,
            agentName: "BOILER",
            action: "llm_call",
            model: chosen.modelId,
            durationMs: chosen.ms,
            status: "success",
            costUsd: computeImageCost(chosen.modelId, 1),
            metadata: {
              imageGen: true,
              variantSlug: variant.variantSlug,
              register: variant.register,
              fallbacks_used: chosen.fallbacks,
              recommended_model: variant.recommendedModel,
            },
          });

          // Phase 11C.1 — upload to Cloudinary. In production (CLOUDINARY_URL
          // set) this is required; failures throw and Inngest's retry handles
          // them (onFailure persists a marker row after retries exhaust). In
          // local dev without the key, falls back to inline base64 so dev
          // flows aren't blocked — never produces production data via the
          // fallback path.
          let imageUrl: string | undefined;
          let cloudinaryPublicId: string | undefined;
          let imageDataUri: string | undefined;
          if (cloudinaryConfigured) {
            const uploadStart = Date.now();
            const uploadResult = await uploadBase64Image(chosen.base64, {
              folder: `blips/boiler/${context.child.shortcode}`,
              publicIdHint: variant.variantSlug,
              overwrite: true,
            });
            imageUrl = uploadResult.optimizedUrl;
            cloudinaryPublicId = uploadResult.publicId;
            void logAgentCall({
              orgId,
              signalId: context.child.id,
              agentName: "BOILER",
              action: "output_written",
              durationMs: Date.now() - uploadStart,
              status: "success",
              metadata: {
                cloudinaryUpload: true,
                variantSlug: variant.variantSlug,
                publicId: uploadResult.publicId,
                bytes: uploadResult.bytes,
                format: uploadResult.format,
              },
            });
          } else {
            imageDataUri = `data:image/png;base64,${chosen.base64}`;
          }

          results.push({
            variantSlug: variant.variantSlug,
            register: variant.register,
            rationale: variant.rationale,
            imagePrompt: variant.imagePrompt,
            recommendedModel: variant.recommendedModel,
            paletteAnchors: variant.paletteAnchors,
            referenceAnchors: variant.referenceAnchors,
            imageUrl,
            cloudinaryPublicId,
            imageDataUri,
            actualModel: chosen.modelId,
            fallbacksUsed: chosen.fallbacks,
            imageGenMs: chosen.ms,
          });
        }

        // INLINE the DB UPDATE inside this same step — the base64 payloads
        // never leave this execution context. Single-row pattern means
        // the workspace renderer reads one location.
        await db
          .update(agentOutputs)
          .set({
            content: {
              refused: false,
              galleryMood,
              editorNotes: skillOutput.editorNotes,
              variants: results,
              briefId: context.briefId,
              mockups: null, // Phase 11D: Dynamic Mockups fills this in
              mockupsPendingReason:
                "Dynamic Mockups API key not configured. Set DYNAMIC_MOCKUPS_API_KEY in .env.local + redeploy to enable multi-angle mockup rendering.",
              storageMode: cloudinaryConfigured
                ? "cloudinary"
                : "inline-base64-data-uri",
              storagePendingReason: cloudinaryConfigured
                ? null
                : "Cloudinary upload not configured. Set CLOUDINARY_URL in .env.local + redeploy to swap to hosted URLs (~99% reduction in Fast Origin Transfer + DB row size).",
            },
          })
          .where(eq(agentOutputs.id, skillResult.outputId));

        // Thin summary — no base64. Crosses the step boundary safely.
        return {
          galleryMood,
          variantCount: results.length,
          registers: results.map((v) => v.register),
          modelsUsed: results.map((v) => v.actualModel),
          anyFallbacks: results.some((v) => v.fallbacksUsed > 0),
        };
      },
    );

    // ─── 8. Best-effort memory write (Tier 3 learning) ──────────
    //
    // boiler.gallery.generated lands in supermemory events container
    // scoped by (signalId, orgId). Cross-signal recall can surface
    // patterns ("we've used type-led for 4 of last 5 RCK pieces") for
    // future BOILER calls. Best-effort — non-awaited IIFE so transient
    // memory failures don't extend this Inngest step's runtime. Reads
    // from the thin `summary` returned by the combined step above (no
    // base64 payload crosses this boundary either).
    void (async () => {
      try {
        const memory = await getMemoryBackend();
        const variantsForMemory = summary.registers.map(
          (r, i) => `${r} (${summary.modelsUsed[i]})`,
        );
        await memory.remember({
          orgId,
          container: "events",
          kind: "stage_completion",
          content: `BOILER generated 4-variant concept gallery for ${context.child.shortcode} (${decade}). Mood: ${summary.galleryMood}. Variants: ${variantsForMemory.join(", ")}. Awaiting founder pick.`,
          signalId: context.child.id,
          metadata: {
            stage: "boiler",
            decade,
            shortcode: context.child.shortcode,
            variantCount: summary.variantCount,
            registers: summary.registers,
            modelsUsed: summary.modelsUsed,
            anyFallbacks: summary.anyFallbacks,
          },
        });
      } catch (err) {
        console.warn("[BOILER] memory write failed (best-effort):", err);
      }
    })();

    return {
      refused: false,
      manifestationShortcode: context.child.shortcode,
      decade,
      variantCount: summary.variantCount,
      mood: summary.galleryMood,
    };
  },
);
