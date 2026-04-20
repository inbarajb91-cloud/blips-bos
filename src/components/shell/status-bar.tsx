export function StatusBar({
  pipelineStatus = "6 signals active · 2 awaiting triage · 1 at BOILER",
  orcStatus = "ORC · AWAKE · 6 SKILLS REGISTERED",
}: {
  pipelineStatus?: string;
  orcStatus?: string;
}) {
  return (
    <div className="chrome-brightness h-8 bg-ink/95 backdrop-blur-md border-t border-deep-divider flex items-center justify-between px-5 font-mono font-light text-[9px] uppercase tracking-[0.16em] text-warm-muted relative z-[5]">
      <div className="flex items-center gap-3.5">
        <span className="text-warm-bright">{orcStatus}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <span className="inline-flex items-center gap-[7px] text-warm-bright">
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full bg-off-white breathe"
          />
          <span>{pipelineStatus}</span>
        </span>
        <span
          aria-hidden
          className="inline-block w-[3px] h-[3px] rounded-full bg-warm-muted opacity-50"
        />
        <span className="tracking-[0.12em] tabular-nums">v0.1</span>
      </div>
    </div>
  );
}
