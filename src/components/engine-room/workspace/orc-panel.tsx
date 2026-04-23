"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { signals } from "@/db/schema";
import type { AgentKey } from "./types";
import {
  getOrCreateOrcConversation,
  type Message,
  type StageKey,
} from "@/lib/actions/conversations";
import type { LockStatus } from "@/lib/actions/signal-locks";

/**
 * ORC conversation panel — Phase 7D.
 *
 * Wires the thread to the real `agent_conversations` table. One ORC
 * conversation per signal (scope: `signal_id + agent_name='ORC'`).
 *
 * Flow:
 *   1. On mount, call getOrCreateOrcConversation. If no conversation
 *      exists yet, the server seeds it with a stage-aware ORC opening.
 *   2. Render messages from the server-returned list.
 *   3. On send, call appendUserMessage with optimistic UI — the message
 *      appears in the thread immediately, and the server round-trip
 *      reconciles the authoritative list.
 *
 * Not in 7D scope:
 *   - Auto-reply from ORC (Phase 8's real ORC agent will read the thread
 *     and respond). Until then, user messages persist with no auto ORC
 *     reply; next time user opens the signal, their messages are there.
 *   - Realtime multi-user sync (single-user today; can add the
 *     useRealtimeChannel hook later when DECK ships).
 *
 * The `activeStage` prop is stamped on each outgoing user message so
 * Phase 8 ORC knows which stage the user was on when they wrote it.
 */
