import { formatModelName } from "./skills-data";

export interface OrcCardProps {
  model?: string;
  temperature?: number;
  /** "Awake" / "Idle" / "Working" — live state plumbed in Phase 5+ */
  state?: "Awake" | "Idle" | "Working";
  /** Currently-loaded pipeline skill, if any */
  activeSkill?: string;
}

/**
 * The ORC card sits at the top of the Agents section — larger, distinct, and
 * the only card with a breathing status dot since ORC is the only AI entity
 * in the system. The six pipeline cards below are skills ORC loads.
 */
export function OrcCard({
  model,
  temperature,
  state = "Awake",
  activeSkill = "— idle —",
}: OrcCardProps) {
  return (
    <div className="bg-ink border border-deep-divider rounded-md p-6">
      <div className="flex items-start justify-between gap-6 mb-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="font-display text-2xl font-extrabold text-off-white tracking-tight leading-none">
              ORC
            </span>
            <span
              aria-hidden
              className="inline-block w-2 h-2 rounded-full bg-off-white breathe"
            />
            <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted">
              Orchestrator
            </span>
          </div>
          <p className="font-editorial italic text-warm-bright text-lg leading-tight">
            One orchestrator, six skills.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-muted">
            State
          </span>
          <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-off-white">
            {state}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-6 pt-5 border-t border-deep-divider">
        <InfoCell label="Active skill" value={activeSkill} />
        <InfoCell label="Model" value={formatModelName(model)} />
        <InfoCell
          label="Temperature"
          value={temperature !== undefined ? temperature.toFixed(1) : "—"}
        />
      </dl>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-muted">
        {label}
      </dt>
      <dd className="font-mono text-[13px] text-off-white">{value}</dd>
    </div>
  );
}
