import { testRun } from "./pipeline";
import {
  bunkerCollectionScheduled,
  bunkerCollectionOnDemand,
} from "./bunker";

/**
 * Inngest function registry — every function the app exposes.
 *
 * Passed to `serve()` in `/api/inngest/route.ts` so Inngest Cloud can
 * discover and invoke them. Adding a new function = import here + list.
 */
export const functions = [
  testRun,
  bunkerCollectionScheduled,
  bunkerCollectionOnDemand,
];
