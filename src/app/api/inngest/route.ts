import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

/**
 * Inngest webhook endpoint.
 *
 * - GET: Inngest fetches the function registry
 * - POST: Inngest invokes functions when their events fire
 * - PUT: Inngest registers the app on first contact (sync)
 *
 * Inngest Cloud discovers this URL after the first deploy and syncs the
 * function list. INNGEST_SIGNING_KEY validates every incoming webhook.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
