-- 0011_boiler_v2.sql
-- Phase 11D.1 — BOILER v2 schema migration.
--
-- The original Phase 11 BOILER (May 8) stored 4 variants[] in agent_outputs.content,
-- where each variant was nano-banana's guess at "what designed apparel looks like."
-- Per founder review of the live gallery (May 15), those outputs were placeholder-
-- quality, not production design.
--
-- The new architecture (prototype approved May 15 at Design/Phase-11-BOILER-v2/v5.html,
-- detailed in agents/PIPELINE-v2.md § Phase 11D + agents/BOILER.md):
--   - ONE design per signal, not 4 variants
--   - ORC drives iterative refinement turn-by-turn against the same canvas
--   - gpt-image-2 Responses API with previous_response_id chaining for refinements
--   - Three quality tiers: low ($0.006) / medium ($0.053) / high ($0.211)
--   - Mockup composition is a SEPARATE deterministic step (Dynamic Mockups API in prod)
--   - Versioning preserves the full iteration history
--
-- This migration adds three tables:
--   1. design_versions    — one row per ORC iteration of a BOILER design
--   2. mockup_renders     — cached Dynamic Mockups outputs per (design × colorway × face)
--   3. boiler_state       — current active version + colorway per (signal, journey)
--
-- The old variants[] shape stays writable for one phase. The new BOILER skill writes
-- a placeholder row to agent_outputs with content: { migrated: true, active_version_id }
-- so the existing pipeline status logic continues to work. Backfill of historical rows
-- is OPTIONAL — they're placeholder-quality anyway; treating them as legacy gallery
-- view is acceptable.
--
-- RLS: all new tables scope by org_id (via signal_id join). New policies added below.
-- Realtime: design_versions + boiler_state + mockup_renders published; the workspace
--           UI subscribes to these to live-update the version strip + mockup view.

-- ────────────────────────────────────────────────────────────────────
-- 1. design_versions — one row per ORC iteration
-- ────────────────────────────────────────────────────────────────────
-- Each ORC turn that generates or refines a design produces one row here.
-- - generate_design (no parent): tier='low'|'medium'|'high', parent_version_id=NULL
-- - refine_design (chains from prior): parent_version_id=<prior>, previous_response_id=<prior's gpt_image_2_response_id>
-- - branch_version (forks from older): parent_version_id=<branch-source>, previous_response_id same
-- - finalize_design: tier='high', parent_version_id=<current-active>, marks the canonical
--
-- flat_artwork_url is the Cloudinary URL of the transparent-background PNG (4096x4096 max).
-- No inline base64 anywhere — house rule from May 9 (Vercel Fast Origin Transfer block).
--
-- palette_roles jsonb shape:
--   { garment_base: "#5A2020", ring_outer: "#2A0F0F", ring_inner: "#9E5050",
--     front_ink: "#E8D5D2", back_ink: "#A04040" }
-- Flexible — schema enforces the keys at the application layer (Zod), not SQL.
--
-- composition_meta jsonb shape (open-ended for now, locked by FURNACE schema upgrade):
--   { exact_text: { front: "AHEAD ON PAPER.", back: "BEHIND ON SOMETHING." },
--     typography: { front_weight: 800, front_tracking: "tight", back_weight: 300, back_tracking: "loose" },
--     composition_rules: { origin_position: "62%,42%", square_displacement_back: "lower-right" },
--     print_spec: { method: "screen", separations: 2, halftones: false, full_bleed: true } }

