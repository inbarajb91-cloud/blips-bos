export default function SignalsLoading() {
  return (
    <div className="h-full flex items-center justify-center">
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
