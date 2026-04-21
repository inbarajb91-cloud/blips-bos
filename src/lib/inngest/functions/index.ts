import { testRun } from "./pipeline";

/**
 * Inngest function registry — every function the app exposes.
 *
 * Passed to `serve()` in `/api/inngest/route.ts` so Inngest Cloud can
 * discover and invoke them. Adding a new function = import here + list.
 *
 * Phase 5: just `testRun`. Real pipeline functions land phase-by-phase.
 */
export const functions = [testRun];
