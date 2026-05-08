/**
 * Probe a model id from the CLI — Phase 3.5.
 *
 * Useful when:
 *   - Debugging "is this model string actually accepted by the provider?"
 *   - Verifying that an env key (e.g. OPENROUTER_API_KEY) is set + valid
 *   - Comparing latency across models without going through the UI
 *
 * Usage:
 *   npx tsx scripts/probe-model.ts <model-id> [more model-ids...]
 *
 * Exit code: 0 when every probe succeeded; 1 if any failed.
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

async function main() {
  const modelIds = process.argv.slice(2);
  if (modelIds.length === 0) {
    console.error(
      "Usage: npx tsx scripts/probe-model.ts <model-id> [more model-ids...]\n\n" +
        "Examples:\n" +
        "  npx tsx scripts/probe-model.ts gemini-2.5-pro\n" +
        "  npx tsx scripts/probe-model.ts openai/gpt-4o claude-haiku-4.5\n" +
        "  npx tsx scripts/probe-model.ts openrouter/moonshotai/kimi-k2",
    );
    process.exit(2);
  }

  const { resolveProvider } = await import("../src/lib/ai/providers");
  const { getModel } = await import("../src/lib/ai/model-router");
  const { generateText } = await import("ai");

  let anyFailed = false;
  for (const id of modelIds) {
    const start = Date.now();
    const resolved = resolveProvider(id);
    if (!resolved) {
      console.log(
        `✗ ${id.padEnd(50)} — could not resolve provider. Use a known prefix (openai/, openrouter/, anthropic/, etc.) or a known bare id (gemini-, claude-, gpt-).`,
      );
      anyFailed = true;
      continue;
    }

    const provider = resolved.provider;
    process.stdout.write(`▸ ${id.padEnd(50)} → ${provider.id.padEnd(14)} `);

    try {
      const r = await generateText({
        model: getModel(id),
        prompt: "Reply with the single word OK.",
        maxOutputTokens: 4,
        temperature: 0.0,
      });
      const ms = Date.now() - start;
      const text = (r.text ?? "").trim().slice(0, 24);
      console.log(`OK · ${ms}ms · "${text}"`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const ms = Date.now() - start;
      console.log(`FAIL · ${ms}ms · ${msg.slice(0, 200)}`);
      anyFailed = true;
    }
  }

  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => {
  console.error("[probe-model] fatal:", e);
  process.exit(1);
});
