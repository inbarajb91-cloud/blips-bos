-- ══════════════════════════════════════════════════════════════════
-- Phase 8L — Curated knowledge layer
-- ══════════════════════════════════════════════════════════════════
-- Phase 8K shipped supermemory's `events` container (auto-written by
-- approve / dismiss / summarize / stage_completion hooks). 8L adds
-- the second container (`knowledge`) with a UI for the founder to
-- author, edit, and version reference docs that ORC consults via
-- `recall(query, container='knowledge')`.
--
-- Two tables:
--   1. knowledge_documents      — current state of each doc (one row per doc)
--   2. knowledge_document_versions — full history (every save creates a row)
--
-- Per Phase 8L design conversation (April 27):
--   • Format: markdown only (supermemory's AST-aware chunker leverages
--     headings/lists/code blocks for better extraction precision)
--   • Permissions: founder-only at app level (server-action guard).
--     RLS still scopes by org for defense-in-depth.
--   • Versioning: full history, every save creates a version row.
--     Rollback = pick a prior version, re-save it (creates a new
--     version with the old content; doesn't rewrite the timeline).
--   • Supermemory sync: latest version only. Old versions live in
--     Postgres for audit + rollback. On update: forget(prev_id) →
--     remember(new content) → store new id on knowledge_documents.
--     This keeps recall noise-free (only current truth surfaces).
-- ══════════════════════════════════════════════════════════════════

-- 1. status enum
CREATE TYPE "knowledge_document_status" AS ENUM ('active', 'archived');

-- 2. knowledge_documents — the canonical "current state" row per doc
CREATE TABLE "knowledge_documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "created_by" UUID NOT NULL REFERENCES "users"("id"),
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "status" "knowledge_document_status" NOT NULL DEFAULT 'active',
  "current_version" INTEGER NOT NULL DEFAULT 1,
  -- Latest synced supermemory document id. NULL when sync hasn't
  -- happened yet (just-created doc) or sync failed (best-effort —
  -- doc still saved in Postgres, can retry sync later).
  "supermemory_id" TEXT,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX "knowledge_documents_org_idx" ON "knowledge_documents"("org_id");
CREATE INDEX "knowledge_documents_org_status_idx" ON "knowledge_documents"("org_id", "status");

-- 3. knowledge_document_versions — full history
-- Every save (create + update) writes one row. Version 1 = creation.
-- The current version's content is duplicated in knowledge_documents
-- for query convenience (no JOIN needed for the common list-and-read
-- path). Storage is cheap; query simplicity wins.
CREATE TABLE "knowledge_document_versions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  -- Title and tags can change across versions, so we snapshot them
  -- alongside content. Lets the version history view show "title was
  -- X at version 3" without recomputing.
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "edited_by" UUID NOT NULL REFERENCES "users"("id"),
  "edited_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Optional commit-message-style note explaining the change. UI
  -- prompts for it on save but doesn't require it.
  "change_note" TEXT,
  CONSTRAINT "knowledge_document_versions_doc_version_uq"
    UNIQUE ("document_id", "version")
);

CREATE INDEX "knowledge_document_versions_doc_idx"
  ON "knowledge_document_versions"("document_id");

-- 4. updated_at trigger on knowledge_documents (matches the existing
--    pattern used on signals + collections). Keeps timestamps honest
--    without app-code discipline.
CREATE OR REPLACE FUNCTION knowledge_documents_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_documents_updated_at
BEFORE UPDATE ON knowledge_documents
FOR EACH ROW
EXECUTE FUNCTION knowledge_documents_set_updated_at();

-- 5. Row-Level Security — org scoping (defense-in-depth alongside
--    the founder-only app-level guard). Same pattern as every other
--    org-scoped table: USING + WITH CHECK against current_org_id().
ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_documents_all" ON public.knowledge_documents;
CREATE POLICY "knowledge_documents_all" ON public.knowledge_documents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- Versions inherit org scope from their parent document.
ALTER TABLE "knowledge_document_versions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_document_versions_all" ON public.knowledge_document_versions;
CREATE POLICY "knowledge_document_versions_all" ON public.knowledge_document_versions
  FOR ALL TO authenticated
  USING (
    document_id IN (
      SELECT id FROM public.knowledge_documents
      WHERE org_id = public.current_org_id()
    )
  )
  WITH CHECK (
    document_id IN (
      SELECT id FROM public.knowledge_documents
      WHERE org_id = public.current_org_id()
    )
  );

-- 6. Realtime — surface knowledge_documents updates to the Settings
--    page so multiple tabs stay in sync. Versions don't need realtime
--    (they're append-only and only matter when you open a specific
--    doc's history panel — fetch on demand).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'knowledge_documents'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_documents';
  END IF;
END $$;
