"use client";

import type { RendererProps } from "./registry";

/**
 * BUNKER Retrospective renderer — Phase 7.
 *
 * Read-only view of what BUNKER did for a signal: the source it pulled
 * from, the structured extraction it produced, and the approval /
 * advance timeline. Always a retrospective — by the time a signal is in
 * the workspace, it has already passed the BUNKER approval gate (which
 * lives on Bridge as the approve/dismiss buttons on the triage queue).
 *
 * For edge cases where a signal is back in BUNKER (status = BUNKER_FAILED
 * or EXTRACTION_FAILED), the renderer still works — the failure state is
 * reflected in the signal row's status, surfaced by the page-level state
 * chip, not duplicated inside this renderer.
 *
 * Three sections map to the three questions a reader is asking:
 *   1. SOURCE · "Where did this come from?"
 *   2. EXTRACTION · "What did BUNKER produce?"
 *   3. REVIEW · "What happened next?"
 */

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct input · manual submission",
  reddit: "Reddit · public JSON",
  rss: "RSS · feed ingestion",
  trends: "Google Trends · daily RSS",
  newsapi: "NewsAPI · news headlines",
  upload: "Upload · file ingest",
  llm_synthesis: "LLM Synthesis · Gemini Flash",
  grounded_search: "Grounded Search · Gemini web search",
};

