/**
 * Shown during route transitions inside the (app) group.
 * Next.js swaps this in automatically while the next route streams.
 * Keeps the shell chrome (nav + status bar) and shows a breathing dot
 * in the content frame so the user knows something is happening.
 */
export default function AppLoading() {
  return (
    <div className="flex-1 flex items-center justify-center bg-ink">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full bg-off-white breathe"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-warm-muted">
          Loading
        </span>
      </div>
    </div>
  );
}
