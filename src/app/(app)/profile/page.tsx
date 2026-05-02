import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Profile · BLIPS BOS" };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? "unknown";
  const created = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
  const lastSignIn = user?.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 pt-10 pb-16">
      <h1 className="font-display text-2xl font-semibold mb-2">Profile</h1>
      <p className="font-mono text-xs text-warm-muted mb-10 leading-relaxed">
        Your account on BLIPS BOS.
      </p>

      <dl className="flex flex-col gap-0 border border-deep-divider rounded-md overflow-hidden">
        <Row label="Email" value={email} />
        <Row label="Role" value="Founder" />
        <Row label="Portal" value="HELM" />
        <Row label="Account created" value={created} />
        <Row label="Last sign-in" value={lastSignIn} />
      </dl>

      <p className="font-editorial text-warm-muted text-base mt-10 text-center">
        Full profile editing lands in Phase 2.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink px-5 py-4 flex items-center justify-between gap-6 border-b border-deep-divider last:border-b-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted">
        {label}
      </dt>
      <dd className="font-mono text-sm text-off-white">{value}</dd>
    </div>
  );
}
