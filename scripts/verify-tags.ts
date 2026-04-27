/**
 * Diagnostic — list document counts for every supermemory tag we
 * care about, derived from the live `orgs` table. Useful as a
 * sanity check after running migrate-supermemory-tags.ts or any
 * time you want to confirm the dashboard's bucket distribution.
 *
 * CodeRabbit pass on PR #6 caught two issues with the previous
 * version:
 *   1. Tags were hardcoded ("blips" + one UUID), so the script
 *      would silently miss any other org. Now the tag list is
 *      derived from `orgs` directly — same source the wrapper
 *      reads from, so they're always in sync.
 *   2. The previous count was just `memories.length` from page 1
 *      of documents.list, which under-reports any tag with >100
 *      docs. Now we paginate to exhaustion and sum.
 *
 * Run via: npx tsx scripts/verify-tags.ts
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

async function main() {
  if (!process.env.SUPERMEMORY_API_KEY) {
    console.error("[verify] SUPERMEMORY_API_KEY missing in env");
    process.exit(1);
  }

  const Supermemory = (await import("supermemory")).default;
  const { db, orgs } = await import("@/db");
  const client = new Supermemory({
    apiKey: process.env.SUPERMEMORY_API_KEY!,
  });

  // Derive the tag list from the orgs table — same source the
  // supermemory wrapper reads from. Each org gets four tags:
  // legacy uuid + legacy test uuid (expected 0 post-migration),
  // and the new slug-based per-container tags.
  const orgRows = await db
    .select({ id: orgs.id, slug: orgs.slug })
    .from(orgs);

  if (orgRows.length === 0) {
    console.log("[verify] no orgs found — nothing to check");
    return;
  }

  type TagSpec = { tag: string; note: string };
  const tagsToCheck: TagSpec[] = [];
  for (const org of orgRows) {
    tagsToCheck.push({
      tag: `org-${org.slug}-events`,
      note: `${org.slug} events (current)`,
    });
    tagsToCheck.push({
      tag: `org-${org.slug}-knowledge`,
      note: `${org.slug} knowledge (current)`,
    });
    tagsToCheck.push({
      tag: `org-test-${org.slug}`,
      note: `${org.slug} test (current)`,
    });
    tagsToCheck.push({
      tag: `org-${org.id}`,
      note: `${org.slug} legacy uuid (should be 0)`,
    });
    tagsToCheck.push({
      tag: `org-test-${org.id}`,
      note: `${org.slug} legacy test uuid (should be 0)`,
    });
  }

  for (const { tag, note } of tagsToCheck) {
    const total = await countAllInTag(client, tag);
    console.log(`${tag.padEnd(50)} → ${String(total).padStart(4)} doc(s)  · ${note}`);
  }
}

/**
 * Page-scan documents.list until the response is shorter than
 * `perPage` (the standard end-of-pagination signal), summing the
 * count. supermemory caps page size at 100 and paginates with
 * `page` (1-indexed). A safety stop at 1000 pages prevents a
 * pagination bug from spinning forever.
 */
async function countAllInTag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  containerTag: string,
): Promise<number> {
  const perPage = 100;
  let total = 0;
  let page = 1;

  while (true) {
    const resp = await client.documents.list({
      containerTags: [containerTag],
      limit: perPage,
      page,
      includeContent: false,
    });
    const memories = resp.memories ?? [];
    total += memories.length;
    if (memories.length < perPage) break;
    page++;
    if (page > 1000) {
      console.warn(
        `[verify] safety cap hit at page ${page} for tag ${containerTag} — count is a lower bound`,
      );
      break;
    }
  }

  return total;
}

main().catch((err) => {
  // Don't dump raw SDK errors — see scripts/migrate-supermemory-tags.ts
  // for rationale. Keep the verifier safe to run in any shell.
  if (err instanceof Error) {
    console.error(`[verify] fatal: ${err.name}: ${err.message}`);
  } else {
    console.error("[verify] fatal: unknown error");
  }
  process.exit(1);
});
