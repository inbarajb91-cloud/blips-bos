/**
 * Typed event schema for the BLIPS BOS pipeline.
 *
 * Every event that travels through Inngest is declared here. The typed
 * schema gives us compile-time safety when firing (`inngest.send`) and
 * consuming (`inngest.createFunction`) events.
 *
 * Naming convention:
 *   <agent>.ready            — previous stage approved, this stage should run
 *   <agent>.complete         — stage skill finished; next step is human gate
 *   <agent>.<thing>.approved — user approved output from human gate; fire next .ready
 *
 * Event data always carries `orgId` for multi-tenant scoping. Pipeline events
 * carry `signalId`. Sub-stage events carry extra identifiers.
 */

export type BlipsEvents = {
  // ─── BUNKER — signal detection (Phase 6) ─────────────────────
  "bunker.collection.scheduled": {
    data: { orgId: string; sources?: string[] };
  };
  "bunker.collection.on_demand": {
    data: { orgId: string; sources?: string[] };
  };
  "bunker.candidate.approved": {
    data: { orgId: string; candidateId: string; signalId: string };
  };

  // ─── Collections (Phase 6.5) ─────────────────────────────────
  /**
   * Run BUNKER against a specific collection. Fires when a user creates
   * an Instant/Batch via the Collect-now modal, or when the scheduled-
   * collection cron ticks a scheduled collection's next_run_at.
   */
  "bunker.collection.run": {
    data: { orgId: string; collectionId: string };
  };
  /**
   * Scheduled cron — wakes hourly, finds scheduled collections whose
   * next_run_at has passed, fans out to `bunker.collection.run`.
   */
  "bunker.collection.scheduled_check": {
    data: Record<string, never>;
  };

  // ─── STOKER — season/decade tagging (Phase 9) ────────────────
  "stoker.ready": {
    data: { orgId: string; signalId: string };
  };
  "stoker.complete": {
    data: { orgId: string; signalId: string; outputId: string };
  };
  "stoker.output.approved": {
    data: { orgId: string; signalId: string; outputId: string };
  };

  // ─── FURNACE — brand fit + brief (Phase 10) ──────────────────
  "furnace.ready": {
    data: { orgId: string; signalId: string; decadeId: string };
  };
  "furnace.complete": {
    data: {
      orgId: string;
      signalId: string;
      decadeId: string;
      outputId: string;
    };
  };
  "furnace.output.approved": {
    data: {
      orgId: string;
      signalId: string;
      decadeId: string;
      outputId: string;
    };
  };

  // ─── BOILER — concept + mockup (Phase 11) ────────────────────
  "boiler.ready": {
    data: { orgId: string; signalId: string };
  };
  "boiler.complete": {
    data: { orgId: string; signalId: string; outputId: string };
  };
  "boiler.concept.approved": {
    data: { orgId: string; signalId: string; outputId: string };
  };

  // ─── BOILER v2 — Phase 11D ────────────────────────────────────
  // One unified event for all generation flavors. The orchestrator dispatches
  // on `mode` to pick fresh / refine / branch / finalize logic. Auto-retry
  // on verifier failure (low tier only) re-fires this event with `parent`
  // set + `refinementInstruction` set from the verifier suggestions, so the
  // same handler walks the same path.
  "boiler.v2.generate": {
    data: {
      orgId: string;
      signalId: string;
      journeyId?: string;
      tier: "low" | "medium" | "high";
      /** Mode determines payload semantics + how parent/refinement are used. */
      mode: "fresh" | "refine" | "branch" | "finalize";
      /** Set on refine/branch/finalize — the design_versions row to chain off. */
      parentVersionId?: string;
      /** Set on refine only — the natural-language change to apply. */
      refinementInstruction?: string;
      /** Optional override of palette roles (e.g. after a set_color call). */
      paletteRolesOverride?: Record<string, string>;
      /** How many auto-retries this attempt has already gone through.
       *  Used to cap auto-retry depth (default cap: 2 retries on low tier). */
      retryDepth?: number;
      /**
       * True when this event was fired by the BOILER handler's auto-retry path
       * (NOT by a founder-driven refine_design tool call). The handler's
       * shouldAutoRetry gate uses this to allow continuation: founder-driven
       * refines NEVER auto-retry on failure (they're an explicit choice), but
       * the auto-retry chain itself can continue up to MAX_AUTO_RETRY_DEPTH.
       */
      autoRetried?: boolean;
      /** User who triggered the generation (for created_by audit). */
      triggeredBy?: string;
    };
  };

  // ─── ENGINE — tech pack (Phase 12) ───────────────────────────
  "engine.ready": {
    data: { orgId: string; signalId: string };
  };
  "engine.complete": {
    data: { orgId: string; signalId: string; outputId: string };
  };
  "engine.techpack.approved": {
    data: { orgId: string; signalId: string; outputId: string };
  };

  // ─── PROPELLER — vendor bundle (post-launch) ─────────────────
  "propeller.ready": {
    data: { orgId: string; signalId: string };
  };
  "propeller.complete": {
    data: { orgId: string; signalId: string; outputId: string };
  };

  // ─── Dev / infrastructure ────────────────────────────────────
  /**
   * Event-bus ping. Fired by `scripts/fire-test-event.ts` to validate that
   * events travel from our code → Inngest Cloud → our Vercel function →
   * back to Inngest with a successful return. No LLM, no DB writes, no
   * skill dependency — pure plumbing check.
   */
  "test.run": {
    data: { message: string };
  };
};
