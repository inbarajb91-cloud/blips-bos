import { formatModelName, type SkillMeta } from "./skills-data";

export interface SkillCardProps extends SkillMeta {
  model?: string;
  /** Phase 5+ — real state (idle/active/running) plumbed from agent_logs */
  state?: "idle" | "active";
}

/**
 * One of the six pipeline skill cards. Rendered 2×3 below the ORC card.
 * In Ink's "engineered and alive" language — inactive cards are still,
 * active cards get a subtle breathing ring around the stage number.
 */
export function SkillCard({
  stage,
  name,
  metaphor,
  role,
  model,
  state = "idle",
}: SkillCardProps) {
  return (
    <div className="bg-ink border border-deep-divider rounded-md p-5 flex flex-col gap-3 hover:border-warm-muted transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded border text-[10px] font-mono font-medium tabular-nums ${
              state === "active"
                ? "border-off-white text-off-white breathe-ring"
                : "border-deep-divider text-warm-muted"
            }`}
          >
            {stage}
          </span>
          <span className="font-display text-base font-bold text-off-white tracking-tight">
            {name}
          </span>
        </div>
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-warm-muted text-right leading-tight">
          {formatModelName(model)}
        </span>
      </div>

      <p className="font-editorial text-warm-bright text-sm leading-snug">
        {metaphor}
      </p>

      <p className="font-mono text-[10px] text-warm-muted leading-relaxed tracking-wide">
        {role}
      </p>

      <div className="pt-3 border-t border-deep-divider flex items-center justify-between">
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-warm-muted">
          0 processed · 0 passed
        </span>
      </div>
    </div>
  );
}
