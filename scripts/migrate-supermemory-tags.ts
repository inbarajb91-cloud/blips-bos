/**
 * One-shot migration — switch supermemory tags from UUID-based to
 * slug-based per-container layout.
 *
 * BEFORE
 *   org-{uuid}             → events + knowledge co-mingled
 *   org-test-{uuid}        → isolated test tenant
 *
 * AFTER
 *   org-{slug}-events      → e.g. org-blips-events
 *   org-{slug}-knowledge   → e.g. org-blips-knowledge
 *   org-test-{slug}        → e.g. org-test-blips
 *
 * Why: the UUID tag is unreadable in supermemory's dashboard. Splitting
 * containers into separate tags also lets us scope at the supermemory
 * boundary instead of post-filtering metadata.container in JS.
 *
 * Strategy (clean break — Option B):
 *   1. For each org:
 *        a. Page-scan documents in the OLD tag (org-{uuid})
 *        b. Page-scan documents in the OLD test tag (org-test-{uuid})
 *        c. Bulk-delete by id (in chunks of 100)
 *   2. Clear knowledge_documents.supermemory_id (the old IDs are dead)
 *   3. Re-sync every active knowledge_document via memory.remember()
 *      using the new supermemory wrapper (which now uses the new tags)
 *   4. Update knowledge_documents.supermemory_id with the new IDs
 *
 * Events data IS lost — accepted because (a) auto-written hooks will
 * regenerate the events graph as Inba uses BLIPS, and (b) keeping the
 * old tag around for joint-recall would defeat the dashboard cleanup.
 *
 * Usage: npx tsx scripts/migrate-supermemory-tags.ts [--dry-run]
 */

import { existsSync, readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";

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

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.SUPERMEMORY_API_KEY) {
    console.error("[migrate] SUPERMEMORY_API_KEY missing in env");
    process.exit(1);
  }

  // Lazy-import after env is loaded so the supermemory client + db
  // pick up the api keys.
  const Supermemory = (await import("supermemory")).default;
  const { db, orgs, knowledgeDocuments } = await import("@/db");
  const { getMemoryBackend } = await import("@/lib/orc/memory");

  const client = new Supermemory({
    apiKey: process.env.SUPERMEMORY_API_KEY!,
  });

  console.log(
    `[migrate] mode = ${isDryRun ? "DRY RUN (no writes)" : "LIVE"}`,
  );

  // 1. List orgs we care about. This codebase is single-org for now,
  // but the script handles multi-org so it stays correct as BLIPS
  // expands.
  const orgRows = await db.select({ id: orgs.id, slug: orgs.slug }).from(orgs);
  console.log(`[migrate] found ${orgRows.length} org(s)`);

  for (const org of orgRows) {
    console.log(
      `\n[migrate] org ${org.slug} (${org.id}) — clearing old tags`,
    );

    const oldTags = [`org-${org.id}`, `org-test-${org.id}`];
    for (const oldTag of oldTags) {
      await deleteAllInTag(client, oldTag, isDryRun);
    }
  }

  // 2. Clear stale supermemory_ids on knowledge docs (they pointed to
  // documents that no longer exist).
  const staleDocs = await db
    .select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.status, "active"));

  console.log(
    `\n[migrate] found ${staleDocs.length} active knowledge document(s) to re-sync`,
  );

  if (!isDryRun) {
    // Set supermemory_id to NULL so the re-sync writes fresh and the
    // application keeps working even if a re-sync entry fails.
    for (const d of staleDocs) {
      await db
        .update(knowledgeDocuments)
        .set({ supermemoryId: null })
        .where(eq(knowledgeDocuments.id, d.id));
    }
    console.log(
      `[migrate] cleared supermemory_id on ${staleDocs.length} doc(s)`,
    );
  }

  // 3. Re-sync each active knowledge doc through the wrapper. The
  // wrapper now uses the slug-based tags, so this writes into
  // org-{slug}-knowledge automatically.
  if (staleDocs.length > 0) {
    const memory = await getMemoryBackend();
    let synced = 0;

    for (const d of staleDocs) {
      const [full] = await db
        .select({
          id: knowledgeDocuments.id,
          orgId: knowledgeDocuments.orgId,
          title: knowledgeDocuments.title,
          content: knowledgeDocuments.content,
          tags: knowledgeDocuments.tags,
          currentVersion: knowledgeDocuments.currentVersion,
        })
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.id, d.id),
            eq(knowledgeDocuments.status, "active"),
          ),
        )
        .limit(1);

      if (!full) continue;

      const summary = `# ${full.title}\n\n${full.content}`;

      console.log(
        `[migrate] re-syncing "${full.title}" (v${full.currentVersion})`,
      );

      if (isDryRun) {
        synced++;
        continue;
      }

      const result = await memory.remember({
        orgId: full.orgId,
        container: "knowledge",
        kind: "note",
        content: summary,
        metadata: {
          docId: full.id,
          title: full.title,
          tags: full.tags ?? [],
          version: full.currentVersion,
        },
      });

      if (result.id) {
        await db
          .update(knowledgeDocuments)
          .set({ supermemoryId: result.id })
          .where(eq(knowledgeDocuments.id, full.id));
        synced++;
      } else {
        console.warn(
          `[migrate] WARNING — re-sync returned empty id for "${full.title}"`,
        );
      }
    }

    console.log(
      `\n[migrate] re-synced ${synced}/${staleDocs.length} document(s) into org-{slug}-knowledge`,
    );
  }

  console.log(
    `\n[migrate] done. ${isDryRun ? "(dry run — no actual writes)" : "Verify in https://console.supermemory.ai"}`,
  );
  process.exit(0);
}

/**
 * List + delete every document in a given supermemory containerTag.
 * Pages through `documents.list` and bulk-deletes by id in chunks of
 * 100 (the SDK's hard cap per deleteBulk call).
 */
async function deleteAllInTag(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  containerTag: string,
  dryRun: boolean,
): Promise<void> {
  const allIds: string[] = [];
  let page = 1;
  const perPage = 100;

  // Page scan — supermemory paginates list responses.
  while (true) {
    const resp = await client.documents.list({
      // containerTags is deprecated in favor of `filters`, but it
      // still works and is the simplest way to scope a one-shot
      // migration. We only run this script once.
      containerTags: [containerTag],
      limit: perPage,
      page,
      includeContent: false,
    });

    const memories = resp.memories ?? [];
    for (const m of memories) {
      if (m.id) allIds.push(m.id);
    }

    if (memories.length < perPage) break;
    page++;
    if (page > 100) {
      console.warn(
        `[migrate] safety cap hit at page ${page} for tag ${containerTag} — bailing`,
      );
      break;
    }
  }

  console.log(
    `[migrate] tag ${containerTag} — found ${allIds.length} document(s)${dryRun ? " (dry run, not deleting)" : ""}`,
  );

  if (dryRun || allIds.length === 0) return;

  // deleteBulk caps at 100 ids per call.
  const chunks: string[][] = [];
  for (let i = 0; i < allIds.length; i += 100) {
    chunks.push(allIds.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    await client.documents.deleteBulk({ ids: chunk });
  }

  console.log(
    `[migrate] tag ${containerTag} — deleted ${allIds.length} document(s)`,
  );
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
