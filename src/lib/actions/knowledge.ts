"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  db,
  knowledgeDocuments,
  knowledgeDocumentVersions,
} from "@/db";
import { requireFounder } from "@/lib/auth/require-founder";
import { getMemoryBackend } from "@/lib/orc/memory";

/**
 * Server actions for the curated knowledge layer (Phase 8L).
 *
 * All write actions go through `requireFounder()` so non-founder
 * sessions can never reach the database. Read actions allow any
 * authenticated org member (RLS scopes by org_id) — knowledge is
 * meant to inform decisions across the team eventually.
 *
 * Sync philosophy:
 *   - Postgres is the source of truth for the docs and their
 *     version history.
 *   - Supermemory holds ONLY the latest version of each doc, in the
 *     `knowledge` container, for ORC's `recall(query, container='knowledge')`.
 *   - On update: forget(prev_supermemory_id) → remember(new content) →
 *     store new id. Old supermemory entries don't linger; recall stays
 *     noise-free and ORC always sees the current truth.
 *   - Sync failures don't block the Postgres write. The doc lands
 *     locally; supermemory_id stays NULL or stale; ORC's recall just
 *     misses this doc until next save. Best-effort, not blocking.
 */

// ─── Read paths ───────────────────────────────────────────────────

export interface KnowledgeDocSummary {
  id: string;
  title: string;
  tags: string[];
  status: "active" | "archived";
  currentVersion: number;
  updatedAt: Date;
}

export async function listKnowledgeDocuments(opts?: {
  /** Filter by status. Default: 'active' only. Pass 'all' for both. */
  status?: "active" | "archived" | "all";
}): Promise<KnowledgeDocSummary[]> {
  // Read paths use requireFounder for now (single-user scale). When
  // DECK ships and we want employees to read but not write, switch
  // to getCurrentUserWithOrg + role-based filtering here.
  const user = await requireFounder();
  const status = opts?.status ?? "active";

  const rows = await db
    .select({
      id: knowledgeDocuments.id,
      title: knowledgeDocuments.title,
      tags: knowledgeDocuments.tags,
      status: knowledgeDocuments.status,
      currentVersion: knowledgeDocuments.currentVersion,
      updatedAt: knowledgeDocuments.updatedAt,
    })
    .from(knowledgeDocuments)
    .where(
      status === "all"
        ? eq(knowledgeDocuments.orgId, user.orgId)
        : and(
            eq(knowledgeDocuments.orgId, user.orgId),
            eq(knowledgeDocuments.status, status),
          ),
    )
    .orderBy(desc(knowledgeDocuments.updatedAt));

  return rows;
}

export interface KnowledgeDocFull {
  id: string;
  title: string;
  content: string;
  tags: string[];
  status: "active" | "archived";
  currentVersion: number;
  supermemoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getKnowledgeDocument(
  documentId: string,
): Promise<KnowledgeDocFull | null> {
  const user = await requireFounder();
  const [row] = await db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    status: row.status,
    currentVersion: row.currentVersion,
    supermemoryId: row.supermemoryId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface KnowledgeDocVersionSummary {
  id: string;
  version: number;
  title: string;
  editedAt: Date;
  changeNote: string | null;
}

export async function listKnowledgeDocumentVersions(
  documentId: string,
): Promise<KnowledgeDocVersionSummary[]> {
  const user = await requireFounder();
  // Verify the doc is in the user's org (RLS would enforce too, but
  // belt-and-suspenders for clean error semantics).
  const [doc] = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!doc) return [];

  const rows = await db
    .select({
      id: knowledgeDocumentVersions.id,
      version: knowledgeDocumentVersions.version,
      title: knowledgeDocumentVersions.title,
      editedAt: knowledgeDocumentVersions.editedAt,
      changeNote: knowledgeDocumentVersions.changeNote,
    })
    .from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, documentId))
    .orderBy(desc(knowledgeDocumentVersions.version));

  return rows;
}

export async function getKnowledgeDocumentVersion(
  documentId: string,
  version: number,
): Promise<{
  version: number;
  title: string;
  content: string;
  tags: string[];
  editedAt: Date;
  changeNote: string | null;
} | null> {
  const user = await requireFounder();
  // Same belt-and-suspenders check as above.
  const [doc] = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!doc) return null;

  const [row] = await db
    .select()
    .from(knowledgeDocumentVersions)
    .where(
      and(
        eq(knowledgeDocumentVersions.documentId, documentId),
        eq(knowledgeDocumentVersions.version, version),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    version: row.version,
    title: row.title,
    content: row.content,
    tags: row.tags,
    editedAt: row.editedAt,
    changeNote: row.changeNote,
  };
}