export function OrcPanel({
  signal,
  activeStage,
  lockStatus,
}: {
  signal: typeof signals.$inferSelect;
  activeStage: AgentKey;
  /** Lock state from signal_locks. When not held by current user, the
   *  input is disabled so a read-only viewer can't send messages. Null
   *  while the acquire is in flight — treat as still-loading. */
  lockStatus: LockStatus | null;
}) {
  const canSend = lockStatus !== null && lockStatus.heldByMe;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Load conversation on mount + when the signal changes (user navigates
  // to a different signal, the panel reloads with that signal's thread).
  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setLoadError(null);
    getOrCreateOrcConversation(signal.id)
      .then((convo) => {
        if (cancelled) return;
        setConversationId(convo.id);
        setMessages(convo.messages);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.error("Failed to load ORC conversation:", e);
        setLoadError(
          e.message || "Couldn't load the conversation for this signal.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [signal.id]);

  function handleSend() {
    if (!conversationId) return;
    const text = inputValue.trim();
    if (text.length === 0) return;

    setSendError(null);

    // Optimistic: append the user message locally so it renders
    // instantly. The server also persists it (route handler calls
    // appendUserMessage early in the flow) — if the stream errors,
    // the user's message is still saved server-side, so a page
    // reload recovers the state. That's why the client-side rollback
    // on failure (that Phase 7D had) is GONE — we no longer want to
    // roll back, because the server commits before the stream runs.
    const optimisticUser: Message = {
      role: "user",
      content: text,
      ts: new Date().toISOString(),
      stage: activeStage as StageKey,
    };

    // Placeholder ORC "typing" message — starts empty, grows as
    // tokens stream in. The `streaming` flag lives in a client-only
    // intersection type; the stored `Message` schema stays clean.
    // We cast back to the base Message for the array push, and the
    // renderer reads the flag via `msg as Message & { streaming? }`.
    const streamingOrc = {
      role: "orc",
      content: "",
      ts: new Date().toISOString(),
      streaming: true,
    } as Message & { streaming: boolean };

    const prevMessages = messages ?? [];
    const withPlaceholder = [...prevMessages, optimisticUser, streamingOrc];
    setMessages(withPlaceholder);
    setInputValue("");

    // Index of the streaming ORC message — we'll mutate this slot
    // in the messages array as tokens arrive.
    const orcIdx = withPlaceholder.length - 1;

    startTransition(async () => {
      try {
        const response = await fetch("/api/orc/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signalId: signal.id,
            userMessage: text,
            stage: activeStage,
          }),
        });

        if (!response.ok) {
          // Structured error from the route (413, 429, etc.) — body
          // is JSON with a detail field.
          const err = (await response.json().catch(() => null)) as {
            detail?: string;
            error?: string;
          } | null;
          throw new Error(
            err?.detail ?? err?.error ?? `Request failed (${response.status})`,
          );
        }

        if (!response.body) {
          throw new Error("No stream returned from server.");
        }

        await consumeStream(response.body, (chunk) => {
          // For each text-delta chunk, append to the streaming ORC
          // message. We clone the array so React picks up the change.
          setMessages((curr) => {
            if (!curr) return curr;
            const next = curr.slice();
            const cur = next[orcIdx] as Message & { streaming?: boolean };
            if (!cur) return curr;
            next[orcIdx] = {
              ...cur,
              content: cur.content + chunk,
            };
            return next;
          });
        });

        // Stream closed cleanly — mark as no longer streaming
        setMessages((curr) => {
          if (!curr) return curr;
          const next = curr.slice();
          const cur = next[orcIdx] as Message & { streaming?: boolean };
          if (!cur) return curr;
          next[orcIdx] = {
            ...cur,
            streaming: false,
          } as Message & { streaming: boolean };
          return next;
        });
      } catch (e) {
        console.error("ORC reply failed:", e);
        setSendError(
          e instanceof Error ? e.message : "Something went wrong.",
        );
        // Remove the streaming ORC placeholder (keep the user message
        // — it's already persisted server-side).
        setMessages((curr) => {
          if (!curr) return curr;
          // Drop the last message if it's the streaming placeholder.
          const last = curr[curr.length - 1] as Message & {
            streaming?: boolean;
          } | undefined;
          if (last && last.role === "orc" && last.streaming) {
            return curr.slice(0, -1);
          }
          return curr;
        });
      }
    });
  }

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

      {/* Thread */}
      <div className="p-[18px_24px] flex flex-col gap-[22px]">
        {loadError ? (
          <div
            role="alert"
            className="font-mono text-[11px] text-[#d4908a] leading-[1.5]"
          >
            {loadError}
          </div>
        ) : messages === null ? (
          <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-t5">
            Loading conversation…
          </div>
        ) : messages.length === 0 ? (
          <div className="font-editorial italic text-[14px] text-t4">
            No messages yet. Say something to ORC below.
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageRow key={`${msg.ts}-${i}`} msg={msg} />
          ))
        )}
      </div>

      {/* Input row */}
      <div className="p-[16px_24px] border-t border-rule-1 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <OrcInput
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            disabled={conversationId === null || pending || !canSend}
            signalShortcode={signal.shortcode}
            disabledReason={
              // Four distinct states:
              //   canSend=true          → null (input live)
              //   canSend=false, loading → "loading" (lock query in flight)
              //   canSend=false, other user holds   → "other-user"
              //   canSend=false, no lock (released) → "self-released"
              //
              // CodeRabbit flagged: previous ternary conflated the
              // "loading" case into "self-released", which flashed the
              // misleading "unlocked — click Lock above to send" message
              // during the first render while the acquire round-trip
              // was still in flight. Splitting the states keeps the
              // placeholder honest at every instant of the lifecycle.
              //
              // Gating on lockedByAuthId (not lockedByEmail) for the
              // other-user case, mirroring the banner fix — email can
              // be null (users-join miss), but the lock is still real.
              canSend
                ? null
                : lockStatus === null
                  ? "loading"
                  : lockStatus.lockedByAuthId
                    ? "other-user"
                    : "self-released"
            }
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={
              conversationId === null ||
              pending ||
              !canSend ||
              inputValue.trim().length === 0
            }
            className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 hover:text-t1 transition-colors px-1 py-[6px] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message to ORC"
          >
            {pending ? "Sending…" : "Send"}{" "}
            {!pending && (
              <span style={{ color: "rgba(var(--d), 0.9)" }}>→</span>
            )}
          </button>
        </div>
        {sendError && (
          <div
            role="alert"
            className="font-mono text-[10px] tracking-[0.14em] text-[#d4908a] leading-[1.4]"
          >
            {sendError}
          </div>
        )}
        {/* Read-only notice — only when lock is held by someone else.
            Keeps the input visible (for viewing) but makes disability
            explanatory, not just a dead field. Gating on
            lockedByAuthId (not email) so the notice still renders
            when the users join returns null; falls back to "another
            user" for the holder string. */}
        {lockStatus !== null &&
          !lockStatus.heldByMe &&
          lockStatus.lockedByAuthId && (
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t5">
              Read-only while{" "}
              {lockStatus.lockedByEmail
                ? lockStatus.lockedByEmail.split("@")[0]
                : "another user"}{" "}
              is editing
            </div>
          )}
      </div>
    </div>
  );
}

