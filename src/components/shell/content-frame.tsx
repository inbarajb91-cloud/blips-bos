export function ContentFrame({ children }: { children?: React.ReactNode }) {
  if (children) {
    // No padding here — each page (or nested layout) owns its own spacing.
    // This lets Engine Room render an edge-to-edge section tab strip that
    // aligns flush with the nav above and status bar below.
    return (
      <div className="flex-1 min-h-0 overflow-auto relative bg-ink">
        {children}
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center relative bg-ink p-8">
      <div className="font-editorial font-light text-[22px] text-warm-muted tracking-[0.01em] select-none">
        — No module loaded —
      </div>
    </div>
  );
}
