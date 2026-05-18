import { cache } from "react";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db, users } from "@/db";

export interface CurrentUserWithOrg {
  /** Supabase auth user id */
  authId: string;
  email: string;
  /** BOS org id from public.users */
  orgId: string;
  role: "FOUNDER" | "EMPLOYEE" | "PARTNER" | "VENDOR";
}

/**
 * Resolve the current user's Supabase auth + `public.users` profile + org_id.
 *
 * Server component / server action use. Returns null if no session or no
 * linked profile row.
 *
 * Caching caveat (REVIEW.md F24, May 18 2026):
 *   React.cache dedups within ONE component tree. It does NOT dedup across
 *   separate awaits inside a route handler or server action. Calling
 *   `getCurrentUserWithOrg` in three actions during one request = three
 *   DB roundtrips of ~80-150ms each.
 *
 *   Accepted as-is at current single-user scale (cost ~< 500ms per
 *   request — invisible). When DECK ships and concurrency matters,
 *   migrate to a true request-scoped cache (WeakMap keyed by `headers()`
 *   instance, or Next's `unstable_cache`). Keep this docstring in mind
 *   so future refactors don't over-rely on "React.cache will dedupe it."
 */
export const getCurrentUserWithOrg = cache(
  async (): Promise<CurrentUserWithOrg | null> => {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return null;

    const [profile] = await db
      .select()
      .from(users)
      .where(eq(users.id, authUser.id))
      .limit(1);
    if (!profile) return null;

    return {
      authId: authUser.id,
      email: authUser.email ?? profile.email,
      orgId: profile.orgId,
      role: profile.role,
    };
  },
);
