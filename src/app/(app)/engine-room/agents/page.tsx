import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, configAgents } from "@/db";
import { getCurrentUserWithOrg } from "@/lib/auth/current-user";
import {
  AgentsGrid,
  type AgentConfigMap,
} from "@/components/engine-room/agents-grid";

export const metadata = {
  title: "Agents · Engine Room · BLIPS BOS",
};

export default async function AgentsPage() {
  const user = await getCurrentUserWithOrg();
  if (!user) redirect("/login");

  // Read all config_agents rows for this org, group by agent_name.
  // One query, all agents — the Agents screen renders the full pipeline in one render.
  const rows = await db
    .select({
      agentName: configAgents.agentName,
      key: configAgents.key,
      value: configAgents.value,
    })
    .from(configAgents)
    .where(eq(configAgents.orgId, user.orgId));

  const configs: AgentConfigMap = {};
  for (const r of rows) {
    if (!configs[r.agentName]) configs[r.agentName] = {};
    configs[r.agentName][r.key] = r.value as unknown;
  }

  return (
    <div className="max-w-5xl mx-auto px-8 pt-10 pb-16">
      <header className="mb-10">
        <h1 className="font-display text-2xl font-semibold leading-tight">
          Agents
        </h1>
        <p className="font-mono text-xs text-warm-muted mt-2 leading-relaxed">
          One orchestrator, six skills. ORC loads each skill when a signal
          reaches that stage. Model choice per skill lives in{" "}
          <span className="text-warm-bright">Engine Room Settings</span> and can
          be swapped without redeploying.
        </p>
      </header>

      <AgentsGrid configs={configs} />
    </div>
  );
}