CREATE TABLE IF NOT EXISTS "design_versions" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                   UUID NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "signal_id"                UUID NOT NULL REFERENCES "signals"("id") ON DELETE CASCADE,
  "journey_id"               UUID REFERENCES "journeys"("id") ON DELETE SET NULL,
  "parent_version_id"        UUID REFERENCES "design_versions"("id") ON DELETE SET NULL,

  "tier"                     TEXT NOT NULL CHECK ("tier" IN ('low', 'medium', 'high')),
  "prompt_used"              TEXT NOT NULL,
  "refinement_instruction"   TEXT,
  "previous_response_id"     TEXT,
  "gpt_image_2_response_id"  TEXT,

  "flat_artwork_url"         TEXT,
  "cloudinary_public_id"     TEXT,
  "width_px"                 INTEGER,
  "height_px"                INTEGER,

  "palette_roles"            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "composition_meta"         JSONB NOT NULL DEFAULT '{}'::jsonb,

  "cost_usd"                 NUMERIC(8, 4),
  "generated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_by"               UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "discarded"                BOOLEAN NOT NULL DEFAULT FALSE,
  "discarded_at"             TIMESTAMPTZ,

  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "design_versions_signal_idx" ON "design_versions" ("signal_id");
CREATE INDEX IF NOT EXISTS "design_versions_journey_idx" ON "design_versions" ("journey_id");
CREATE INDEX IF NOT EXISTS "design_versions_parent_idx" ON "design_versions" ("parent_version_id");
CREATE INDEX IF NOT EXISTS "design_versions_org_idx" ON "design_versions" ("org_id");
CREATE INDEX IF NOT EXISTS "design_versions_generated_at_idx" ON "design_versions" ("generated_at" DESC);

-- ────────────────────────────────────────────────────────────────────
-- 2. mockup_renders — cached Dynamic Mockups outputs per (design × colorway × face)
-- ────────────────────────────────────────────────────────────────────
-- After each design_version is created, an Inngest side-effect fires Dynamic Mockups
-- API for { front, back } × current colorway. Result cached here keyed by the triple
-- (design_version_id, colorway_hex, face). UNIQUE constraint prevents duplicate
-- renders.
--
-- renderer enum: 'dynamic_mockups' is the production path; 'svg_flatlay' is the
-- fallback / dev path (the SVG illustration baked into the renderer component).
-- For svg_flatlay, cloudinary_url is empty and the renderer composes inline.

CREATE TABLE IF NOT EXISTS "mockup_renders" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                   UUID NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "design_version_id"        UUID NOT NULL REFERENCES "design_versions"("id") ON DELETE CASCADE,
  "colorway_hex"             TEXT NOT NULL,
  "face"                     TEXT NOT NULL CHECK ("face" IN ('front', 'back')),
  "renderer"                 TEXT NOT NULL DEFAULT 'dynamic_mockups' CHECK ("renderer" IN ('dynamic_mockups', 'svg_flatlay')),

  "template_uuid"            TEXT,
  "smart_object_uuid"        TEXT,
  "cloudinary_url"           TEXT,
  "cloudinary_public_id"     TEXT,
  "width_px"                 INTEGER,
  "height_px"                INTEGER,

  "rendered_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "cost_usd"                 NUMERIC(8, 4),

  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "mockup_renders_unique"
    UNIQUE ("design_version_id", "colorway_hex", "face")
);

CREATE INDEX IF NOT EXISTS "mockup_renders_design_idx" ON "mockup_renders" ("design_version_id");
CREATE INDEX IF NOT EXISTS "mockup_renders_org_idx" ON "mockup_renders" ("org_id");

-- ────────────────────────────────────────────────────────────────────
-- 3. boiler_state — current active version per (signal, journey)
-- ────────────────────────────────────────────────────────────────────
-- One row per (signal_id, journey_id) tracking which design_version is currently
-- active in the workspace + the active colorway + whether the design is finalized.
-- The workspace renderer reads this to know what to show; ORC tools write it on
-- generate/refine/branch/finalize/approve.
--
-- active_palette_roles is denormalized (also stored on design_versions) so the
-- color picker can preview pure color swaps before triggering a regeneration.

