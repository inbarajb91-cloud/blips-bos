/**
 * Phase 9H — Seed the three decade playbooks (RCK / RCL / RCD) into
 * `knowledge_documents` so STOKER can recall them via the curated
 * knowledge container.
 *
 * Reads `scripts/playbooks/{RCK,RCL,RCD}.md` (founder-authored
 * scaffolds, refined through Settings → Knowledge over time), creates
 * one knowledge_documents row + version-1 row per decade, and
 * best-effort syncs each to supermemory's `knowledge` container.
 *
 * Idempotent: if a doc with the same title already exists for the
 * org, the script SKIPS it. Don't run this script twice expecting it
 * to overwrite — once a playbook is in Postgres, the founder owns
 * subsequent edits via the Settings UI. To force-replace, archive
 * the existing doc through the UI first.
 *
 * Author attribution: founder user (role='founder') in the BLIPS org.
 * Bypasses the requireFounder() server action gate by writing
 * directly via Drizzle — same pattern as scripts/seed.ts.
 *
 * Cost: zero (LLM not invoked). Supermemory writes use ~3 × ~1500
 * tokens of free-tier quota.
 *
 * Usage: npx tsx scripts/seed-decade-playbooks.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

interface Playbook {
  decade: "RCK" | "RCL" | "RCD";
  title: string;
  fileName: string;
  tags: string[];
}

const PLAYBOOKS: Playbook[] = [
  {
    decade: "RCK",
    title: "RCK Decade Playbook · 28-38 · The Reckoning",
    fileName: "RCK.md",
    tags: ["decade-playbook", "rck", "stoker"],
  },
  {
    decade: "RCL",
    title: "RCL Decade Playbook · 38-48 · The Recalibration",
    fileName: "RCL.md",
    tags: ["decade-playbook", "rcl", "stoker"],
  },
  {
    decade: "RCD",
    title: "RCD Decade Playbook · 48-58 · The Reckoned",
    fileName: "RCD.md",
    tags: ["decade-playbook", "rcd", "stoker"],
  },
];

async function main() {
  console.log("[seed-decade-playbooks] starting");

  // Resolve playbook directory relative to this script — robust against
  // wherever the user runs npx tsx from.
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const playbookDir = join(scriptDir, "playbooks");

  const { db } = await import("../src/db");
  const { orgs, users, knowledgeDocuments, knowledgeDocumentVersions } =
    await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  // BLIPS org lookup
  const [org] = await db.select().from(orgs).where(eq(orgs.slug, "blips"));
  if (!org) {
    console.error("✗ BLIPS org not found in DB. Run scripts/seed.ts first.");
    process.exit(1);
  }
  console.log(`✓ Org: ${org.slug} (${org.id})`);

  // Founder user lookup — used for the createdBy / editedBy attribution.
  // Multiple founders are unlikely at this stage, but if present we pick
  // the earliest by creation order so the seed result is deterministic.
  const [founder] = await db
    .select()
    .from(users)
    .where(and(eq(users.orgId, org.id), eq(users.role, "FOUNDER")))
    .orderBy(users.createdAt)
    .limit(1);
  if (!founder) {
    console.error(
      "✗ Founder user not found in BLIPS org. Sign in via the app first to create the user row, then re-run.",
    );
    process.exit(1);
  }
  console.log(`✓ Founder: ${founder.email} (${founder.id})`);

  // Resolve memory backend lazily — only if any playbook actually needs
  // syncing. Avoids a noisy backend-init log when SUPERMEMORY_API_KEY
  // isn't set or all docs already exist.
  let memoryBackendPromise: ReturnType<
    typeof import("../src/lib/orc/memory").getMemoryBackend
  > | null = null;

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const pb of PLAYBOOKS) {
    const fullPath = join(playbookDir, pb.fileName);
    if (!existsSync(fullPath)) {
      console.error(`✗ ${pb.decade}: playbook file missing at ${fullPath}`);
      errorCount++;
      continue;
    }
    const content = readFileSync(fullPath, "utf-8").trim();
    if (content.length < 100) {
      console.error(
        `✗ ${pb.decade}: playbook too short (${content.length} chars) — looks like a stub. Skipping.`,
      );
      errorCount++;
      continue;
    }

    // Idempotency check — same title, same org, **status='active'** =
    // treat as already seeded. Title acts as the natural key here since
    // knowledge_documents has no org-scoped UNIQUE on title (founder may
    // legitimately create multiple docs with similar names over time).
    // This is a deliberate skip-on-conflict, not an upsert: once a doc
    // exists, subsequent edits go through the founder UI.
    //
    // CR pass 2 on PR #12: filter status='active' so the documented
    // "archive a doc to force-replace" affordance actually works. An
    // archived doc with the same title used to block re-seeding, which
    // contradicted the script header's instructions. Now archived docs
    // are invisible to the collision check; the seed creates a fresh
    // active row alongside.
    const [existing] = await db
      .select({
        id: knowledgeDocuments.id,
        currentVersion: knowledgeDocuments.currentVersion,
        content: knowledgeDocuments.content,
        tags: knowledgeDocuments.tags,
        supermemoryId: knowledgeDocuments.supermemoryId,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.orgId, org.id),
          eq(knowledgeDocuments.title, pb.title),
          eq(knowledgeDocuments.status, "active"),
        ),
      )
      .limit(1);

    if (existing) {
      // Existing doc — but check whether its supermemory sync ever
      // landed. CR pass on PR #12: a first run without SUPERMEMORY_API_KEY
      // would create the postgres rows with supermemoryId=null. A
      // second run (after the env var is set) used to skip and leave
      // the doc unfindable through STOKER's recall(container='knowledge').
      // Backfill now: sync the existing content + version, write the
      // returned id, and report.
      if (existing.supermemoryId) {
        console.log(
          `⊝ ${pb.decade}: doc "${pb.title}" already exists with supermemoryId=${existing.supermemoryId} (id=${existing.id}, v${existing.currentVersion}); skipping`,
        );
        skippedCount++;
        continue;
      }

      if (!process.env.SUPERMEMORY_API_KEY) {
        console.log(
          `⊝ ${pb.decade}: doc "${pb.title}" exists but supermemoryId is null AND SUPERMEMORY_API_KEY not set — postgres-only, skipping. Set the key and re-run to backfill.`,
        );
        skippedCount++;
        continue;
      }

      console.log(
        `↻ ${pb.decade}: doc "${pb.title}" exists (id=${existing.id}, v${existing.currentVersion}) but supermemoryId is null — backfilling sync`,
      );

      try {
        if (!memoryBackendPromise) {
          const { getMemoryBackend } = await import("../src/lib/orc/memory");
          memoryBackendPromise = getMemoryBackend();
        }
        const memory = await memoryBackendPromise;
        const result = await memory.remember({
          orgId: org.id,
          container: "knowledge",
          kind: "note",
          // Use the existing doc's actual content + tags, not the file
          // — the founder may have edited the doc post-seed.
          content: `# ${pb.title}\n\n${existing.content}`,
          metadata: {
            knowledgeDocumentId: existing.id,
            knowledgeDocumentVersion: existing.currentVersion,
            knowledgeDocumentTitle: pb.title,
            knowledgeDocumentTags: existing.tags,
          },
        });
        if (result.id) {
          await db
            .update(knowledgeDocuments)
            .set({ supermemoryId: result.id })
            .where(eq(knowledgeDocuments.id, existing.id));
          console.log(`  ↳ backfilled supermemory id=${result.id}`);
          // Counted under "skipped" since no new doc was created — but
          // the user-visible state has changed (sync now lands).
          skippedCount++;
        } else {
          console.warn(
            `  ⚠ supermemory remember() returned empty id — backfill silently failed. Re-save through the UI to retry.`,
          );
          skippedCount++;
        }
      } catch (err) {
        console.error(
          `  ✗ ${pb.decade}: supermemory backfill threw:`,
          err,
        );
        skippedCount++;
      }
      continue;
    }

    // Atomic: doc row + version-1 row in one transaction. Mirrors the
    // pattern in createKnowledgeDocument server action.
    let docId: string;
    try {
      const created = await db.transaction(async (tx) => {
        const [docRow] = await tx
          .insert(knowledgeDocuments)
          .values({
            orgId: org.id,
            createdBy: founder.id,
            title: pb.title,
            content,
            tags: pb.tags,
            status: "active",
            currentVersion: 1,
          })
          .returning({ id: knowledgeDocuments.id });

        await tx.insert(knowledgeDocumentVersions).values({
          documentId: docRow.id,
          version: 1,
          title: pb.title,
          content,
          tags: pb.tags,
          editedBy: founder.id,
          changeNote:
            "Phase 9H — initial seed via scripts/seed-decade-playbooks.ts. Refine via Settings → Knowledge.",
        });

        return docRow;
      });
      docId = created.id;
    } catch (err) {
      console.error(`✗ ${pb.decade}: postgres transaction failed:`, err);
      errorCount++;
      continue;
    }

    console.log(
      `✓ ${pb.decade}: created doc id=${docId} (${content.length} chars)`,
    );
    createdCount++;

    // Supermemory sync — best-effort, skipped if no API key. STOKER's
    // recall(container='knowledge') needs the doc in supermemory to find
    // it; without sync the doc only lives in Postgres + the Settings UI.
    if (!process.env.SUPERMEMORY_API_KEY) {
      console.log(
        `  ⊝ SUPERMEMORY_API_KEY not set — postgres seed only. Set the key and re-run, OR open the doc in Settings → Knowledge and save (which triggers sync) to push it to supermemory.`,
      );
      continue;
    }

    try {
      if (!memoryBackendPromise) {
        const { getMemoryBackend } = await import("../src/lib/orc/memory");
        memoryBackendPromise = getMemoryBackend();
      }
      const memory = await memoryBackendPromise;
      const result = await memory.remember({
        orgId: org.id,
        container: "knowledge",
        kind: "note",
        // Match the title-as-H1 prepend pattern from the action's
        // syncToSupermemory helper so chunking is consistent across
        // seed-vs-app-created docs.
        content: `# ${pb.title}\n\n${content}`,
        metadata: {
          knowledgeDocumentId: docId,
          knowledgeDocumentVersion: 1,
          knowledgeDocumentTitle: pb.title,
          knowledgeDocumentTags: pb.tags,
        },
      });
      if (result.id) {
        await db
          .update(knowledgeDocuments)
          .set({ supermemoryId: result.id })
          .where(eq(knowledgeDocuments.id, docId));
        console.log(`  ↳ supermemory id=${result.id}`);
      } else {
        console.warn(
          `  ⚠ supermemory remember() returned empty id — sync silently failed (memory backend swallowed an error). Re-save through the UI to retry.`,
        );
      }
    } catch (err) {
      console.error(`  ✗ ${pb.decade}: supermemory sync threw:`, err);
      // Don't bump errorCount — the postgres write already succeeded.
      // The doc is usable in-app immediately; supermemory recall will
      // miss it until the next save-through-UI.
    }
  }

  console.log(
    `[seed-decade-playbooks] done — created ${createdCount}, skipped ${skippedCount}, errored ${errorCount}`,
  );
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[seed-decade-playbooks] fatal:", err);
  process.exit(1);
});