/**
 * Consume a `toUIMessageStreamResponse()` body stream and call
 * `onTextDelta` with each fragment of ORC's reply text.
 *
 * AI SDK v6 streams a Server-Sent Events format — each event line
 * starts with `data: ` followed by a JSON chunk. Chunk types include
 * `text-delta` (the tokens we care about), `tool-call-*`, `data`,
 * `finish`, `error`. For Phase 8H MVP we only extract text deltas;
 * tool calls still fire server-side (chips generated, concerns
 * flagged) but aren't rendered client-side yet — Phase 8.5 can add
 * chip UI when we want to surface them visually.
 *
 * The function resolves when the stream closes cleanly. If an
 * `error` chunk arrives, we throw so the caller's try/catch handles
 * the rollback.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (fragment: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line ("\n\n"). Process
      // each complete event, keep any trailing partial in the
      // buffer for the next read.
      let eventBoundary = buffer.indexOf("\n\n");
      while (eventBoundary !== -1) {
        const eventRaw = buffer.slice(0, eventBoundary);
        buffer = buffer.slice(eventBoundary + 2);
        eventBoundary = buffer.indexOf("\n\n");

        // Each event has `data: <json>` lines. Concatenate them if
        // multi-line, then parse.
        const dataLines: string[] = [];
        for (const line of eventRaw.split("\n")) {
          if (line.startsWith("data: ")) {
            dataLines.push(line.slice(6));
          }
        }
        if (dataLines.length === 0) continue;
        const raw = dataLines.join("\n");
        // The AI SDK sends a plain "[DONE]" line at the end of some
        // streams — ignore it.
        if (raw === "[DONE]") continue;

        let chunk: { type?: string; delta?: string; errorText?: string };
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }

        if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
          onTextDelta(chunk.delta);
        } else if (chunk.type === "error") {
          throw new Error(chunk.errorText ?? "Stream error");
        }
        // Other types (tool-call-*, data, finish, start) — ignored
        // client-side for now. They still execute server-side via
        // the tools' execute functions, with observability in
        // agent_logs.
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function MessageRow({ msg }: { msg: Message & { streaming?: boolean } }) {
  const isStreaming = msg.streaming === true;
  const isEmptyStreaming = isStreaming && msg.content.length === 0;

  return (
    <div className="flex flex-col gap-[6px]">
      <div
        className={`font-mono text-[9.5px] tracking-[0.24em] uppercase ${
          msg.role === "orc" ? "text-[rgba(var(--d),0.92)]" : "text-t3"
        }`}
      >
        {msg.role === "orc" ? "ORC" : "You"}
        {msg.ts && !isStreaming && <span> · {formatTime(msg.ts)}</span>}
        {isStreaming && <span className="text-t5"> · thinking…</span>}
        {msg.stage && msg.role === "user" && (
          <span className="text-t5"> · at {msg.stage}</span>
        )}
      </div>
      <div
        className={
          msg.role === "orc"
            ? "font-editorial text-[15px] leading-[1.55] text-t2"
            : "font-display font-normal text-[14.5px] -tracking-[0.002em] text-t1"
        }
      >
        {/* When an ORC reply is streaming, show an animated breathing
            dot as a caret so the user sees the reply is still coming.
            The dot picks up the parent collection's decade color via
            the existing `breathe` CSS class + rgba(var(--d)). */}
        {isEmptyStreaming ? (
          <span
            className="breathe inline-block rounded-full align-middle"
            style={{
              width: 8,
              height: 8,
              background: "rgba(var(--d), 0.75)",
            }}
            aria-label="ORC is thinking"
          />
        ) : (
          <>
            {msg.content}
            {isStreaming && (
              <span
                className="breathe inline-block ml-[3px] align-middle"
                style={{
                  width: 8,
                  height: 14,
                  background: "rgba(var(--d), 0.6)",
                  verticalAlign: "text-bottom",
                }}
                aria-hidden
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OrcInput({
  value,
  onChange,
  onSend,
  disabled,
  signalShortcode,
  disabledReason,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  signalShortcode: string;
  /** Why is the input disabled? Drives the placeholder message so the
   *  user understands the state:
   *    - "loading": lock status query in flight (first render)
   *    - "other-user": someone else holds the edit lock
   *    - "self-released": user voluntarily released, can re-lock above
   *    - null: input is active */
  disabledReason?: "loading" | "other-user" | "self-released" | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Refocus input after send clears it (useTransition releases pending
  // during an async boundary; refocusing here keeps the chat flow tight).
  useEffect(() => {
    if (value === "" && !disabled) {
      // Don't steal focus on mount — only when the input was just cleared
      // by a successful send. Simple proxy: if the ref is focused already,
      // keep it focused after render.
      const el = inputRef.current;
      if (el && document.activeElement === el) {
        el.focus();
      }
    }
  }, [value, disabled]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSend();
        }
      }}
      placeholder={
        disabledReason === "loading"
          ? "checking lock status…"
          : disabledReason === "other-user"
            ? "read-only — another user is editing"
            : disabledReason === "self-released"
              ? "unlocked — click Lock above to send"
              : "ask, nudge, or steer…"
      }
      aria-label={`Message ORC about signal ${signalShortcode}`}
      disabled={disabled}
      maxLength={2000}
      className="flex-1 bg-transparent border border-rule-2 rounded-sm px-[14px] py-[10px] font-display text-[14px] -tracking-[0.002em] text-t1 outline-none focus:border-[rgba(var(--d),0.7)] transition-colors placeholder:text-t5 placeholder:italic placeholder:font-editorial disabled:opacity-60 disabled:cursor-not-allowed"
    />
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return "just now";
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  const ageDay = Math.floor(ageHr / 24);
  return `${ageDay}d ago`;
}
