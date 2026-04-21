/**
 * End-to-end test for the ORC orchestrator (runSkill).
 *
 * Flow:
 *   1. Look up BLIPS org
 *   2. Register a mock BUNKER skill inline (throwaway, process-scoped)
 *   3. Create a disposable test signal row (FK target for agent_outputs)
 *   4. Call runSkill — exercises: loadSkill -> generateStructured ->
 *      agent_logs write (×3: skill_loaded, llm_call, output_written) ->
 *      agent_outputs insert
 *   5. Verify the output row + logs exist
 *   6. Clean up the test signal
 *
 * Uses one real Gemini 2.5 Flash call (~100 tokens, <$0.001).
 *
 * Usage: npx tsx scripts/test-orchestrator.ts
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Load .env.local BEFORE anything else imports from src/
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

async function main() {
  // Dynamic imports so .env is loaded first
  const { z } = await import("zod");
  const { eq, desc, and } = await import("drizzle-orm");
  const { registerSkill } = await import("../src/skills");
  const { runSkill } = await import("../src/lib/orc/orchestrator");
  const { db } = await import("../src/db");
  const {
    orgs,
    signals,
    agentOutputs,
    agentLogs,
  } = await import("../src/db/schema");

  // ── 1. Look up BLIPS org ──────────────────────────────────────
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ No BLIPS org. Run scripts/seed.ts first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.name} (${org.id})`);

  // ── 2. Register mock BUNKER skill ─────────────────────────────
  registerSkill({
    name: "BUNKER",
    description: "Phase 5 mock BUNKER — validates orchestrator plumbing",
    inputSchema: z.object({
      message: z.string(),
    }),
    outputSchema: z.object({
      shortcode: z
        .string()
        .regex(/^[A-Z]{3,6}$/)
        .describe("3-6 uppercase letters"),
      working_title: z.string().describe("Short noun phrase, under 40 chars"),
      concept: z.string().describe("One sentence describing the core tension"),
    }),
    systemPrompt:
      "You are BUNKER, signal detection for a philosophical apparel brand. Output valid JSON matching the schema exactly.",
    buildPrompt: (input) =>
      `Generate a sample signal from this raw input: ${(input as { message: string }).message}`,
  });
  console.log("✓ Mock BUNKER skill registered");

  // ── 3. Create disposable test signal ──────────────────────────
  const testShortcode = `T${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;
  const [testSignal] = await db
    .insert(signals)
    .values({
      orgId: org.id,
      shortcode: testShortcode,
      workingTitle: "Phase 5 orchestrator test signal",
      source: "direct",
      status: "IN_BUNKER",
    })
    .returning();
  console.log(`✓ Test signal created: ${testSignal.shortcode} (${testSignal.id})`);

  // ── 4. Run the orchestrator ───────────────────────────────────
  console.log("\n→ Calling runSkill(BUNKER)...");
  const result = await runSkill({
    agentKey: "BUNKER",
    orgId: org.id,
    signalId: testSignal.id,
    input: { message: "quiet rebellion against burnout culture in 2026" },
  });

  console.log(`\n✓ Orchestrator completed in ${result.durationMs}ms`);
  console.log(`  model:       ${result.model}`);
  console.log(`  tokens:      ${result.usage.totalTokens} total`);
  console.log(`  outputId:    ${result.outputId}`);
  console.log(`\n  shortcode:      ${(result.output as { shortcode: string }).shortcode}`);
  console.log(
    `  working_title:  ${(result.output as { working_title: string }).working_title}`,
  );
  console.log(
    `  concept:        ${(result.output as { concept: string }).concept}`,
  );

  // ── 5. Verify DB state ────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 1500)); // let fire-and-forget logs land

  const [outputRow] = await db
    .select()
    .from(agentOutputs)
    .where(eq(agentOutputs.id, result.outputId));
  if (!outputRow) {
    console.error("\n✗ agent_outputs row not found");
    process.exit(1);
  }
  console.log(`\n✓ agent_outputs row written:`);
  console.log(`  status:       ${outputRow.status}`);
  console.log(`  output_type:  ${outputRow.outputType}`);

  const logs = await db
    .select()
    .from(agentLogs)
    .where(
      and(
        eq(agentLogs.signalId, testSignal.id),
        eq(agentLogs.agentName, "BUNKER"),
      ),
    )
    .orderBy(desc(agentLogs.createdAt));

  console.log(`\n✓ agent_logs: ${logs.length} row(s) for this run`);
  for (const log of logs) {
    console.log(
      `  - ${log.action.padEnd(18)} ${log.status.padEnd(8)} ${
        log.durationMs !== null ? `${log.durationMs}ms` : "-"
      } ${log.costUsd !== null ? `$${log.costUsd}` : ""}`,
    );
  }

  // ── 6. Cleanup ────────────────────────────────────────────────
  await db.delete(signals).where(eq(signals.id, testSignal.id));
  console.log(`\n✓ Cleaned up test signal ${testSignal.shortcode}`);
  // agent_outputs + agent_logs for this signal cascade via FK onDelete

  console.log("\n✓ Phase 5 orchestrator test passed");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗ Test failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
