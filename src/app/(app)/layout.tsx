import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/shell/nav";
import { ContentFrame } from "@/components/shell/content-frame";
import { StatusBar } from "@/components/shell/status-bar";

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
    <div className="grid grid-rows-[48px_1fr_32px] h-dvh bg-ink">
      <Nav
        email={user.email ?? "founder@blipsstore.com"}
        breadcrumb={["BOS", "Engine Room"]}
      />
      <ContentFrame>{children}</ContentFrame>
      <StatusBar />
    </div>
  );
}
