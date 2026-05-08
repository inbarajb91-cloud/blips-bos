import { redirect } from "next/navigation";
import { listAgentConfigs } from "@/lib/actions/agent-config";
import { CATALOG } from "@/lib/ai/model-catalog";
import { PROVIDER_LIST } from "@/lib/ai/providers";
import { AgentModelsEditor } from "@/components/engine-room/settings/agent-models-editor";

export const metadata = {
  title: "Agent Models · Engine Room Settings · BLIPS BOS",
};

/**
 * Agent Models settings — Phase 3.5.
 *
 * Founder-facing affordance to swap each agent's model, temperature,
 * and fallback chain. Replaces the "every change is a SQL update"
 * workflow with the abstraction layer's promise from Phase 3:
 * "swap a model = config change, no code, no redeploy."
 *
 * The page server-renders current configs via `listAgentConfigs()`
 * (which `requireFounder()`s, so non-founders get redirected from
 * the underlying read). We pass the full catalog + provider list as
 * props to the client editor so the dropdown options are static
 * across the session.
 */

export default async function AgentModelsSettingsPage() {
  let configs;
  try {
    configs = await listAgentConfigs();
  } catch (err) {
    // CR pass 1 — distinguish auth rejections (non-founder hitting this
    // URL → redirect quietly) from real failures (DB outage, deserialization,
    // etc. → log to server so it surfaces in observability + still redirect
    // to keep the UI sane). requireFounder throws Error("Founder required")
    // on the non-auth path; everything else needs a trace.
    const message = err instanceof Error ? err.message : String(err);
    if (
      !message.toLowerCase().includes("founder") &&
      !message.toLowerCase().includes("auth")
    ) {
      console.error(
        "[AgentModelsSettingsPage] listAgentConfigs failed unexpectedly:",
        err,
      );
    }
    redirect("/engine-room");
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 md:px-10 pt-10 pb-16">
      <header className="mb-10 max-w-3xl">
        <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-warm-muted mb-2">
          Engine Room Settings · Agent Models
        </div>
        <h1 className="font-display text-2xl font-semibold mb-3 leading-tight">
          Agent Models
        </h1>
        <p className="font-mono text-xs text-warm-bright leading-relaxed mb-3">
          One row per agent. Edit the primary model, the fallback
          chain, and the temperature. Save per row, or use{" "}
          <span className="text-off-white">Apply to all</span> at the
          top to swap every agent in one click — useful for testing a
          new model across the whole pipeline.
        </p>
        <p className="font-mono text-xs text-warm-bright leading-relaxed">
          Click <span className="text-off-white">Test</span> next to
          any model to send a 4-token probe call before saving — confirms
          the provider key is set and the model id is valid.
        </p>
      </header>

      <AgentModelsEditor
        configs={configs}
        catalog={CATALOG}
        providers={PROVIDER_LIST.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          envVar: p.envVar,
          compatible: !!p.compatible,
        }))}
      />
    </div>
  );
}
