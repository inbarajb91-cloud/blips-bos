-- 0012_knowledge_documents_slug.sql
-- REVIEW.md F12 (May 18, 2026) — decouple runtime pipeline lookups from
-- human-typed titles. Until today, FURNACE/BOILER fetched playbook /
-- brand-identity / materials docs via ilike(title, "RCK Decade Playbook").
-- Renaming a doc in the UI silently broke the pipeline (decadePlaybook=""
-- in the brief). Slugs are stable, titles are display-only.
--
-- Slug is nullable for backward compat (0 prod rows today, so no backfill
-- needed; future fresh-DB applies via the schema get the column from
-- the migration runner). The partial unique index excludes NULLs so
-- pre-slug rows don't conflict.
--
-- Convention (enforced by lib/knowledge/slug.ts): slug = lowercase,
-- non-alphanumeric → underscore, collapsed runs, trimmed. e.g.
-- "RCK Decade Playbook" → "rck_decade_playbook".
--
-- Applied to prod via Supabase MCP `knowledge_documents_slug` migration
-- at 2026-05-18T~MM:SS UTC. This file is the durable copy for fresh DBs.

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_org_slug_unique
  ON public.knowledge_documents (org_id, slug)
  WHERE slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_documents_slug_idx
  ON public.knowledge_documents (slug)
  WHERE slug IS NOT NULL;
