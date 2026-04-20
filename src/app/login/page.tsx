import { signIn } from "./actions";

export const metadata = { title: "Sign in · BLIPS BOS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ink text-off-white px-8">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-10">
          <span className="font-display text-3xl font-extrabold tracking-tight">
            BLIPS
          </span>
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-off-white breathe"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-warm-muted ml-2">
            BOS
          </span>
        </div>

        <h1 className="font-display text-xl font-semibold mb-2">Sign in</h1>
        <p className="font-mono text-xs text-warm-muted mb-8 leading-relaxed">
          Founder access. Portal: HELM.
        </p>

        <form action={signIn} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-warm-bright">
              Email
            </span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="bg-transparent border border-deep-divider rounded-md px-3 py-2 font-mono text-sm text-off-white focus:outline-none focus:border-off-white focus:ring-0 transition-colors"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-warm-bright">
              Password
            </span>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="bg-transparent border border-deep-divider rounded-md px-3 py-2 font-mono text-sm text-off-white focus:outline-none focus:border-off-white focus:ring-0 transition-colors"
            />
          </label>

          {error && (
            <p className="font-mono text-xs text-off-white/80 border-l-2 border-off-white/40 pl-3 py-1 mt-1">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="mt-2 bg-off-white text-ink font-mono text-sm uppercase tracking-[0.15em] py-2.5 rounded-md hover:bg-warm-bright transition-colors"
          >
            Enter
          </button>
        </form>

        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-warm-muted mt-10 text-center">
          · · ·
        </p>
      </div>
    </main>
  );
}
