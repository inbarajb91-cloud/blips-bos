import { Inngest } from "inngest";

/**
 * The singleton Inngest client.
 *
 * Used both to fire events (`inngest.send({...})`) and to declare functions
 * (`inngest.createFunction(...)`).
 *
 * Note: Inngest v4 removed the `EventSchemas().fromRecord<T>()` helper. Types
 * for event data live in `./events.ts` as a reference and are validated at
 * the handler level (via Zod or manual assertion) when real skills consume
 * the payloads in Phase 6+.
 *
 * `id: "blips-bos"` is the app ID Inngest Cloud uses to group all functions
 * under a single project.
 */
export const inngest = new Inngest({
  id: "blips-bos",
});
