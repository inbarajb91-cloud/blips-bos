export const metadata = { title: "BOS Settings · BLIPS" };

const SECTIONS = [
  {
    title: "API Keys",
    desc: "Anthropic, Gemini, OpenAI, Cloudinary, Reddit, NewsAPI",
    phase: "Phase 2",
  },
  {
    title: "Users & Access",
    desc: "Founder, employees, vendor partners. Roles & permissions.",
    phase: "Phase 2 + DECK portal",
  },
  {
    title: "Notifications",
    desc: "Email, in-app, mobile push. Per-stage and per-event routing.",
    phase: "Phase 2",
  },
  {
    title: "Billing & Usage",
    desc: "LLM cost observability, Supabase/Vercel/Inngest metering.",
    phase: "Phase 13",
  },
] as const;

export default function BOSSettingsPage() {
  return (
    <div className="max-w-2xl mx-auto pt-10">
      <h1 className="font-display text-2xl font-semibold mb-2">BOS Settings</h1>
      <p className="font-mono text-xs text-warm-muted mb-10 leading-relaxed">
        Platform-level configuration. For per-module settings, open the module
        and go to its Settings section.
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
        Settings surface as each phase defines what belongs here.
      </p>
    </div>
  );
}
