/**
 * Reproduce the page's data fetching + RSC serialization for a signal,
 * bypassing auth. If JSON serialization fails (which is what React
 * Server Components do internally to stream to the client), that's the
 * bug. Plain Node reproduction — no browser, no auth.
 *
 * Usage: npx tsx scripts/repro-page-render.ts RANSOM
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
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const SHORTCODE = process.argv[2] ?? "RANSOM";

async function main() {
  const { db } = await import("../src/db");
  const { signals: signalsTable, agentOutputs: agentOutputsTable } =
    await import("../src/db/schema");
  const { eq, and, inArray, asc } = await import("drizzle-orm");

  console.log(`=== Reproducing page render for ${SHORTCODE} ===\n`);

  // Step 1: Load signal (skip orgId scope — just match shortcode)
  const [signal] = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.shortcode, SHORTCODE))
    .limit(1);
  if (!signal) {
    console.error("Signal not found");
    process.exit(1);
  }
  console.log(`✓ signal loaded: ${signal.shortcode}, status=${signal.status}, parent=${signal.parentSignalId ?? "null"}`);

  // Step 2: Load parent's STOKER agent_outputs (parent's STOKER tab data)
  const [parentStokerOutputRow] = await db
    .select({
      id: agentOutputsTable.id,
      content: agentOutputsTable.content,
      status: agentOutputsTable.status,
    })
    .from(agentOutputsTable)
    .where(
      and(
        eq(agentOutputsTable.signalId, signal.id),
        eq(agentOutputsTable.agentName, "STOKER"),
      ),
    )
    .orderBy(asc(agentOutputsTable.createdAt))
    .limit(1);

  if (!parentStokerOutputRow) {
    console.log("No parent STOKER output — nothing to reproduce");
    process.exit(0);
  }
  console.log(`✓ parent STOKER output loaded: ${parentStokerOutputRow.id}, status=${parentStokerOutputRow.status}`);

  // Step 3: Load children + their outputs (the modified Phase 10 path)
  const children = await db
    .select({
      id: signalsTable.id,
      shortcode: signalsTable.shortcode,
      status: signalsTable.status,
      manifestationDecade: signalsTable.manifestationDecade,
      workingTitle: signalsTable.workingTitle,
    })
    .from(signalsTable)
    .where(eq(signalsTable.parentSignalId, signal.id));
  console.log(`✓ children loaded: ${children.length}`);

  const childIds = children.map((c) => c.id);
  const childOutputs = childIds.length
    ? await db
        .select({
          id: agentOutputsTable.id,
          signalId: agentOutputsTable.signalId,
          agentName: agentOutputsTable.agentName,
          status: agentOutputsTable.status,
          content: agentOutputsTable.content,
          revisions: agentOutputsTable.revisions,
          createdAt: agentOutputsTable.createdAt,
        })
        .from(agentOutputsTable)
        .where(
          and(
            inArray(agentOutputsTable.agentName, ["STOKER", "FURNACE"]),
            inArray(agentOutputsTable.signalId, childIds),
          ),
        )
        .orderBy(
          asc(agentOutputsTable.signalId),
          asc(agentOutputsTable.createdAt),
        )
    : [];
  console.log(`✓ child outputs loaded: ${childOutputs.length} rows`);

  // Step 4: Build the maps (Phase 10 page change)
  const outputBySignal = new Map<string, (typeof childOutputs)[number]>();
  const outputByAgent = new Map<string, (typeof childOutputs)[number]>();
  for (const o of childOutputs) {
    const agentKey = `${o.signalId}::${o.agentName}`;
    if (!outputByAgent.has(agentKey)) outputByAgent.set(agentKey, o);
    if (o.agentName === "STOKER" && !outputBySignal.has(o.signalId)) {
      outputBySignal.set(o.signalId, o);
    }
  }
  console.log(`✓ maps built: outputBySignal=${outputBySignal.size}, outputByAgent=${outputByAgent.size}`);

  // Step 5: Build stokerData (parent's STOKER tab data)
  const stokerData = {
    parentOutput: {
      id: parentStokerOutputRow.id,
      content: parentStokerOutputRow.content as Record<string, unknown>,
      status: parentStokerOutputRow.status,
    },
    children: children.map((c) => {
      const out = outputBySignal.get(c.id);
      return {
        id: c.id,
        shortcode: c.shortcode,
        status: c.status,
        decade: c.manifestationDecade as "RCK" | "RCL" | "RCD",
        outputStatus: out?.status ?? null,
        outputContent: (out?.content ?? null) as Record<string, unknown> | null,
      };
    }),
  };
  console.log(`✓ stokerData built with ${stokerData.children.length} children`);

  // Step 6: Build manifestations array (Phase 10 — extended to include FURNACE)
  const manifestations = children.map((c) => {
    const stokerOut = outputByAgent.get(`${c.id}::STOKER`);
    const furnaceOut = outputByAgent.get(`${c.id}::FURNACE`);
    const stokerDetail = stokerOut
      ? {
          id: stokerOut.id,
          content: (stokerOut.content ?? {}) as Record<string, unknown>,
          status: stokerOut.status,
          revisionsCount: Array.isArray(stokerOut.revisions)
            ? stokerOut.revisions.length
            : 0,
        }
      : null;
    const furnaceDetail = furnaceOut
      ? {
          id: furnaceOut.id,
          content: (furnaceOut.content ?? {}) as Record<string, unknown>,
          status: furnaceOut.status,
          revisionsCount: Array.isArray(furnaceOut.revisions)
            ? furnaceOut.revisions.length
            : 0,
        }
      : null;
    return {
      id: c.id,
      shortcode: c.shortcode,
      title: c.workingTitle,
      decade: c.manifestationDecade,
      status: c.status,
      outputs: { STOKER: stokerDetail, FURNACE: furnaceDetail },
    };
  });
  console.log(`✓ manifestations array built: ${manifestations.length} entries`);

  // ── Step 7: simulate RSC serialization (this is what Next.js does) ──
  // React Server Components serialize props to JSON for streaming to
  // the client. If serialization fails for any value, the corresponding
  // React tree position throws "An error occurred in the Server
  // Components render." This is the most likely cause of per-card errors.
  console.log("\n=== Testing JSON serialization (RSC simulation) ===");

  const propsForRenderer = {
    signal,
    stokerData,
    manifestations,
  };

  // Try whole-payload serialization first
  try {
    const json = JSON.stringify(propsForRenderer);
    console.log(`✓ whole payload serializes (${json.length} chars)`);
  } catch (err) {
    console.error(`✗ whole payload FAILED to serialize:`, err);
  }

  // Per-child serialization to isolate which one fails
  console.log("\nPer-child serialization:");
  for (const c of stokerData.children) {
    try {
      const json = JSON.stringify(c);
      console.log(`  ✓ ${c.shortcode} (${c.decade}): ${json.length} chars`);
    } catch (err) {
      console.error(`  ✗ ${c.shortcode} (${c.decade}) FAILED:`, err);
    }
  }

  console.log("\nPer-manifestation serialization:");
  for (const m of manifestations) {
    try {
      const json = JSON.stringify(m);
      console.log(`  ✓ ${m.shortcode} (${m.decade}): ${json.length} chars`);
    } catch (err) {
      console.error(`  ✗ ${m.shortcode} (${m.decade}) FAILED:`, err);
    }
  }

  // Also walk parentOutput.content.decades — what the StokerResonance
  // renderer iterates over
  console.log("\nPer-decade serialization (from parent's STOKER content):");
  const parentContent = stokerData.parentOutput.content as {
    decades?: Array<Record<string, unknown>>;
  };
  if (Array.isArray(parentContent.decades)) {
    for (const d of parentContent.decades) {
      try {
        const json = JSON.stringify(d);
        const decadeKey = d.decade as string;
        console.log(`  ✓ decade ${decadeKey}: ${json.length} chars`);
      } catch (err) {
        console.error(`  ✗ decade ${d.decade} FAILED:`, err);
      }
    }
  }

  // ── Step 8: Per-row deep type check — look for non-plain values ──
  console.log("\n=== Type audit (looking for non-plain values) ===");
  function audit(label: string, obj: unknown, path: string = ""): void {
    if (obj === null || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (v === null) continue;
      const t = typeof v;
      if (t === "function") {
        console.log(`  ⚠ ${label} ${p}: FUNCTION (not serializable)`);
      } else if (t === "symbol") {
        console.log(`  ⚠ ${label} ${p}: SYMBOL (not serializable)`);
      } else if (t === "bigint") {
        console.log(`  ⚠ ${label} ${p}: BIGINT (not JSON-serializable)`);
      } else if (v instanceof Date) {
        console.log(`  · ${label} ${p}: Date (${v.toISOString()})`);
      } else if (v instanceof Map || v instanceof Set) {
        console.log(`  ⚠ ${label} ${p}: ${v.constructor.name} (not JSON-serializable)`);
      } else if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) audit(label, v[i], `${p}[${i}]`);
      } else if (t === "object") {
        // Check if it's a plain object
        const proto = Object.getPrototypeOf(v);
        if (proto !== null && proto !== Object.prototype) {
          console.log(
            `  ⚠ ${label} ${p}: non-plain object (${proto?.constructor?.name})`,
          );
        }
        audit(label, v, p);
      }
    }
  }
  audit("[signal]", signal);
  audit("[stokerData]", stokerData);
  audit("[manifestations]", manifestations);

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
