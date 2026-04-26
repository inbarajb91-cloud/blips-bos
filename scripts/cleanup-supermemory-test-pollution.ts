/**
 * One-shot cleanup — delete the smoke-test documents that landed in
 * the production org tag (`org-{orgId}`) before we introduced the
 * 'test' container.
 *
 * Strategy: list all documents in the production tag, identify any
 * that look like test data (smoke markers, test prefixes), delete
 * those by id. Cautious — does NOT touch anything outside known test
 * markers.
 *
 * Run once to clean up the four pollution rows Inba flagged. After
 * this, smoke tests use container='test' which writes to a separate
 * supermemory tenant (`org-test-{orgId}`), so this script should
 * never need to run again.
 *
 * Usage: npx tsx scripts/cleanup-supermemory-test-pollution.ts
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

const TEST_MARKERS = [
  /SMOKE-/i,
  /SMOKE TEST/i,
  /smoke[ -]?test/i,
  /test[- ]?marker/i,
  /BLIPS Supermemory Wra/i, // first smoke test's auto-extracted title
  /Review of BIOCAR Signal/i, // smoke test conversation_summary auto-extracted
  /Dismissal of SMOKE/i,
];

function looksLikeTestData(content: string | null | undefined, title?: string | null): boolean {
  const haystack = `${title ?? ""}\n${content ?? ""}`;
  return TEST_MARKERS.some((re) => re.test(haystack));
}

async function main() {
  if (!process.env.SUPERMEMORY_API_KEY) {
    console.error("✗ SUPERMEMORY_API_KEY missing");
    process.exit(1);
  }
  const Supermemory = (await import("supermemory")).default;
  const { db } = await import("../src/db");
  const { orgs } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) throw new Error("BLIPS org not found");

  const client = new Supermemory({ apiKey: process.env.SUPERMEMORY_API_KEY });
  const containerTag = `org-${org.id}`;

  console.log(`Listing documents in containerTag=${containerTag}…\n`);

  // Paginate through ALL documents — pre-CodeRabbit-pass-1 we only
  // fetched page 1 (limit:100), which means once production grows past
  // 100 docs the cleanup misses test artifacts on page 2+ and falsely
  // reports "clean." documents.list returns { memories, pagination:
  // { currentPage, totalPages, totalItems } }. Loop until we've
  // visited every page.
  // Note: containerTags is the deprecated array param but it's what
  // documents.list still accepts at v4.21 — verified in node_modules.
  type ListResp = {
    memories?: Array<{
      id: string;
      title?: string | null;
      content?: string | null;
      metadata?: unknown;
    }>;
    pagination?: {
      currentPage?: number;
      totalPages?: number;
      totalItems?: number;
    };
  };

  type DocRow = {
    id: string;
    title?: string | null;
    content?: string | null;
    metadata?: unknown;
  };

  const docs: DocRow[] = [];
  let page = 1;
  while (true) {
    const listResp = (await client.documents.list({
      containerTags: [containerTag],
      includeContent: true,
      limit: 100,
      page,
    } as Parameters<typeof client.documents.list>[0])) as ListResp;
    const pageDocs = listResp.memories ?? [];
    docs.push(...pageDocs);
    const totalPages = listResp.pagination?.totalPages ?? 1;
    if (page >= totalPages || pageDocs.length === 0) break;
    page++;
  }

  console.log(
    `Found ${docs.length} document(s) in production tag (across ${page} page(s)).\n`,
  );

  const toDelete: { id: string; title: string }[] = [];
  for (const d of docs) {
    if (looksLikeTestData(d.content, d.title)) {
      toDelete.push({ id: d.id, title: (d.title ?? d.content?.slice(0, 60) ?? "(no title)").trim() });
    } else {
      console.log(`  KEEP  ${d.id.slice(0, 16)}…  "${(d.title ?? d.content?.slice(0, 60) ?? "?").trim()}"`);
    }
  }

  if (toDelete.length === 0) {
    console.log("\n✓ No test pollution found. Nothing to clean up.");
    await db.$client.end();
    return;
  }

  console.log(`\nWill delete ${toDelete.length} test document(s):`);
  for (const d of toDelete) {
    console.log(`  DEL   ${d.id.slice(0, 16)}…  "${d.title}"`);
  }

  // Delete one by one (safer than bulk; we get per-doc errors if any fail)
  let ok = 0;
  let fail = 0;
  for (const d of toDelete) {
    try {
      await client.documents.delete(d.id);
      ok++;
    } catch (e) {
      console.error(`  ✗ Failed to delete ${d.id}:`, e);
      fail++;
    }
  }

  console.log(`\n✓ Deleted ${ok}/${toDelete.length} test documents (${fail} failed).`);
  console.log(
    `\nProduction tag is now clean. Future smoke tests use container='test' which writes to org-test-${org.id} (separate tenant) and will never pollute production again.`,
  );

  await db.$client.end();
}

main().catch((err) => {
  console.error("\n✗ Cleanup crashed:", err);
  process.exit(1);
});
