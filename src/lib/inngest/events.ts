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