CREATE TABLE IF NOT EXISTS "boiler_state" (
  "id"                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                   UUID NOT NULL REFERENCES "orgs"("id") ON DELETE CASCADE,
  "signal_id"                UUID NOT NULL REFERENCES "signals"("id") ON DELETE CASCADE,
  "journey_id"               UUID REFERENCES "journeys"("id") ON DELETE SET NULL,

  "active_version_id"        UUID REFERENCES "design_versions"("id") ON DELETE SET NULL,
  "active_garment_hex"       TEXT,
  "active_palette_roles"     JSONB NOT NULL DEFAULT '{}'::jsonb,

  "finalized"                BOOLEAN NOT NULL DEFAULT FALSE,
  "finalized_at"             TIMESTAMPTZ,
  "finalized_version_id"     UUID REFERENCES "design_versions"("id") ON DELETE SET NULL,

  "created_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "boiler_state_signal_journey_unique"
    UNIQUE ("signal_id", "journey_id")
);

CREATE INDEX IF NOT EXISTS "boiler_state_signal_idx" ON "boiler_state" ("signal_id");
CREATE INDEX IF NOT EXISTS "boiler_state_org_idx" ON "boiler_state" ("org_id");

-- ────────────────────────────────────────────────────────────────────
-- RLS policies — scope by org_id (matches existing pattern)
-- ────────────────────────────────────────────────────────────────────
-- All three tables use the standard current_org_id() function from Phase 2.
-- SELECT/INSERT/UPDATE/DELETE all gated by the org match.

ALTER TABLE "design_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mockup_renders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "boiler_state" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design_versions_org_isolation" ON "design_versions";
CREATE POLICY "design_versions_org_isolation" ON "design_versions"
  USING ("org_id" = current_org_id())
  WITH CHECK ("org_id" = current_org_id());

DROP POLICY IF EXISTS "mockup_renders_org_isolation" ON "mockup_renders";
CREATE POLICY "mockup_renders_org_isolation" ON "mockup_renders"
  USING ("org_id" = current_org_id())
  WITH CHECK ("org_id" = current_org_id());

DROP POLICY IF EXISTS "boiler_state_org_isolation" ON "boiler_state";
CREATE POLICY "boiler_state_org_isolation" ON "boiler_state"
  USING ("org_id" = current_org_id())
  WITH CHECK ("org_id" = current_org_id());

-- ────────────────────────────────────────────────────────────────────
-- Realtime — add the three new tables to the supabase_realtime publication
-- ────────────────────────────────────────────────────────────────────
-- Workspace renderer subscribes to design_versions + boiler_state + mockup_renders
-- to live-update the version strip, active design, and mockup view as ORC tools
-- run. Same pattern as Phase 6.5's collection_runs realtime.

ALTER PUBLICATION supabase_realtime ADD TABLE "design_versions";
ALTER PUBLICATION supabase_realtime ADD TABLE "mockup_renders";
ALTER PUBLICATION supabase_realtime ADD TABLE "boiler_state";

-- ────────────────────────────────────────────────────────────────────
-- Updated-at trigger — keep updated_at fresh on writes
-- ────────────────────────────────────────────────────────────────────
-- Reuses the trigger function from Phase 2 (update_updated_at_column).

DROP TRIGGER IF EXISTS "design_versions_updated_at" ON "design_versions";
CREATE TRIGGER "design_versions_updated_at"
  BEFORE UPDATE ON "design_versions"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS "boiler_state_updated_at" ON "boiler_state";
CREATE TRIGGER "boiler_state_updated_at"
  BEFORE UPDATE ON "boiler_state"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ────────────────────────────────────────────────────────────────────
-- Config: feature flag for the new BOILER renderer
-- ────────────────────────────────────────────────────────────────────
-- Phase 11D.4 ships the new workspace renderer behind a flag so the old gallery
-- keeps working during the transition. When boiler_v2_renderer = true, the
-- workspace BOILER tab loads the new single-design renderer. When false, the
-- existing 4-variant gallery renderer is used.
--
-- config_engine_room is per-org so we seed for every existing org (the BLIPS
-- org is the only one today; pattern stays correct if we ever add more).
-- ON CONFLICT (org_id, key) DO NOTHING keeps re-runs idempotent.

INSERT INTO "config_engine_room" ("org_id", "key", "value")
SELECT "id", 'boiler_v2_renderer', 'false'::jsonb FROM "orgs"
ON CONFLICT ("org_id", "key") DO NOTHING;
