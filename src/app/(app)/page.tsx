import { redirect } from "next/navigation";

/**
 * BOS home route.
 *
 * Phase 4: there's only one module (Engine Room), so `/` redirects directly
 * into it. When Store / Vendor / Marketing land, this becomes the BOS home
 * with a module grid + system status — but that's premature for a single
 * active module (would be one card + three ghost cards = clutter).
 */
export default function BosRoot() {
  redirect("/engine-room");
}
