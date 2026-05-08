"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkApplyModel,
  probeModel,
  updateAgentConfig,
  type AgentConfigSummary,
} from "@/lib/actions/agent-config";
import type { CatalogModel } from "@/lib/ai/model-catalog";

/**
 * AgentModelsEditor — Phase 3.5 client UI.
 *
 * Renders the 7 agents as editable rows. Each row owns its own draft
 * state + save action; a bulk-apply card at the top handles "swap
 * everything to model X" without a 7-row scroll.
 *
 * Why no react-hook-form / zod-resolver: the surface is small (model,
 * temperature, fallback chain), the validation is identical to the
 * server action's, and adding a form library would dwarf the actual
 * code. useState + per-row save fits.
 */

interface ProviderInfo {
  id: string;
  displayName: string;
  envVar: string;
  compatible: boolean;
}

interface Props {
  configs: AgentConfigSummary[];
  catalog: CatalogModel[];
  providers: ProviderInfo[];
}

export function AgentModelsEditor({ configs, catalog, providers }: Props) {
  return (
    <div className="flex flex-col gap-10">
      <BulkApplyCard catalog={catalog} />
      <ProviderKeysCard providers={providers} />

      <section>
        <h2 className="font-mono text-[10px] tracking-[0.22em] uppercase text-warm-muted mb-4">
          Per-agent configuration
        </h2>
        <div className="flex flex-col gap-4">
          {configs.map((cfg) => (
            <AgentRow key={cfg.agentName} config={cfg} catalog={catalog} />
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Per-agent row ────────────────────────────────────────────────

function AgentRow({
  config,
  catalog,
}: {
  config: AgentConfigSummary;
  catalog: CatalogModel[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draftModel, setDraftModel] = useState(config.model);
  const [draftTemp, setDraftTemp] = useState(config.temperature);
  const [draftChain, setDraftChain] = useState<string>(
    config.modelFallbackChain.join("\n"),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    ok: boolean;
    durationMs: number;
    error?: string;
    provider?: string;
  } | null>(null);
  const [probing, startProbe] = useTransition();

  const dirty =
    draftModel !== config.model ||
    draftTemp !== config.temperature ||
    draftChain !== config.modelFallbackChain.join("\n");

  const chainEntries = draftChain
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  function handleSave() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await updateAgentConfig({
          agentName: config.agentName,
          model: draftModel.trim(),
          temperature: draftTemp,
          modelFallbackChain: chainEntries,
        });
        setSuccess("Saved.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  function handleProbe() {
    setProbe(null);
    setError(null);
    startProbe(async () => {
      try {
        const r = await probeModel(draftModel.trim());
        setProbe({
          ok: r.ok,
          durationMs: r.durationMs,
          error: r.errorMessage,
          provider: r.resolvedProvider,
        });
      } catch (e) {
        setProbe({
          ok: false,
          durationMs: 0,
          error: e instanceof Error ? e.message : "Probe failed.",
        });
      }
    });
  }

  return (
    <div className="bg-ink border border-deep-divider rounded-md p-5 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted mb-1">
            Agent
          </div>
          <h3 className="font-display text-lg font-semibold tracking-tight text-off-white">
            {config.agentName}
          </h3>
        </div>
        <div className="text-right">
          <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted mb-1">
            Provider
          </div>
          <div className="font-mono text-xs text-warm-bright">
            {config.provider ?? (
              <span className="text-[#d4908a]">(unrecognized model)</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
        {/* Primary model */}
        <FieldBlock label="Primary model">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              list={`catalog-${config.agentName}`}
              spellCheck={false}
              autoComplete="off"
              className="bg-black/30 border border-rule-2 text-off-white font-mono text-[12.5px] px-3 py-2 rounded-sm outline-none focus:border-[rgba(242,239,233,0.4)]"
              placeholder="e.g. gemini-2.5-pro · openai/gpt-4o · openrouter/moonshotai/kimi-k2"
            />
            <datalist id={`catalog-${config.agentName}`}>
              {catalog.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  label={`${m.displayName} — ${m.hint ?? ""}`}
                />
              ))}
            </datalist>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || !draftModel.trim()}
                className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-1.5 rounded-sm border border-rule-2 text-warm-bright hover:text-off-white hover:border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warm-bright disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {probing ? "Probing…" : "Test"}
              </button>
              {probe && (
                <ProbeResult result={probe} />
              )}
            </div>
          </div>
        </FieldBlock>

        {/* Temperature */}
        <FieldBlock label="Temperature">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={draftTemp}
            onChange={(e) => setDraftTemp(Number(e.target.value))}
            className="bg-black/30 border border-rule-2 text-off-white font-mono text-[12.5px] px-3 py-2 rounded-sm outline-none focus:border-[rgba(242,239,233,0.4)] w-full"
          />
          <div className="font-mono text-[9px] text-warm-muted mt-1.5">
            0.0 = deterministic · 1.0 = creative · &gt;1.5 = noisy
          </div>
        </FieldBlock>
      </div>

      {/* Fallback chain */}
      <FieldBlock label="Fallback chain (one model per line, top = primary)">
        <textarea
          value={draftChain}
          onChange={(e) => setDraftChain(e.target.value)}
          rows={Math.max(3, chainEntries.length + 1)}
          spellCheck={false}
          className="bg-black/30 border border-rule-2 text-off-white font-mono text-[12.5px] px-3 py-2 rounded-sm outline-none focus:border-[rgba(242,239,233,0.4)] w-full resize-y"
          placeholder={`gemini-2.5-pro\ngemini-2.5-flash\ngemini-2.5-flash-lite`}
        />
        <div className="font-mono text-[9px] text-warm-muted mt-1.5">
          {chainEntries.length} entr{chainEntries.length === 1 ? "y" : "ies"} ·
          generateStructured walks this top-to-bottom on transient errors;
          streamOrcReply probes each in turn before streaming.
        </div>
      </FieldBlock>

      <div className="flex items-center gap-3 pt-2 border-t border-deep-divider">
        {error && (
          <div className="font-mono text-[10.5px] text-[#d4908a] flex-1">
            {error}
          </div>
        )}
        {success && !error && (
          <div className="font-mono text-[10.5px] text-warm-bright flex-1">
            {success}
          </div>
        )}
        {!error && !success && (
          <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-warm-muted flex-1">
            {dirty ? "Unsaved changes" : "—"}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setDraftModel(config.model);
            setDraftTemp(config.temperature);
            setDraftChain(config.modelFallbackChain.join("\n"));
            setError(null);
            setSuccess(null);
            setProbe(null);
          }}
          disabled={pending || !dirty}
          className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border border-rule-2 text-warm-bright hover:text-off-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warm-bright disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Revert
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !dirty}
          className="font-mono text-[10.5px] tracking-[0.18em] uppercase px-4 py-2 rounded-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warm-bright disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: "rgba(242,239,233,0.4)",
            background: "rgba(242,239,233,0.06)",
            color: "var(--color-off-white)",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function ProbeResult({
  result,
}: {
  result: {
    ok: boolean;
    durationMs: number;
    error?: string;
    provider?: string;
  };
}) {
  return (
    <div className="font-mono text-[10px] flex items-center gap-2">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{
          background: result.ok ? "rgba(108,200,132,0.85)" : "#d4908a",
        }}
      />
      {result.ok ? (
        <span className="text-warm-bright">
          OK · {result.durationMs}ms
          {result.provider ? ` · ${result.provider}` : ""}
        </span>
      ) : (
        <span className="text-[#d4908a]">
          FAIL · {result.error?.slice(0, 100) ?? "unknown error"}
        </span>
      )}
    </div>
  );
}

// ─── Bulk apply card ──────────────────────────────────────────────

function BulkApplyCard({ catalog }: { catalog: CatalogModel[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [model, setModel] = useState("");
  const [rewriteFallbacks, setRewriteFallbacks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleApply() {
    setError(null);
    setSuccess(null);
    if (!model.trim()) {
      setError("Pick or type a model id first.");
      return;
    }
    if (
      !window.confirm(
        `Apply "${model.trim()}" as the primary model on every agent (ORC + 6 stages)? This is a one-click swap of the whole pipeline. You can revert per-agent below.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const r = await bulkApplyModel({
          model: model.trim(),
          rewriteFallbackChain: rewriteFallbacks,
        });
        setSuccess(`Applied to ${r.updated.length} agents.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bulk apply failed.");
      }
    });
  }

  return (
    <section className="bg-ink-warm border-2 border-rule-2 rounded-md p-5 flex flex-col gap-4">
      <div>
        <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted mb-1">
          Bulk apply
        </div>
        <h2 className="font-display text-base font-semibold tracking-tight text-off-white">
          Set the same model across every agent
        </h2>
        <p className="font-mono text-[11px] text-warm-bright leading-relaxed mt-2 max-w-3xl">
          Use this when testing a new model end-to-end (e.g. switching the
          whole pipeline to{" "}
          <span className="text-off-white">openrouter/moonshotai/kimi-k2</span>
          to compare cost + quality). Per-agent overrides below stay editable
          after.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
        <FieldBlock label="Model id">
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="bulk-catalog"
            spellCheck={false}
            autoComplete="off"
            className="bg-black/30 border border-rule-2 text-off-white font-mono text-[12.5px] px-3 py-2 rounded-sm outline-none focus:border-[rgba(242,239,233,0.4)] w-full"
            placeholder="e.g. gemini-2.5-flash-lite · openrouter/moonshotai/kimi-k2"
          />
          <datalist id="bulk-catalog">
            {catalog.map((m) => (
              <option
                key={m.id}
                value={m.id}
                label={`${m.displayName} — ${m.hint ?? ""}`}
              />
            ))}
          </datalist>
        </FieldBlock>

        <button
          type="button"
          onClick={handleApply}
          disabled={pending || !model.trim()}
          className="font-mono text-[10.5px] tracking-[0.18em] uppercase px-5 py-2.5 rounded-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warm-bright disabled:opacity-40 disabled:cursor-not-allowed self-end"
          style={{
            borderColor: "rgba(242,239,233,0.4)",
            background: "rgba(242,239,233,0.10)",
            color: "var(--color-off-white)",
          }}
        >
          {pending ? "Applying…" : "Apply to all"}
        </button>
      </div>

      <label className="flex items-center gap-2.5 font-mono text-[11px] text-warm-bright cursor-pointer select-none">
        <input
          type="checkbox"
          checked={rewriteFallbacks}
          onChange={(e) => setRewriteFallbacks(e.target.checked)}
          className="accent-current"
        />
        <span>
          Also rewrite each fallback chain to put this model first (preserves
          existing chain as the safety net)
        </span>
      </label>

      {(error || success) && (
        <div
          className={`font-mono text-[10.5px] ${
            error ? "text-[#d4908a]" : "text-warm-bright"
          }`}
        >
          {error ?? success}
        </div>
      )}
    </section>
  );
}

// ─── Provider keys reminder ───────────────────────────────────────

function ProviderKeysCard({ providers }: { providers: ProviderInfo[] }) {
  return (
    <section className="bg-ink border border-deep-divider rounded-md p-5">
      <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted mb-3">
        Provider keys (set in .env.local)
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {providers.map((p) => (
          <li
            key={p.id}
            className="flex items-baseline justify-between gap-3 font-mono text-[11px]"
          >
            <span className="text-off-white">{p.displayName}</span>
            <span className="text-warm-muted">{p.envVar}</span>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[10px] text-warm-muted mt-4 leading-relaxed">
        OpenAI-compatible providers (OpenRouter, Moonshot, Groq, Together,
        Fireworks) only need their own key — a single OpenRouter key gives
        you OpenAI / Anthropic / Google / Mistral / Kimi / DeepSeek through
        one endpoint, useful for cheap experimentation.
      </p>
    </section>
  );
}

// ─── Reusable label/value field block ─────────────────────────────

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <label className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
