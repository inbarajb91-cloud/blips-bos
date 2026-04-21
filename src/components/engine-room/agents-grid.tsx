import { OrcCard } from "./orc-card";
import { SkillCard } from "./skill-card";
import { SKILLS } from "./skills-data";

export type AgentConfigMap = Record<string, Record<string, unknown>>;

export function AgentsGrid({ configs }: { configs: AgentConfigMap }) {
  const orc = configs.ORC ?? {};

  return (
    <div className="flex flex-col gap-8">
      <OrcCard
        model={typeof orc.model === "string" ? orc.model : undefined}
        temperature={
          typeof orc.temperature === "number" ? orc.temperature : undefined
        }
      />

      <div>
        <h2 className="font-mono text-[10px] tracking-[0.25em] uppercase text-warm-muted mb-4">
          Skills
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SKILLS.map((skill) => {
            const cfg = configs[skill.agentKey] ?? {};
            return (
              <SkillCard
                key={skill.agentKey}
                {...skill}
                model={typeof cfg.model === "string" ? cfg.model : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
