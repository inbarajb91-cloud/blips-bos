"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  createCollection,
  type CollectionType,
  type Cadence,
  type SearchMode,
  type DecadeHint,
} from "@/lib/actions/collections";

/**
 * Collect-now dialog — Phase 6.5.
 *
 * Replaces the old "Collect now" + "Submit signal" dual buttons with a
 * single collection-creation flow. Founder picks: name, outline (optional),
 * type, count (constrained by type), cadence (only if Scheduled).
 *
 * Instant    → count locked at 5, fires immediately, ~1 min
 * Batch      → count 6-100, fires immediately, 3-10 min
 * Scheduled  → count 1-100, adds cadence picker, cron-check picks it up
 */

const TYPE_DEFAULTS: Record<CollectionType, number> = {
  instant: 5,
  batch: 20,
  scheduled: 20,
};

const TYPE_HINTS: Record<CollectionType, string> = {
  instant:
    "small, quick, one-off — exactly 5 signals. about 1 minute.",
  batch:
    "bulk, one-shot — up to 100 signals. 3–10 minutes depending on count.",
  scheduled:
    "recurring — BUNKER refreshes this collection on the cadence below. candidates accumulate over time.",
};

export function CollectNowDialog() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CollectionType>("instant");
  const [count, setCount] = useState(5);
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [name, setName] = useState("");
  const [outline, setOutline] = useState("");
  // Phase 6.6 — trend (default) vs reference (outline-as-query via grounded search)
  const [searchMode, setSearchMode] = useState<SearchMode>("trend");
  const [decadeHint, setDecadeHint] = useState<DecadeHint>("any");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Autofocus name field
      setTimeout(() => firstRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pickType(t: CollectionType) {
    setType(t);
    setCount(TYPE_DEFAULTS[t]);
  }

  function reset() {
    setType("instant");
    setCount(5);
    setCadence("weekly");
    setName("");
    setOutline("");
    setSearchMode("trend");
    setDecadeHint("any");
    setError(null);
  }

  function handleStart() {
    setError(null);
    startTransition(async () => {
      try {
        await createCollection({
          name,
          outline: outline.trim() || undefined,
          type,
          targetCount: count,
          cadence: type === "scheduled" ? cadence : undefined,
          searchMode,
          decadeHint,
        });
        setOpen(false);
        reset();
      } catch (e) {
        setError((e as Error).message || "Something went wrong.");
      }
    });
  }

  // Preview time estimate
  const timeHint =
    type === "instant"
      ? "~1 min"
      : type === "batch"
        ? count < 25
          ? "~3 min"
          : count < 60
            ? "~5 min"
            : "8–10 min"
        : `per run · ~${Math.max(1, Math.round(count / 8))} min`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-mono text-[10.5px] tracking-[0.22em] uppercase px-4 py-2.5 rounded-sm border border-off-white text-off-white hover:bg-off-white/8 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        Collect now
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="collect-title"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/80 backdrop-blur-[4px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className={`w-[580px] max-w-[calc(100%-48px)] bg-ink border border-rule-2 rounded-md overflow-hidden shadow-2xl t-${type}`}
            style={{
              background:
                "linear-gradient(to bottom, rgba(var(--d), 0.03), var(--color-ink) 120px)",
              borderTop: "2px solid rgba(var(--d), 0.6)",
            }}
          >
            <div className="px-6 py-5 border-b border-rule-1 flex items-center justify-between">
              <div id="collect-title" className="font-display font-semibold text-[14px] tracking-wide">
                New collection
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 hover:text-t1 transition-colors"
              >
                Close · esc
              </button>
            </div>

            <div className="px-6 py-6 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
              <div className="flex flex-col gap-2">
                <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
                  Name
                </div>
                <input
                  ref={firstRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Financial anxiety · Chennai · 38–48"
                  className="bg-transparent text-t1 border-0 border-b border-rule-2 py-2.5 font-display font-medium text-[16px] -tracking-[0.005em] outline-none w-full focus:border-b-t1 transition-colors placeholder:text-t5"
                  maxLength={120}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
                    {searchMode === "reference"
                      ? "Search query (required)"
                      : "Outline (optional)"}
                  </div>
                  {/* The whole label is the clickable switch — moving role
                      + handlers up from the inner span fixes two things:
                      (a) `cursor-pointer` on the label actually does
                      something, so the "use as query" text toggles too,
                      and (b) screen readers announce a single labelled
                      control ("use as query, switch, on/off") instead of
                      an unnamed switch adjacent to unrelated text. The
                      inner spans stay purely presentational. */}
                  <label
                    role="switch"
                    aria-checked={searchMode === "reference"}
                    tabIndex={0}
                    onClick={() =>
                      setSearchMode(
                        searchMode === "reference" ? "trend" : "reference",
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSearchMode(
                          searchMode === "reference" ? "trend" : "reference",
                        );
                      }
                    }}
                    className="flex items-center gap-2 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 rounded-sm"
                  >
                    <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4">
                      use as query
                    </span>
                    <span
                      aria-hidden
                      className={`relative inline-block w-[34px] h-[18px] rounded-full border transition-all ${
                        searchMode === "reference"
                          ? "border-t1 bg-[rgba(var(--d),0.15)]"
                          : "border-rule-2"
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] w-[12px] h-[12px] rounded-full transition-all ${
                          searchMode === "reference"
                            ? "left-[18px] bg-t1"
                            : "left-[2px] bg-t4"
                        }`}
                      />
                    </span>
                  </label>
                </div>
                <textarea
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  placeholder={
                    searchMode === "reference"
                      ? "the theme you want BUNKER to search for — e.g. 'food anarchism in Indian metros'"
                      : "what are you looking for? one-liner for your own reference."
                  }
                  rows={3}
                  className={`bg-transparent text-t1 border rounded-sm px-3.5 py-3 font-editorial italic text-[14px] leading-[1.5] resize-y min-h-[72px] outline-none w-full focus:border-t2 transition-colors placeholder:text-t5 ${
                    searchMode === "reference" &&
                    outline.trim().length > 0 &&
                    outline.trim().length < 10
                      ? "border-[#d4908a]/60"
                      : "border-rule-2"
                  }`}
                  maxLength={500}
                  // Reference mode treats outline as the actual search query,
                  // so the server enforces ≥10 chars. Mirror it in the form
                  // so the Start button + textarea both signal the rule
                  // before submit — otherwise the user hits a server error
                  // for an easily preventable mistake.
                  required={searchMode === "reference"}
                  aria-required={searchMode === "reference"}
                  minLength={searchMode === "reference" ? 10 : undefined}
                  aria-invalid={
                    searchMode === "reference" &&
                    outline.trim().length > 0 &&
                    outline.trim().length < 10
                  }
                />
                <div className="font-editorial italic text-[12.5px] text-t5 leading-[1.5]">
                  {searchMode === "reference"
                    ? outline.trim().length > 0 && outline.trim().length < 10
                      ? `reference mode — needs at least 10 characters to become a search query. currently ${outline.trim().length}.`
                      : "reference mode — outline becomes the actual web search query via Gemini grounded search. ~$0.03–0.05 per run."
                    : "trend mode — BUNKER pulls from standing 5 sources (Reddit, RSS, Trends, LLM synthesis, direct). outline is a label only."}
                </div>
              </div>

              {/* Phase 6.6 — optional decade picker. Sourcing bias only. */}
              <div className="flex flex-col gap-2.5">
                <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
                  Primary audience (optional)
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {(
                    [
                      { key: "any", label: "Any" },
                      { key: "RCK", label: "RCK · 28-38" },
                      { key: "RCL", label: "RCL · 38-48" },
                      { key: "RCD", label: "RCD · 48-58" },
                    ] as const
                  ).map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => setDecadeHint(d.key)}
                      aria-pressed={decadeHint === d.key}
                      className={`font-mono text-[10px] tracking-[0.22em] uppercase px-3.5 py-2 rounded-sm border transition-all ${
                        decadeHint === d.key
                          ? "text-t1 border-t1"
                          : "text-t3 border-rule-2 hover:text-t1 hover:border-t2"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="font-editorial italic text-[12.5px] text-t5 leading-[1.5]">
                  {decadeHint === "any"
                    ? "span all three decades. BUNKER finds tensions that resonate across."
                    : `bias sourcing toward ${decadeHint}. STOKER will still fan out to matching decades downstream — this doesn't replace that.`}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
                  Type
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {(["instant", "batch", "scheduled"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => pickType(t)}
                      aria-pressed={type === t}
                      className={`font-mono text-[10px] tracking-[0.22em] uppercase px-3.5 py-2 rounded-sm border transition-all ${
                        type === t
                          ? "text-t1"
                          : "text-t3 border-rule-2 hover:text-t1 hover:border-t2"
                      }`}
                      style={
                        type === t
                          ? {
                              borderColor: "rgba(var(--d), 0.85)",
                              background: "rgba(var(--d), 0.08)",
                            }
                          : undefined
                      }
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="font-editorial italic text-[13px] text-t4">
                  {TYPE_HINTS[type]}
                </div>
              </div>

              <div className="flex flex-col gap-2.5">
                <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
                  Signals per run
                </div>
                <div className="flex items-center gap-5">
                  <input
                    type="range"
                    min={type === "instant" ? 5 : type === "batch" ? 6 : 1}
                    max={type === "instant" ? 5 : 100}
                    value={count}
                    onChange={(e) => setCount(parseInt(e.target.value))}
                    disabled={type === "instant"}
                    className="flex-1 h-0.5 bg-rule-2 rounded-[1px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-off-white [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-off-white [&::-moz-range-thumb]:border-0"
                  />
                  <div className="font-display font-medium text-[17px] text-t1 min-w-[44px] text-right -tracking-[0.01em]">
                    {count}
                  </div>
                  <div className="font-mono text-[9.5px] tracking-[0.24em] uppercase text-t5 min-w-[68px]">
                    {type === "instant"
                      ? "fixed"
                      : type === "batch"
                        ? "max 100"
                        : "per run"}
                  </div>
                </div>
              </div>

              {type === "scheduled" && (
                <div className="flex flex-col gap-2.5">
                  <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t5">
                    Cadence
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {(["daily", "weekly", "monthly"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCadence(c)}
                        aria-pressed={cadence === c}
                        className={`font-mono text-[10px] tracking-[0.22em] uppercase px-3.5 py-2 rounded-sm border transition-all ${
                          cadence === c
                            ? "text-t1"
                            : "text-t3 border-rule-2 hover:text-t1 hover:border-t2"
                        }`}
                        style={
                          cadence === c
                            ? {
                                borderColor: "rgba(var(--d), 0.85)",
                                background: "rgba(var(--d), 0.08)",
                              }
                            : undefined
                        }
                      >
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="font-editorial italic text-[13px] text-t4">
                    candidates accumulate inside this same collection on every
                    refresh.
                  </div>
                </div>
              )}

              {error && (
                <div className="font-mono text-[11px] text-[#d4908a] border border-[#d4908a]/30 bg-[#a04040]/10 rounded-sm px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div
              className="px-6 py-4 border-t border-rule-1 flex items-center justify-between"
              style={{
                background:
                  "linear-gradient(to bottom, var(--color-wash-1), rgba(var(--d), 0.03))",
              }}
            >
              <div className="font-editorial italic text-[13.5px] text-t3">
                <b className="text-t1 font-display not-italic font-semibold">
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </b>{" "}
                · <b className="text-t1 font-display not-italic font-semibold">{count}</b> signals ·{" "}
                <b className="text-t1 font-display not-italic font-semibold">{timeHint}</b>
              </div>
              <button
                type="button"
                onClick={handleStart}
                // Reference mode requires a meaningful outline (≥10 chars)
                // as the actual search query — gate submit client-side so
                // users don't hit a server validation throw for something
                // the form itself knows is invalid.
                disabled={
                  pending ||
                  !name.trim() ||
                  (searchMode === "reference" && outline.trim().length < 10)
                }
                className="font-mono text-[10.5px] tracking-[0.22em] uppercase px-4 py-2.5 rounded-sm border text-t1 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white"
                style={{
                  borderColor: "rgba(var(--d), 0.75)",
                }}
              >
                {pending ? "Starting…" : "Start"}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
