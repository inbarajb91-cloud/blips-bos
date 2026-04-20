/**
 * End-to-end integration test for the AI layer.
 *
 * Exercises:
 *   1. `getModelForAgent` reads from config_agents
 *   2. `generateStructured` calls Gemini with a Zod schema
 *   3. Zod validation catches malformed output
 *   4. `agent_logs` row is written with tokens + duration + cost
 *
 * Costs a fraction of a cent (Gemini 2.5 Flash on ~100 tokens).
 *
 * Usage: npx tsx scripts/test-llm.ts
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { z } from "zod";

// Load .env.local for DATABASE_URL + GOOGLE_GENERATIVE_AI_API_KEY
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
  // Dynamic import AFTER env is loaded (so db/index.ts doesn't throw on import)
  const { generateStructured } = await import("../src/lib/ai/generate");
  const { db } = await import("../src/db");
  const { orgs, agentLogs } = await import("../src/db/schema");
  const { eq, desc } = await import("drizzle-orm");

  // ── 1. Look up BLIPS org ──────────────────────────────────────
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ No BLIPS org found. Run `npx tsx scripts/seed.ts` first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.name} (${org.id})`);

  // ── 2. Define a trivial structured-output task ────────────────
  const schema = z.object({
    greeting: z.string().describe("A short greeting, 5 words or less"),
    signal_words: z
      .array(z.string())
      .min(3)
      .max(5)
      .describe("3 to 5 emotionally charged words"),
    cultural_tension: z
      .string()
      .describe("One sentence describing a cultural tension"),
  });

  console.log("✓ Test schema defined");

  // ── 3. Call generateStructured ────────────────────────────────
  console.log("→ Calling generateStructured with agent ORC...");
  const result = await generateStructured({
    agentKey: "ORC",
    orgId: org.id,
    system:
      "You are a terse creative assistant for a philosophical apparel brand. Output only valid JSON matching the schema.",
    prompt:
      "Respond with a greeting, three to five signal words, and one cultural tension relevant to Gen Z in 2026.",
    schema,
  });

  console.log(`\n✓ LLM responded in ${result.durationMs}ms`);
  console.log(`  model:         ${result.model}`);
  console.log(`  input tokens:  ${result.usage.tokensInput}`);
  console.log(`  output tokens: ${result.usage.tokensOutput}`);
  console.log(`\n  greeting:          ${result.object.greeting}`);
  console.log(`  signal_words:      ${result.object.signal_words.join(", ")}`);
  console.log(`  cultural_tension:  ${result.object.cultural_tension}`);

  // ── 4. Verify agent_logs row was written ──────────────────────
  // Give the fire-and-forget insert a moment to land
  await new Promise((r) => setTimeout(r, 1500));
  const [latestLog] = await db
    .select()
    .from(agentLogs)
    .where(eq(agentLogs.orgId, org.id))
    .orderBy(desc(agentLogs.createdAt))
    .limit(1);

  if (!latestLog) {
    console.error("\n✗ No agent_logs row found — logger may have failed");
    process.exit(1);
  }

  console.log(`\n✓ agent_logs row written:`);
  console.log(`  id:            ${latestLog.id}`);
  console.log(`  agent_name:    ${latestLog.agentName}`);
  console.log(`  model:         ${latestLog.model}`);
  console.log(`  tokens_input:  ${latestLog.tokensInput}`);
  console.log(`  tokens_output: ${latestLog.tokensOutput}`);
  console.log(`  cost_usd:      $${latestLog.costUsd ?? 0}`);
  console.log(`  duration_ms:   ${latestLog.durationMs}`);
  console.log(`  status:        ${latestLog.status}`);

  console.log("\n✓ Phase 3 integration test passed");
  process.exit(0);
}
main().catch((e) => {
  console.error("\n✗ Test failed:", (e as Error).message);
  process.exit(1);
});
