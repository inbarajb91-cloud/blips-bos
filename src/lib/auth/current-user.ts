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
 * Server component / server action use. React.cache dedups repeat calls within
 * a single render. Returns null if no session or no linked profile row.
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
