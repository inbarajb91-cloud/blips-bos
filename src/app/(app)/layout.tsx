import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <QueryProvider>
      <div className="grid grid-rows-[48px_1fr] h-dvh bg-ink">
        <Nav email={user.email ?? "founder@blipsstore.com"} />
        <ContentFrame>{children}</ContentFrame>
      </div>
    </QueryProvider>
  );
}
