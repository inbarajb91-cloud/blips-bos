import { redirect } from "next/navigation";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import { QueryProvider } from "@/lib/query-client";
import { Nav } from "@/components/shell/nav";
import { ContentFrame } from "@/components/shell/content-frame";

/**
 * Authenticated app shell.
 *
 * Phase 7 chrome cleanup: removed the bottom StatusBar (ORC awake chip
 * + signals active counts). The info was decorative for day-to-day
 * work and the row was eating vertical real estate. Pipeline status is
 * surfaced where it matters — on Bridge collections and in the
 * workspace header state chips.
 *
 * Layout: Nav (48px) + ContentFrame (fills remaining viewport).
 * Each route owns its own scroll semantics inside ContentFrame.
 *
 * REVIEW.md F19 (Medium): use `getCurrentUserWithOrg` instead of
 * `supabase.auth.getUser()` directly. The helper does the same auth check
 * AND joins to public.users for the org_id. Without it, every authenticated
 * render did one Supabase auth roundtrip here, then another inside
 * downstream actions/routes that need org_id — two roundtrips for the
 * same answer. Single source of truth + consistent failure surface for
 * un-provisioned users (Supabase auth exists but no public.users row =
 * silent broken state at every action; now bounces to /login at the shell).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUserWithOrg();

  if (!user) {
    redirect("/login");
  }

  return (
    <QueryProvider>
      <div className="grid grid-rows-[48px_1fr] h-dvh bg-ink">
        <Nav email={user.email} />
        <ContentFrame>{children}</ContentFrame>
      </div>
    </QueryProvider>
  );
}