// ─── Write paths ──────────────────────────────────────────────────

export interface CreateKnowledgeDocInput {
  title: string;
  content: string;
  tags?: string[];
  changeNote?: string;
}

export async function createKnowledgeDocument(
  input: CreateKnowledgeDocInput,
): Promise<{ id: string }> {
  const user = await requireFounder();

  const title = input.title.trim();
  const content = input.content.trim();
  if (title.length < 1 || title.length > 200) {
    throw new Error("Title must be 1-200 characters.");
  }
  if (content.length < 1) {
    throw new Error("Content can't be empty.");
  }
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  // Atomic: create the document row + the version-1 row in one txn.
  // If either insert fails, neither lands.
  const created = await db.transaction(async (tx) => {
    const [docRow] = await tx
      .insert(knowledgeDocuments)
      .values({
        orgId: user.orgId,
        createdBy: user.authId,
        title,
        content,
        tags,
        status: "active",
        currentVersion: 1,
      })
      .returning({ id: knowledgeDocuments.id });

    await tx.insert(knowledgeDocumentVersions).values({
      documentId: docRow.id,
      version: 1,
      title,
      content,
      tags,
      editedBy: user.authId,
      changeNote: input.changeNote ?? null,
    });

    return docRow;
  });

  // Sync to supermemory's knowledge container. Best-effort — if this
  // fails, the doc is already saved in Postgres; ORC just won't see
  // it via recall until next save. Track the supermemory id back on
  // the doc so updates can forget() the prior version.
  await syncToSupermemory({
    documentId: created.id,
    orgId: user.orgId,
    title,
    content,
    tags,
    version: 1,
    previousSupermemoryId: null,
  });

  revalidatePath("/settings/knowledge");
  return { id: created.id };
}

export interface UpdateKnowledgeDocInput {
  documentId: string;
  title: string;
  content: string;
  tags?: string[];
  changeNote?: string;
}

export async function updateKnowledgeDocument(
  input: UpdateKnowledgeDocInput,
): Promise<{ version: number }> {
  const user = await requireFounder();

  const title = input.title.trim();
  const content = input.content.trim();
  if (title.length < 1 || title.length > 200) {
    throw new Error("Title must be 1-200 characters.");
  }
  if (content.length < 1) {
    throw new Error("Content can't be empty.");
  }
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);

  // Lookup current state — we need supermemoryId for the forget
  // call and currentVersion to compute the next version number.
  const [existing] = await db
    .select({
      currentVersion: knowledgeDocuments.currentVersion,
      supermemoryId: knowledgeDocuments.supermemoryId,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, input.documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("Knowledge document not found.");
  }

  const nextVersion = existing.currentVersion + 1;
  const previousSupermemoryId = existing.supermemoryId;

  // Optimistic locking on currentVersion (CodeRabbit local CLI):
  // the previous read-then-update could race if two concurrent saves
  // both read currentVersion=N. Both would compute nextVersion=N+1;
  // one would win the UNIQUE on (documentId, version) and the other
  // would surface a confusing constraint violation, plus
  // knowledgeDocuments.currentVersion would only reflect one of the
  // two saves' fields (the last writer's title/content/tags).
  //
  // Adding eq(currentVersion, existing.currentVersion) in the WHERE
  // means only one of the racing transactions advances the row;
  // .returning() gives us the affected count, and zero means we
  // raced and should ask the user to refresh. The (documentId,
  // version) UNIQUE constraint on knowledge_document_versions stays
  // as defense in depth.
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(knowledgeDocuments)
      .set({
        title,
        content,
        tags,
        currentVersion: nextVersion,
        // updated_at refreshed by trigger; supermemoryId updated
        // post-sync below.
      })
      .where(
        and(
          eq(knowledgeDocuments.id, input.documentId),
          eq(knowledgeDocuments.orgId, user.orgId),
          eq(knowledgeDocuments.currentVersion, existing.currentVersion),
        ),
      )
      .returning({ id: knowledgeDocuments.id });

    if (updated.length === 0) {
      // Either someone else saved between our SELECT and UPDATE, or
      // the row was archived. Throwing inside tx rolls back the
      // version insert too; user-facing message is generic enough
      // to cover both cases.
      throw new Error(
        "This document was updated by someone else (or archived) while you were editing. Refresh and try again.",
      );
    }

    await tx.insert(knowledgeDocumentVersions).values({
      documentId: input.documentId,
      version: nextVersion,
      title,
      content,
      tags,
      editedBy: user.authId,
      changeNote: input.changeNote ?? null,
    });
  });

  await syncToSupermemory({
    documentId: input.documentId,
    orgId: user.orgId,
    title,
    content,
    tags,
    version: nextVersion,
    previousSupermemoryId,
  });

  revalidatePath("/settings/knowledge");
  revalidatePath(`/settings/knowledge/${input.documentId}`);
  return { version: nextVersion };
}

