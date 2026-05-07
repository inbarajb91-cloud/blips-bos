/**
 * FURNACE end-to-end verification — Phase 10 backend health check.
 *
 * Multi-stage verification of the Phase 10 FURNACE pipeline against
 * prod Supabase + Inngest:
 *
 *   1. Schema check — migration 0010 applied (signal_status enum has
 *      FURNACE_REFUSED + agent_outputs has section_approvals column)
 *   2. Skill registration — FURNACE skill loadable from registry
 *   3. Knowledge availability — MATERIALS.md / decade playbooks /
 *      BRAND.md present in knowledge_documents
 *   4. Pipeline state — count of manifestations at each stage,
 *      existing FURNACE briefs in DB
 *   5. Live skill execution — pick an existing IN_FURNACE manifestation,
 *      invoke FURNACE skill via runSkill (writes brief + memory hook),
 *      verify the brief landed correctly
 *
 * Usage: npx tsx scripts/verify-furnace-pipeline.ts
 *
 * Reports findings as a structured table at the end.
 */

import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  const envFile = readFileSync(".env.local", "utf-8");
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
}

interface CheckResult {
  stage: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(stage: string, name: string, pass: boolean, detail: string) {
  results.push({ stage, name, pass, detail });
  console.log(`  ${pass ? "✓" : "✗"} [${stage}] ${name} — ${detail}`);
}

async function main() {
  console.log("[FURNACE pipeline verify] starting\n");

  // ─── Stage 1: Schema check ───────────────────────────────────
  console.log("== STAGE 1: Schema migration ==");
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  // Check signal_status enum has FURNACE_REFUSED
  try {
    const enumRows = await db.execute(sql`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'signal_status'
      )
      ORDER BY enumsortorder
    `);
    const labels = (enumRows as unknown as { enumlabel: string }[]).map(
      (r) => r.enumlabel,
    );
    record(
      "schema",
      "signal_status enum has FURNACE_REFUSED",
      labels.includes("FURNACE_REFUSED"),
      labels.includes("FURNACE_REFUSED")
        ? `enum values: ${labels.join(", ")}`
        : `enum values: ${labels.join(", ")} — needs ALTER TYPE signal_status ADD VALUE 'FURNACE_REFUSED'`,
    );
  } catch (err) {
    record(
      "schema",
      "signal_status enum query",
      false,
      `query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Check agent_outputs.section_approvals column exists
  try {
    const colRows = await db.execute(sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agent_outputs'
        AND column_name = 'section_approvals'
    `);
    const found = (colRows as unknown as { column_name: string }[]).length > 0;
    record(
      "schema",
      "agent_outputs.section_approvals column exists",
      found,
      found
        ? `column present`
        : `column MISSING — needs ALTER TABLE agent_outputs ADD COLUMN section_approvals JSONB NOT NULL DEFAULT '{}'::jsonb`,
    );
  } catch (err) {
    record(
      "schema",
      "agent_outputs.section_approvals column query",
      false,
      `query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ─── Stage 2: Skill registration ─────────────────────────────
  console.log("\n== STAGE 2: Skill registration ==");
  await import("../src/skills"); // populate registry
  try {
    const { loadSkill } = await import("../src/skills/registry");
    const skill = loadSkill("FURNACE");
    record(
      "skills",
      "FURNACE skill registered",
      true,
      `name=${skill.name}, has systemPrompt=${!!skill.systemPrompt}, has buildPrompt=${typeof skill.buildPrompt === "function"}`,
    );
  } catch (err) {
    record(
      "skills",
      "FURNACE skill registered",
      false,
      err instanceof Error ? err.message : String(err),
    );
  }

  // ─── Stage 3: Knowledge availability ─────────────────────────
  console.log("\n== STAGE 3: Knowledge availability ==");
  const { knowledgeDocuments, orgs } = await import("../src/db/schema");
  const { eq, and, ilike } = await import("drizzle-orm");

  const [org] = await db
    .select({ id: orgs.id, slug: orgs.slug })
    .from(orgs)
    .where(eq(orgs.slug, "blips"))
    .limit(1);

  if (!org) {
    record("knowledge", "BLIPS org found", false, "no org with slug 'blips'");
  } else {
    record("knowledge", "BLIPS org found", true, `id=${org.id}, slug=${org.slug}`);

    const checkDoc = async (title: string, label: string) => {
      const [doc] = await db
        .select({
          id: knowledgeDocuments.id,
          status: knowledgeDocuments.status,
          contentLen: sql<number>`LENGTH(${knowledgeDocuments.content})`,
        })
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.orgId, org.id),
            ilike(knowledgeDocuments.title, title),
          ),
        )
        .limit(1);
      if (!doc) {
        record(
          "knowledge",
          `${label} present`,
          false,
          `not found in knowledge_documents — seed via scripts/seed-decade-playbooks.ts`,
        );
      } else {
        record(
          "knowledge",
          `${label} present`,
          doc.status === "active" && doc.contentLen > 100,
          `status=${doc.status}, content=${doc.contentLen} chars`,
        );
      }
    };

    await checkDoc("RCK Decade Playbook", "RCK playbook");
    await checkDoc("RCL Decade Playbook", "RCL playbook");
    await checkDoc("RCD Decade Playbook", "RCD playbook");
    await checkDoc("BLIPS Brand Identity", "BRAND.md");
    await checkDoc("BLIPS Materials Playbook", "MATERIALS.md");
  }

  // ─── Stage 4: Pipeline state ─────────────────────────────────
  console.log("\n== STAGE 4: Pipeline state ==");
  const { signals, agentOutputs } = await import("../src/db/schema");

  if (org) {
    // Manifestation counts by status
    const statusCounts = await db.execute(sql`
      SELECT status, COUNT(*) as count
      FROM signals
      WHERE org_id = ${org.id}
        AND parent_signal_id IS NOT NULL
      GROUP BY status
      ORDER BY count DESC
    `);
    const counts = (statusCounts as unknown as { status: string; count: number }[]);
    record(
      "pipeline",
      "manifestation counts by status",
      true,
      counts.length > 0
        ? counts.map((c) => `${c.status}=${c.count}`).join(", ")
        : "no manifestations exist",
    );

    // Count of FURNACE briefs in DB
    const briefCount = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM agent_outputs ao
      JOIN signals s ON ao.signal_id = s.id
      WHERE s.org_id = ${org.id}
        AND ao.agent_name = 'FURNACE'
    `);
    const briefRows = briefCount as unknown as { count: number }[];
    record(
      "pipeline",
      "FURNACE briefs in DB",
      true,
      `count=${briefRows[0]?.count ?? 0}`,
    );
  }

  // ─── Stage 5: Live skill execution ───────────────────────────
  console.log("\n== STAGE 5: Live skill execution ==");

  if (!org) {
    record("execution", "live test", false, "no org — skipped");
  } else {
    // Find a manifestation that's at IN_FURNACE WITHOUT a FURNACE brief yet
    // (so we can generate one without overwriting). If none, find any
    // approved STOKER manifestation we can re-run on.
    const [target] = await db
      .select({
        id: signals.id,
        shortcode: signals.shortcode,
        workingTitle: signals.workingTitle,
        concept: signals.concept,
        status: signals.status,
        parentSignalId: signals.parentSignalId,
        manifestationDecade: signals.manifestationDecade,
      })
      .from(signals)
      .where(
        and(
          eq(signals.orgId, org.id),
          eq(signals.status, "IN_FURNACE"),
          // not null parent (manifestation child)
          sql`${signals.parentSignalId} IS NOT NULL`,
          // no existing FURNACE brief
          sql`NOT EXISTS (
            SELECT 1 FROM agent_outputs ao
            WHERE ao.signal_id = ${signals.id}
              AND ao.agent_name = 'FURNACE'
          )`,
        ),
      )
      .limit(1);

    if (!target) {
      record(
        "execution",
        "find target manifestation",
        false,
        "no IN_FURNACE manifestation without an existing FURNACE brief — skipping live test (this is OK if FURNACE has already run on all approved manifestations)",
      );
    } else {
      console.log(
        `\n  Found test target: ${target.shortcode} (${target.manifestationDecade}, status=${target.status})`,
      );

      // Load STOKER content for this manifestation
      const [stokerRow] = await db
        .select({ content: agentOutputs.content })
        .from(agentOutputs)
        .where(
          and(
            eq(agentOutputs.signalId, target.id),
            eq(agentOutputs.agentName, "STOKER"),
          ),
        )
        .limit(1);

      if (!stokerRow) {
        record(
          "execution",
          "STOKER context for target",
          false,
          `manifestation has no STOKER agent_outputs row — orphaned`,
        );
      } else {
        const stokerContent = stokerRow.content as {
          framingHook?: string;
          tensionAxis?: string;
          narrativeAngle?: string;
          dimensionAlignment?: Record<string, string>;
        };

        record(
          "execution",
          "STOKER context loaded",
          !!stokerContent.framingHook,
          stokerContent.framingHook
            ? `framingHook="${stokerContent.framingHook.slice(0, 80)}..."`
            : "missing framingHook",
        );

        if (stokerContent.framingHook && stokerContent.tensionAxis && stokerContent.narrativeAngle && stokerContent.dimensionAlignment) {
          // Load parent
          const [parent] = await db
            .select({ id: signals.id, shortcode: signals.shortcode })
            .from(signals)
            .where(eq(signals.id, target.parentSignalId!))
            .limit(1);

          if (!parent) {
            record(
              "execution",
              "parent signal lookup",
              false,
              "parent not found",
            );
          } else {
            // Load knowledge context
            const fetchByTitle = async (title: string): Promise<string> => {
              const [doc] = await db
                .select({ content: knowledgeDocuments.content })
                .from(knowledgeDocuments)
                .where(
                  and(
                    eq(knowledgeDocuments.orgId, org.id),
                    eq(knowledgeDocuments.status, "active"),
                    ilike(knowledgeDocuments.title, title),
                  ),
                )
                .limit(1);
              return doc?.content ?? "";
            };
            const decade = target.manifestationDecade as "RCK" | "RCL" | "RCD";
            const playbookTitles: Record<string, string> = {
              RCK: "RCK Decade Playbook",
              RCL: "RCL Decade Playbook",
              RCD: "RCD Decade Playbook",
            };
            const [decadePlaybook, brandIdentity, materialsVocabulary] =
              await Promise.all([
                fetchByTitle(playbookTitles[decade]),
                fetchByTitle("BLIPS Brand Identity"),
                fetchByTitle("BLIPS Materials Playbook"),
              ]);

            console.log(
              `  → Calling FURNACE skill via runSkill (real LLM + DB write)…`,
            );

            const { runSkill } = await import("../src/lib/orc/orchestrator");
            const { furnaceSkill } = await import("../src/skills/furnace");
            void furnaceSkill;

            try {
              const start = Date.now();
              const result = await runSkill({
                agentKey: "FURNACE",
                orgId: org.id,
                signalId: target.id,
                input: {
                  signalId: target.id,
                  shortcode: target.shortcode,
                  workingTitle: target.workingTitle,
                  concept: target.concept ?? "",
                  manifestationDecade: decade,
                  parentSignalId: parent.id,
                  parentShortcode: parent.shortcode,
                  manifestation: {
                    framingHook: stokerContent.framingHook,
                    tensionAxis: stokerContent.tensionAxis,
                    narrativeAngle: stokerContent.narrativeAngle,
                    dimensionAlignment: stokerContent.dimensionAlignment,
                  },
                  knowledgeContext: {
                    decadePlaybook,
                    brandIdentity,
                    materialsVocabulary,
                  },
                  pastBriefsForDecade: [],
                },
              });

              const elapsed = Date.now() - start;

              record(
                "execution",
                "runSkill call succeeds",
                true,
                `${elapsed}ms, output type=${typeof result.output}, outputId=${result.outputId}`,
              );

              const out = result.output as {
                brandFitScore?: number;
                refused?: boolean;
                refusalReason?: string | null;
                designDirection?: string | null;
                tactileIntent?: string | null;
              };

              record(
                "execution",
                "brief output shape valid",
                typeof out.brandFitScore === "number" &&
                  typeof out.refused === "boolean",
                `brandFitScore=${out.brandFitScore}, refused=${out.refused}`,
              );

              if (out.refused === false) {
                record(
                  "execution",
                  "tactileIntent populated (premium-design rule)",
                  !!out.tactileIntent && out.tactileIntent.length > 50,
                  out.tactileIntent
                    ? `len=${out.tactileIntent.length}, excerpt: "${out.tactileIntent.slice(0, 100)}..."`
                    : "tactileIntent missing or too short",
                );
              } else {
                record(
                  "execution",
                  "refusal rationale populated",
                  !!out.refusalReason && out.refusalReason.length > 50,
                  out.refusalReason
                    ? `len=${out.refusalReason.length}`
                    : "refusalReason missing",
                );
              }

              // Verify brief landed in DB
              const [persisted] = await db
                .select({
                  id: agentOutputs.id,
                  status: agentOutputs.status,
                  content: agentOutputs.content,
                  sectionApprovals: agentOutputs.sectionApprovals,
                })
                .from(agentOutputs)
                .where(eq(agentOutputs.id, result.outputId))
                .limit(1);

              record(
                "execution",
                "brief persisted to agent_outputs",
                !!persisted,
                persisted
                  ? `status=${persisted.status}, sectionApprovals=${JSON.stringify(persisted.sectionApprovals)}`
                  : "row not found after insert",
              );

              // Verify manifestation status
              const [updated] = await db
                .select({ status: signals.status })
                .from(signals)
                .where(eq(signals.id, target.id))
                .limit(1);

              const expectedStatus = out.refused ? "FURNACE_REFUSED" : "IN_FURNACE";
              // Note: runSkill itself doesn't update signal status —
              // the Inngest handler does. This script bypasses Inngest
              // (calls runSkill directly), so signal status will remain
              // IN_FURNACE regardless of refusal. Document this clearly.
              record(
                "execution",
                "signal status (note: runSkill bypasses Inngest status flip)",
                true,
                `current=${updated?.status}, expected-from-Inngest-handler=${expectedStatus}`,
              );
            } catch (err) {
              record(
                "execution",
                "runSkill call",
                false,
                err instanceof Error
                  ? `${err.message.slice(0, 200)}`
                  : String(err),
              );
            }
          }
        }
      }
    }
  }

  // ─── Final report ────────────────────────────────────────────
  console.log("\n=== FINAL REPORT ===");
  const byStage: Record<string, { pass: number; fail: number }> = {};
  for (const r of results) {
    if (!byStage[r.stage]) byStage[r.stage] = { pass: 0, fail: 0 };
    if (r.pass) byStage[r.stage].pass++;
    else byStage[r.stage].fail++;
  }
  console.log("\nBy stage:");
  for (const [stage, counts] of Object.entries(byStage)) {
    const status = counts.fail === 0 ? "✓" : "⚠";
    console.log(`  ${status} ${stage}: ${counts.pass} pass / ${counts.fail} fail`);
  }
  const totalPass = results.filter((r) => r.pass).length;
  const totalFail = results.filter((r) => !r.pass).length;
  console.log(`\nTotal: ${totalPass} pass / ${totalFail} fail (${results.length} checks)`);
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[FURNACE pipeline verify] fatal:", err);
  process.exit(1);
});
