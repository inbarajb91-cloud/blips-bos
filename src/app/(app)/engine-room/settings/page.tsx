export const metadata = {
  title: "Engine Room Settings · BLIPS BOS",
};

const SECTIONS = [
  {
    title: "ORC Behavior",
    desc: "Routing, prioritization, summarization, learning sensitivity.",
    phase: "Phase 5",
  },
  {
    title: "Pipeline Rules",
    desc: "Stage sequence, handoff conditions, auto-advance toggles per stage.",
    phase: "Phase 5",
  },
  {
    title: "Human Gates",
    desc: "Which stages require approval. Default: every stage. Flip off per stage once you trust an agent.",
    phase: "Phase 6+",
  },
  {
    title: "Stale Thresholds",
    desc: "How many days before a signal stuck at a stage gets flagged.",
    phase: "Phase 5",
  },
  {
    title: "Batch Defaults",
    desc: "Whether new signals auto-assign to an active batch, default batch name format, etc.",
    phase: "Phase 6",
  },
] as const;

export default function EngineRoomSettingsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 pt-10 pb-16">
      <h1 className="font-display text-2xl font-semibold mb-2">
        Engine Room Settings
      </h1>
      <p className="font-mono text-xs text-warm-muted mb-10 leading-relaxed">
        Module-level rules for the pipeline. For platform-wide config
        (API keys, users, notifications), open{" "}
        <span className="text-warm-bright">BOS Settings</span>.
      </p>

      <div className="flex flex-col gap-px border border-deep-divider rounded-md overflow-hidden">
        {SECTIONS.map((s) => (
          <div
            key={s.title}
            className="bg-ink px-5 py-5 flex items-start justify-between gap-6 border-b border-deep-divider last:border-b-0"
          >
            <div className="flex flex-col gap-1">
              <span className="font-display text-sm font-medium text-off-white">
                {s.title}
              </span>
              <span className="font-mono text-[11px] text-warm-bright leading-relaxed">
                {s.desc}
              </span>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-warm-muted whitespace-nowrap mt-0.5">
              {s.phase}
            </span>
          </div>
        ))}
      </div>

      <p className="font-editorial italic text-warm-muted text-base mt-10 text-center">
        Current defaults: every human gate requires approval. Flip them off as
        trust earns through.
      </p>
    </div>
  );
}
