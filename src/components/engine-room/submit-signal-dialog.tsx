"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { submitDirectInput } from "@/lib/actions/candidates";

/**
 * Source 01 — direct input modal.
 *
 * User opens from Bridge header "Submit Signal" button, pastes raw text,
 * BUNKER extracts synchronously (2-5s), modal shows the assigned shortcode
 * and closes. New candidate appears in the triage queue via realtime.
 *
 * Enforces 50-character minimum so BUNKER has enough context to extract
 * meaningful shortcode + tension.
 */
export function SubmitSignalDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{
    shortcode: string;
    workingTitle: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && !result) {
      // Defer to let the transition complete before focusing
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [open, result]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) closeDialog();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const closeDialog = () => {
    setOpen(false);
    setText("");
    setResult(null);
    setError(null);
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await submitDirectInput(text);
        setResult({
          shortcode: r.shortcode,
          workingTitle: r.workingTitle,
        });
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const charCount = text.length;
  const canSubmit = !pending && charCount >= 50 && charCount <= 5000;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-3 py-1.5 rounded-sm border border-off-white bg-off-white text-ink font-mono text-[10px] uppercase tracking-[0.18em] hover:bg-warm-bright transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
      >
        Submit Signal
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-signal-title"
          onClick={(e) => {
            // Close on backdrop click (but not when clicking the modal body)
            if (e.target === e.currentTarget && !pending) closeDialog();
          }}
        >
          <div className="bg-ink border border-deep-divider rounded-md w-full max-w-2xl shadow-[0_2px_0_rgba(0,0,0,0.6),0_40px_80px_rgba(0,0,0,0.7)] flex flex-col">
            {result ? (
              <>
                <div className="px-6 py-6 flex flex-col gap-3">
                  <h2
                    id="submit-signal-title"
                    className="font-display text-xl font-semibold"
                  >
                    Signal logged
                  </h2>
                  <p className="font-editorial italic text-warm-bright text-lg">
                    BUNKER extracted{" "}
                    <span className="text-off-white font-mono not-italic text-base tracking-[0.12em]">
                      {result.shortcode}
                    </span>
                    {" — "}
                    {result.workingTitle}.
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-warm-muted">
                    Appears in triage queue.
                  </p>
                </div>
                <div className="px-6 py-4 border-t border-deep-divider flex justify-end">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="px-4 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-[0.18em] bg-off-white text-ink hover:bg-warm-bright transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="px-6 py-5 border-b border-deep-divider">
                  <h2
                    id="submit-signal-title"
                    className="font-display text-lg font-semibold"
                  >
                    Submit Signal
                  </h2>
                  <p className="font-mono text-[11px] text-warm-muted mt-1 leading-relaxed">
                    Paste an observation, article fragment, tweet, quote, or
                    tension you noticed. BUNKER extracts a candidate — you
                    approve or dismiss at triage.
                  </p>
                </div>

                <div className="px-6 py-5 flex flex-col gap-3">
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste raw text. First sentence becomes the title, the rest becomes the body BUNKER reads."
                    disabled={pending}
                    rows={10}
                    className="bg-transparent border border-deep-divider rounded-md px-3 py-2.5 font-mono text-sm text-off-white focus:outline-none focus:border-off-white resize-none disabled:opacity-60 placeholder:text-warm-muted"
                  />

                  {error && (
                    <p className="font-mono text-xs text-off-white/90 border-l-2 border-off-white/50 pl-3 py-1">
                      {error}
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono text-[10px] tracking-[0.15em] uppercase ${
                        charCount < 50
                          ? "text-warm-muted"
                          : charCount > 5000
                            ? "text-off-white"
                            : "text-warm-bright"
                      }`}
                    >
                      {charCount < 50
                        ? `${charCount} / 50 min`
                        : charCount > 5000
                          ? `${charCount} — truncating to 5000`
                          : `${charCount} chars`}
                    </span>
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-deep-divider flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={pending}
                    className="px-3 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-[0.18em] text-warm-muted hover:text-off-white hover:border-warm-muted border border-transparent transition-colors disabled:cursor-wait focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="px-4 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-[0.18em] bg-off-white text-ink hover:bg-warm-bright transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                  >
                    {pending ? (
                      <>
                        <span>Extracting</span>
                        <span className="inline-flex gap-[3px]">
                          <span className="w-1 h-1 rounded-full bg-ink/60 animate-[pulse_1.4s_ease-in-out_infinite]" />
                          <span
                            className="w-1 h-1 rounded-full bg-ink/60 animate-[pulse_1.4s_ease-in-out_infinite]"
                            style={{ animationDelay: "0.2s" }}
                          />
                          <span
                            className="w-1 h-1 rounded-full bg-ink/60 animate-[pulse_1.4s_ease-in-out_infinite]"
                            style={{ animationDelay: "0.4s" }}
                          />
                        </span>
                      </>
                    ) : (
                      "Send to BUNKER"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
