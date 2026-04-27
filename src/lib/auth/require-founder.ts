import { getCurrentUserWithOrg, type CurrentUserWithOrg } from "./current-user";

/**
 * Founder-only gate for server actions and server components.
 *
 * Phase 8L: the curated knowledge layer is founder-authored only —
 * brand voice integrity matters; one author keeps it coherent.
 * RBAC for additional roles (knowledge editor, employee curator)
 * lands when DECK ships and we need a richer permissions model.
 *
 * Throws on non-founder. Callers should let the throw propagate so
 * server actions return a clean error to the client; UI components
 * should wrap in error boundaries or pre-check `role` before
 * rendering write affordances.
 *
 * Defense-in-depth: server-action gate + RLS scoping by org_id.
 * A non-founder's session would still pass RLS for read (they're in
 * the same org), but write-side actions throw here before SQL ever
 * fires. Future: add `role`-aware RLS policies when DECK ships.
 */
export async function requireFounder(): Promise<CurrentUserWithOrg> {
  const user = await getCurrentUserWithOrg();
  if (!user) {
    throw new Error("Unauthenticated");
  }
  if (user.role !== "FOUNDER") {
    throw new Error(
      "Only the founder can edit knowledge documents. Contact Inba if you need access.",
    );
  }
  return user;
}
