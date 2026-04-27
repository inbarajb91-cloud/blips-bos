-- 0005_knowledge_ondelete_restrict.sql
-- Phase 8L follow-up — explicit ON DELETE RESTRICT on knowledge doc
-- author FKs.
--
-- 0004_knowledge_layer.sql created knowledge_documents.created_by and
-- knowledge_document_versions.edited_by as REFERENCES users(id) without
-- an explicit ON DELETE clause. Postgres defaults to NO ACTION, which
-- is functionally similar to RESTRICT but technically deferrable. This
-- migration makes the intent explicit (RESTRICT) so the schema speaks
-- for itself: knowledge docs are founder-authored, and we want a
-- founder-account deletion to fail loudly until a deliberate
-- reassignment / archive step has been taken — never silently lose
-- audit trail.
--
-- Considered alternative (set null + nullable column) was rejected
-- because the audit story matters more than allowing user deletion.
-- We're a one-founder org today, so this is a one-time event anyway.
--
-- CodeRabbit flagged this on PR #6.

ALTER TABLE "knowledge_documents"
  DROP CONSTRAINT IF EXISTS "knowledge_documents_created_by_fkey";
ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;

ALTER TABLE "knowledge_document_versions"
  DROP CONSTRAINT IF EXISTS "knowledge_document_versions_edited_by_fkey";
ALTER TABLE "knowledge_document_versions"
  ADD CONSTRAINT "knowledge_document_versions_edited_by_fkey"
  FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE RESTRICT;
