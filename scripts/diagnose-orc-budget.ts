/**
 * Diagnostic: trace why /api/orc/reply rejected with 413 on a specific
 * signal (e.g. LEDGR). Prints exactly which budget bucket breached so
 * we can fix the right thing instead of guessing.
 *
 * Also: checks for duplicate shortcodes in the signals table — that's
 * the most likely cause of the ROOTS page server-error.
 *
 * Usage: npx tsx scripts/diagnose-orc-budget.ts
 */

import { readFileSync } from "node:fs";

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
  const { db } = await import("../src/db");
  const { signals, agentConversations } = await import("../src/db/schema");
  const { eq, and, sql } = await import("drizzle-orm");
  const { ORC_SYSTEM_PROMPT } = await import("../src/lib/orc/system-prompt");
  const { BRAND_DNA } = await import("../src/lib/orc/brand-dna");
  const { estimateTokens, ORC_BUDGET } = await import(
    "../src/lib/ai/token-count"
  );
  const { buildOrcPromptContext, buildSignalCore } = await import(
    "../src/lib/orc/context-builder"
  );

  // ── 1. Static prefix size — independent of any signal/conversation
  console.log("─── 1. STATIC PREFIX SIZES ───\n");
  const sysTok = estimateTokens(ORC_SYSTEM_PROMPT, "prose");
  const brandTok = estimateTokens(BRAND_DNA, "prose");
  console.log(
    `  ORC_SYSTEM_PROMPT  ${ORC_SYSTEM_PROMPT.length.toString().padStart(5)} chars  ≈ ${sysTok} tokens`,
  );
  console.log(
    `  BRAND_DNA          ${BRAND_DNA.length.toString().padStart(5)} chars  ≈ ${brandTok} tokens`,
  );
  console.log(
    `  Combined (no signal core yet) ≈ ${sysTok + brandTok} tokens (bucket cap = ${ORC_BUDGET.system_brand_signal})`,
  );
  if (sysTok + brandTok > ORC_BUDGET.system_brand_signal) {
    console.log(
      `  ✗ FAIL: prefix alone exceeds the system_brand_signal bucket. This explains the 413 — every signal hits it.`,
    );
  } else {
    console.log(
      `  ✓ Prefix fits with ${ORC_BUDGET.system_brand_signal - sysTok - brandTok} tokens headroom for signal core.`,
    );
  }

  // ── 2. Per-signal trace — load LEDGR and run the real builder
  console.log("\n─── 2. SIGNAL TRACE: LEDGR ───\n");
  const [ledgr] = await db
    .select()
    .from(signals)
    .where(eq(signals.shortcode, "LEDGR"))
    .limit(1);
  if (!ledgr) {
    console.log("  (LEDGR not found in DB — skip)");
  } else {
    const signalCore = buildSignalCore(ledgr);
    const sigTok = estimateTokens(signalCore, "structured");
    console.log(
      `  Signal core  ${signalCore.length.toString().padStart(5)} chars  ≈ ${sigTok} tokens`,
    );
    console.log(
      `  System+Brand+Signal total ≈ ${sysTok + brandTok + sigTok} tokens (cap ${ORC_BUDGET.system_brand_signal})`,
    );

    const [conv] = await db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.signalId, ledgr.id),
          eq(agentConversations.agentName, "ORC"),
        ),
      )
      .limit(1);
    if (conv) {
      const messages = (conv.messages as unknown as import("../src/lib/actions/conversations").Message[]) ?? [];
      console.log(`  Loaded ORC conversation: ${messages.length} messages`);
      const ctx = buildOrcPromptContext({
        signal: ledgr,
        messages,
        metadata: (conv.metadata as Record<string, unknown>) ?? {},
        currentUserMessage: "So what do you think about this Signal",
        activeStage: "BUNKER" as const,
      });
      console.log(`\n  Token estimate breakdown:`);
      console.log(
        `    system_brand_signal: ${ctx.tokenEstimate.system_brand_signal} (cap ${ORC_BUDGET.system_brand_signal})`,
      );
      console.log(
        `    summary:             ${ctx.tokenEstimate.summary} (cap ${ORC_BUDGET.summary})`,
      );
      console.log(
        `    verbatim:            ${ctx.tokenEstimate.verbatim} (cap ${ORC_BUDGET.verbatim})`,
      );
      console.log(
        `    current_message:     ${ctx.tokenEstimate.current_message} (cap ${ORC_BUDGET.current_message})`,
      );
      console.log(`    TOTAL:               ${ctx.budget.totalTokens} (cap ${ORC_BUDGET.total_input})`);
      console.log(`\n  Budget OK?                       ${ctx.budget.ok}`);
      console.log(`  Breaches:                        ${ctx.budget.breaches.join(", ") || "(none)"}`);
      console.log(`  needsSummarization?              ${ctx.needsSummarization}`);
      console.log(`  overBudgetAfterSummarization?    ${ctx.overBudgetAfterSummarization}`);
      if (ctx.overBudgetAfterSummarization) {
        console.log(`\n  ✗ This is the 413 path. Specifically because:`);
        if (ctx.budget.breaches.includes("system_brand_signal")) {
          console.log(`    - system_brand_signal breaches alone — summarization can't help.`);
        }
        if (ctx.budget.breaches.includes("current_message")) {
          console.log(`    - current_message breaches — user message itself too long.`);
        }
      }
    }
  }

  // ── 3. ROOTS duplicates — likely cause of the page server-error
  console.log("\n─── 3. ROOTS DUPLICATE CHECK ───\n");
  const rootsRows = await db
    .select({
      id: signals.id,
      shortcode: signals.shortcode,
      workingTitle: signals.workingTitle,
      status: signals.status,
      createdAt: signals.createdAt,
    })
    .from(signals)
    .where(eq(signals.shortcode, "ROOTS"));
  console.log(`  Found ${rootsRows.length} signal(s) with shortcode='ROOTS':`);
  for (const r of rootsRows) {
    console.log(
      `    - ${r.id}  "${r.workingTitle}"  [${r.status}]  created ${r.createdAt}`,
    );
  }
  if (rootsRows.length > 1) {
    console.log(
      `\n  ✗ Multiple ROOTS rows exist. Routes that resolve by shortcode (e.g. /engine-room/signals/ROOTS) will collide.`,
    );
  }

  // Also: any other duplicate shortcodes?
  const dups = await db.execute(sql`
    SELECT shortcode, COUNT(*) AS n
    FROM signals
    GROUP BY shortcode
    HAVING COUNT(*) > 1
    ORDER BY n DESC
  `);
  const dupRows = dups as unknown as Array<{ shortcode: string; n: number }>;
  if (dupRows.length > 0) {
    console.log(`\n  ALL duplicate shortcodes in DB:`);
    for (const d of dupRows) console.log(`    - ${d.shortcode}: ${d.n} rows`);
  } else {
    console.log(`\n  No other duplicate shortcodes.`);
  }

  await db.$client.end();
}

main().catch((err) => {
  console.error("\n✗ Diagnostic crashed:", err);
  process.exit(1);
});
