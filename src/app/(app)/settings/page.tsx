import Link from "next/link";

export const metadata = { title: "BOS Settings · BLIPS" };

interface SettingsSection {
  title: string;
  desc: string;
  phase: string;
  href?: string;
}

const SECTIONS: SettingsSection[] = [
  {
    title: "Knowledge",
    desc: "Curated reference docs ORC reads — brand strategy, decade playbooks, voice guidelines. Founder-only.",
    phase: "Phase 8L · Live",
    href: "/settings/knowledge",
  },
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
];

export default function BOSSettingsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 pt-10 pb-16">
      <h1 className="font-display text-2xl font-semibold mb-2">BOS Settings</h1>
      <p className="font-mono text-xs text-warm-muted mb-10 leading-relaxed">
        Platform-level configuration. For per-module settings, open the module
        and go to its Settings section.
      </p>

      <div className="flex flex-col gap-px border border-deep-divider rounded-md overflow-hidden">
        {SECTIONS.map((s) => {
          const inner = (
            <div className="flex items-start justify-between gap-6">
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
          );

          // Link rows for live sections, static rows for placeholder ones.
          // Live sections get a hover treatment so the affordance reads.
          if (s.href) {
            return (
              <Link
                key={s.title}
                href={s.href}
                className="bg-ink px-5 py-5 border-b border-deep-divider last:border-b-0 transition-colors hover:bg-ink-warm focus-visible:outline-none focus-visible:bg-ink-warm"
              >
                {inner}
              </Link>
            );
          }
          return (
            <div
              key={s.title}
              className="bg-ink px-5 py-5 border-b border-deep-divider last:border-b-0"
            >
              {inner}
            </div>
          );
        })}
      </div>

      <p className="font-editorial text-warm-muted text-base mt-10 text-center">
        More sections surface as each phase defines what belongs here.
      </p>
    </div>
  );
}
