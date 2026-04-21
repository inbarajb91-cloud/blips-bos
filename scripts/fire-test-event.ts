/**
 * Fire a `test.run` event into Inngest Cloud from this machine.
 *
 * Production Inngest routes it to our Vercel function at
 * https://blips-bos.vercel.app/api/inngest → the `testRun` handler → returns
 * a small echo payload. You should see the run on Inngest dashboard → Runs
 * within a few seconds, with status=Completed.
 *
 * Usage: npx tsx scripts/fire-test-event.ts
 */

import { readFileSync } from "node:fs";

// Load .env.local — we need INNGEST_EVENT_KEY
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

if (!process.env.INNGEST_EVENT_KEY) {
  console.error("✗ INNGEST_EVENT_KEY not set in .env.local");
  process.exit(1);
}

async function main() {
  const { Inngest } = await import("inngest");

  const inngest = new Inngest({
    id: "blips-bos",
    eventKey: process.env.INNGEST_EVENT_KEY!,
  });

  const message = `Phase 5 end-to-end test @ ${new Date().toISOString()}`;

  console.log("→ Firing test.run event to Inngest Cloud...");
  console.log(`  message: "${message}"`);

  const result = await inngest.send({
    name: "test.run",
    data: { message },
  });

  console.log("\n✓ Event accepted by Inngest Cloud");
  console.log(`  event IDs: ${JSON.stringify(result.ids)}`);
  console.log("\nNext: open Inngest dashboard → Runs");
  console.log(
    "      https://app.inngest.com/env/production/runs",
  );
  console.log(
    "      Look for a test-run invocation in the last few seconds.",
  );
  console.log(
    "      Status should be Completed, output should contain your message echoed back.",
  );
}

main().catch((e) => {
  console.error("✗ Event fire failed:", (e as Error).message);
  process.exit(1);
});