/**
 * Roll back to a prior version. Implementation: read that version's
 * content, then call updateKnowledgeDocument with it. This creates a
 * NEW version (current_version + 1) with the old content rather than
 * rewriting history. Audit trail stays clean.
 */
export async function rollbackKnowledgeDocument(opts: {
  documentId: string;
  toVersion: number;
}): Promise<{ version: number }> {
  await requireFounder();
  const target = await getKnowledgeDocumentVersion(
    opts.documentId,
    opts.toVersion,
  );
  if (!target) {
    throw new Error(`Version ${opts.toVersion} not found.`);
  }

  return updateKnowledgeDocument({
    documentId: opts.documentId,
    title: target.title,
    content: target.content,
    tags: target.tags,
    changeNote: `Rolled back to v${opts.toVersion}`,
  });
}

export async function archiveKnowledgeDocument(
  documentId: string,
): Promise<void> {
  const user = await requireFounder();
  // Archive flips status only; doesn't delete from Postgres or
  // supermemory. Useful for "this doc is no longer relevant but I
  // don't want to lose the history." Reactivate with restoreKnowledgeDocument.
  await db
    .update(knowledgeDocuments)
    .set({ status: "archived" })
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    );

  // Forget from supermemory so archived docs don't surface in recall.
  // Re-sync on restore.
  const [doc] = await db
    .select({ supermemoryId: knowledgeDocuments.supermemoryId })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (doc?.supermemoryId) {
    const memory = await getMemoryBackend();
    await memory.forget(doc.supermemoryId);
    await db
      .update(knowledgeDocuments)
      .set({ supermemoryId: null })
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.orgId, user.orgId),
        ),
      );
  }

  revalidatePath("/settings/knowledge");
}

export async function restoreKnowledgeDocument(
  documentId: string,
): Promise<void> {
  const user = await requireFounder();
  const [doc] = await db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!doc) throw new Error("Knowledge document not found.");

  await db
    .update(knowledgeDocuments)
    .set({ status: "active" })
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.orgId, user.orgId),
      ),
    );

  // Re-sync to supermemory so recall finds it again.
  await syncToSupermemory({
    documentId,
    orgId: user.orgId,
    title: doc.title,
    content: doc.content,
    tags: doc.tags,
    version: doc.currentVersion,
    previousSupermemoryId: null,
  });

  revalidatePath("/settings/knowledge");
}

// ─── Internal: supermemory sync ──────────────────────────────────

/**
 * Sync a knowledge document to supermemory's `knowledge` container.
 * Forgets the previous version (if any) before writing the new one,
 * so recall surfaces only the current truth — no version drift.
 *
 * Best-effort by design. The MemoryBackend wrapper swallows its own
 * errors, but we still wrap the supermemory_id update to avoid
 * blocking the user-facing flow on a transient sync issue.
 */
async function syncToSupermemory(params: {
  documentId: string;
  orgId: string;
  title: string;
  content: string;
  tags: string[];
  version: number;
  previousSupermemoryId: string | null;
}): Promise<void> {
  try {
    const memory = await getMemoryBackend();

    // Forget the prior version so it doesn't linger in recall.
    if (params.previousSupermemoryId) {
      await memory.forget(params.previousSupermemoryId);
    }

    // Write fresh. The 'note' kind is generic; the container='knowledge'
    // is what tells ORC this is curated reference material.
    const result = await memory.remember({
      orgId: params.orgId,
      container: "knowledge",
      kind: "note",
      content:
        // Prepend title as an H1 so supermemory's chunker can use it
        // as a top-level boundary even if the user didn't write one.
        `# ${params.title}\n\n${params.content}`,
      metadata: {
        knowledgeDocumentId: params.documentId,
        knowledgeDocumentVersion: params.version,
        knowledgeDocumentTitle: params.title,
        knowledgeDocumentTags: params.tags,
      },
    });

    if (result.id) {
      await db
        .update(knowledgeDocuments)
        .set({ supermemoryId: result.id })
        .where(
          and(
            eq(knowledgeDocuments.id, params.documentId),
            eq(knowledgeDocuments.orgId, params.orgId),
          ),
        );
    }
  } catch (err) {
    // Don't propagate — the Postgres write already landed. Log so
    // we can investigate transient sync failures.
    console.error("[knowledge] supermemory sync failed:", err);
  }
}
