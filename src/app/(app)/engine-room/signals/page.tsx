export const metadata = {
  title: "Signal Workspace · Engine Room · BLIPS BOS",
};

/**
 * Signal Workspace — the per-signal deep view with agent tabs and output canvas.
 *
 * Phase 4: empty state (no signal selected).
 * Phase 7: full workspace with agent tabs, ORC conversation, and output canvas.
 */
export default function SignalWorkspacePage() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-16 gap-6 text-center">
      <p className="font-editorial italic text-warm-bright text-3xl leading-tight max-w-md">
        Pick a signal to open its workspace.
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-warm-muted max-w-sm leading-relaxed">
        From the Bridge, click any active row.
      </p>
    </div>
  );
}
