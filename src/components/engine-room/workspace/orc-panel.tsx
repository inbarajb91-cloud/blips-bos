"use client";

import type { signals } from "@/db/schema";
import type { AgentKey } from "./types";

/**
 * ORC conversation panel — Phase 7 stub.
 *
 * Phase 7 scope: render the layout + a stub conversation seeded by
 * signal + stage, with an input that doesn't yet persist. Phase 7D
 * wires the real `agent_conversations` table (which already exists
 * since Phase 2) and server actions for read/append.
 *
 * Stub messages are templated from the signal + current stage, so the
 * prototype feel carries through to code. Real ORC voice lands in
 * Phase 8 when the ORC agent skill is built out.
 */
export function OrcPanel({
  signal,
  activeStage,
}: {
  signal: typeof signals.$inferSelect;
  activeStage: AgentKey;
}) {
  const stubMessages = buildStubMessages(signal, activeStage);

  return (
    <div className="flex flex-col">
      {/* Head */}
      <div className="p-[22px_24px_16px] border-b border-rule-1">
        <div className="font-display font-semibold text-[12.5px] tracking-[0.22em] uppercase text-t1 flex items-center gap-[10px] mb-1">
          <span
            className="breathe rounded-full"
            style={{
              width: 6,
              height: 6,
              background: "rgba(var(--d), 0.9)",
            }}
            aria-hidden
          />
          ORC
        </div>
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t5">
          Signal · {signal.shortcode} · {activeStage}
        </div>
      </div>

      {/* Thread — flows with the document. Each message appears inline;
          no internal scroll. Long conversations grow the panel; the
          whole workspace scrolls as one document via engine-room
          layout's overflow container. */}
      <div className="p-[18px_24px] flex flex-col gap-[22px]">
        {stubMessages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-[6px]">
            <div
              className={`font-mono text-[9.5px] tracking-[0.24em] uppercase ${
                msg.who === "orc"
                  ? "text-[rgba(var(--d),0.92)]"
                  : "text-t3"
              }`}
            >
              {msg.who === "orc" ? "ORC" : "You"}
              {msg.when && <span> · {msg.when}</span>}
            </div>
            <div
              className={
                msg.who === "orc"
                  ? "font-editorial text-[15px] leading-[1.55] text-t2"
                  : "font-display font-normal text-[14.5px] -tracking-[0.002em] text-t1"
              }
            >
              {msg.body}
            </div>
          </div>
        ))}
      </div>

      {/* Input row — stub, no persistence yet. Phase 7D wires this. */}
      <div className="p-[16px_24px] border-t border-rule-1 flex items-center gap-3">
        <input
          type="text"
          placeholder="ask, nudge, or steer…"
          aria-label={`Message ORC about signal ${signal.shortcode}`}
          className="flex-1 bg-transparent border border-rule-2 rounded-sm px-[14px] py-[10px] font-display text-[14px] -tracking-[0.002em] text-t1 outline-none focus:border-[rgba(var(--d),0.7)] transition-colors placeholder:text-t5 placeholder:italic placeholder:font-editorial"
          disabled
        />
        <button
          type="button"
          disabled
          className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 hover:text-t1 transition-colors px-1 py-[6px] disabled:opacity-60"
          aria-label="Send message (wiring in Phase 7D)"
        >
          Send <span style={{ color: "rgba(var(--d), 0.9)" }}>→</span>
        </button>
      </div>
    </div>
  );
}

// Stub message builder — gives the ORC panel realistic content per stage
// without needing the real agent_conversations plumbing yet.
function buildStubMessages(
  signal: { shortcode: string; workingTitle: string; source: string; status: string },
  stage: AgentKey,
): Array<{ who: "orc" | "user"; when?: string; body: string }> {
  const sourceDesc = sourceNarrative(signal.source);
  switch (stage) {
    case "BUNKER":
      return [
        {
          who: "orc",
          body: `I pulled this one ${sourceDesc}. The extraction's clean and the concept is readable — the tension lands.`,
        },
      ];
    case "STOKER":
      return [
        {
          who: "orc",
          body: `I pulled this one ${sourceDesc}. The extraction's clean — the tension is real. STOKER's working on the decade resonance now.`,
        },
        {
          who: "orc",
          when: "evaluating",
          body: `STOKER reads the full dossier, figures out which decades this resonates with, and produces a manifestation per matching decade. Your gate is next.`,
        },
      ];
    case "FURNACE":
    case "BOILER":
    case "ENGINE":
    case "PROPELLER":
      return [
        {
          who: "orc",
          body: `Signal ${signal.shortcode} is currently at ${signal.status}. ${stage} hasn't built its renderer yet — coming in a later phase. For now the placeholder explains what this stage will do.`,
        },
      ];
    default:
      return [];
  }
}

function sourceNarrative(source: string): string {
  switch (source) {
    case "direct":
      return "from your direct submission";
    case "reddit":
      return "from Reddit";
    case "rss":
      return "from an RSS feed";
    case "trends":
      return "off a Google Trends run";
    case "llm_synthesis":
      return "from an LLM synthesis pass";
    case "grounded_search":
      return "off a grounded search you queued";
    case "newsapi":
      return "from a news search";
    case "upload":
      return "from an upload";
    default:
      return "from a standing source";
  }
}
