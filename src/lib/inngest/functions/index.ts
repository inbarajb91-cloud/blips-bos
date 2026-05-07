import { testRun } from "./pipeline";
import {
  bunkerCollectionScheduled,
  bunkerCollectionOnDemand,
  bunkerCollectionRun,
  bunkerScheduledCheck,
} from "./bunker";
import { stokerProcess } from "./stoker";
import { furnaceProcess } from "./furnace";

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
  bunkerCollectionRun,
  bunkerScheduledCheck,
  stokerProcess, // Phase 9C
  furnaceProcess, // Phase 10C
];