export function BunkerRetrospective({ signal, state }: RendererProps) {
  const metadata = (signal.rawMetadata ?? {}) as Record<string, unknown>;
  const sourceContext =
    typeof metadata.source_context === "string"
      ? metadata.source_context
      : null;
  const sourceUrl =
    typeof metadata.url === "string" ? metadata.url : null;

  const stateLabel =
    state === "completed"
      ? `Completed · ${formatAge(signal.updatedAt)}`
      : state === "active"
        ? "Active"
        : "Not yet reached";

  return (
    <div>
      {/* Header — stage name + state chip (state chip carries the tense:
          Completed, Active, Not yet reached — no redundant "retrospective"
          subtitle needed). */}
      <div className="flex items-baseline justify-between pb-[18px] border-b border-rule-2 mb-8">
        <span className="font-display font-semibold text-[14px] tracking-[0.22em] uppercase text-t1">
          BUNKER
        </span>
        <span
          className={`font-mono text-[10px] tracking-[0.22em] uppercase ${
            state === "completed"
              ? "text-t3"
              : state === "active"
                ? "text-t2"
                : "text-t4"
          }`}
        >
          {stateLabel}
        </span>
      </div>

      {/* Source section — what BUNKER ingested */}
      <section className="mb-9">
        <SectionLabel>Source · What BUNKER ingested</SectionLabel>
        <div className="p-[18px_22px] bg-wash-1 border border-rule-1 rounded-sm">
          <SrcRow
            k="Channel"
            v={SOURCE_LABELS[signal.source] ?? signal.source}
            mono
          />
          {sourceUrl && (
            <SrcRow
              k="URL"
              v={
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 decoration-t3/40 hover:decoration-t1 text-t2"
                >
                  {sourceUrl}
                </a>
              }
            />
          )}
          {signal.rawText && (
            <SrcRow
              k="Raw excerpt"
              v={
                <span className="font-editorial italic text-[14px] leading-[1.55] text-t3">
                  &ldquo;{truncate(signal.rawText, 500)}&rdquo;
                </span>
              }
            />
          )}
        </div>
      </section>

      {/* Extraction section — what BUNKER produced */}
      <section className="mb-9">
        <SectionLabel>Extraction · What BUNKER produced</SectionLabel>
        <div className="grid grid-cols-2 gap-[2px] bg-rule-1 border border-rule-1 rounded-sm overflow-hidden">
          <ExtCell k="Shortcode">
            <span className="font-mono text-[13px] tracking-[0.06em] text-t1">
              {signal.shortcode}
            </span>
          </ExtCell>
          <ExtCell k="Working Title">
            <span className="font-display font-semibold text-[18px] -tracking-[0.002em] text-t1">
              {signal.workingTitle}
            </span>
          </ExtCell>
          <ExtCell k="Concept" full>
            <span className="font-editorial italic text-[15.5px] leading-[1.5] text-t2">
              {signal.concept ?? "—"}
            </span>
          </ExtCell>
          {sourceContext && (
            <ExtCell k="Source Context" full>
              <span className="font-editorial italic text-[15.5px] leading-[1.5] text-t2">
                {sourceContext}
              </span>
            </ExtCell>
          )}
        </div>

        {/* Advances caption — explicit about WHAT hands off to the next
            stage. Answers the "is it concept or whole record?" question
            inline, without making the user dig into architecture docs. */}
        <div className="mt-[14px] p-[12px_16px] bg-[rgba(var(--d),0.04)] border-l-2 border-[rgba(var(--d),0.45)] rounded-sm font-mono text-[10.5px] tracking-[0.16em] uppercase text-t3 flex items-center gap-[10px]">
          <span className="text-[rgba(var(--d),0.9)] text-[13px]">→</span>
          The whole dossier — shortcode, title, concept, source context,
          source metadata — advances as the signal record to{" "}
          <span className="text-t1 font-medium">STOKER</span>.
        </div>
      </section>

      {/* Review section — timeline of what we actually know about this
          signal. Kept deliberately short; anything we don't have a real
          source for is left out. Two gaps flagged here that we may wire
          later:
          - Candidate extraction time + cost/model/tokens: BUNKER bypasses
            agent_logs pre-signal (FK constraint), so this data isn't
            recoverable for existing signals. Tech debt in REVIEWS.md.
          - Explicit "approved by X at T" record: `approveCandidate`
            doesn't write to decision_history yet. Adding that write in a
            later pass gives us real audit trail; until then we use
            signal.createdAt as a proxy. */}
      <section className="mb-9">
        <SectionLabel>Review · What we know</SectionLabel>
        <div className="flex flex-col px-[22px] py-[14px] bg-wash-1 border border-rule-1 rounded-sm">
          <TimelineEvent
            you
            what={
              <>
                Candidate approved · signal created at{" "}
                <b className="text-t1 font-medium">
                  {stageFromStatus(signal.status)}
                </b>
              </>
            }
            when={formatAge(signal.createdAt)}
          />
          {/* Only render the "last update" event when updatedAt materially
              differs from createdAt (>5 min) — otherwise it's just the
              same moment as the approval and we'd show two identical-age
              events. */}
          {new Date(signal.updatedAt).getTime() -
            new Date(signal.createdAt).getTime() >
            5 * 60 * 1000 && (
            <TimelineEvent
              what={<>Last updated</>}
              when={formatAge(signal.updatedAt)}
            />
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Small presentational helpers ───────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[9.5px] tracking-[0.28em] uppercase text-t5 mb-[14px] flex items-center gap-[14px] after:content-[''] after:flex-1 after:border-t after:border-rule-1">
      {children}
    </h3>
  );
}

function SrcRow({
  k,
  v,
  mono,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-[14px] py-[10px] text-[12px] border-b border-rule-1 last:border-b-0">
      <span className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-t5 pt-[2px]">
        {k}
      </span>
      <span
        className={`text-t2 leading-[1.5] ${mono ? "font-mono text-[12px]" : ""}`}
      >
        {v}
      </span>
    </div>
  );
}

function ExtCell({
  k,
  children,
  full,
}: {
  k: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div
      className={`p-[18px_22px] bg-ink-warm ${full ? "col-span-2" : ""}`}
    >
      <div className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-t5 mb-[8px]">
        {k}
      </div>
      <div className="text-t1 text-[14px] leading-[1.45]">{children}</div>
    </div>
  );
}

function TimelineEvent({
  what,
  when,
  you,
}: {
  what: React.ReactNode;
  when: string;
  you?: boolean;
}) {
  return (
    <div className="grid grid-cols-[18px_1fr_auto] gap-[14px] items-baseline py-[14px] border-b border-rule-1 last:border-b-0">
      <span
        className={`w-[6px] h-[6px] rounded-full justify-self-center mt-[6px] ${
          you ? "bg-[rgba(var(--d),0.9)]" : "bg-t3"
        }`}
      />
      <span className="text-t2 text-[12.5px] leading-[1.45]">{what}</span>
      <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-t5 whitespace-nowrap">
        {when}
      </span>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function formatAge(date: Date): string {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function stageFromStatus(status: string): string {
  switch (status) {
    case "IN_BUNKER":
      return "BUNKER";
    case "IN_STOKER":
      return "STOKER";
    case "IN_FURNACE":
      return "FURNACE";
    case "IN_BOILER":
      return "BOILER";
    case "IN_ENGINE":
      return "ENGINE";
    case "AT_PROPELLER":
      return "PROPELLER";
    case "DOCKED":
      return "DOCKED";
    case "COLD_BUNKER":
      return "COLD";
    default:
      return status;
  }
}
