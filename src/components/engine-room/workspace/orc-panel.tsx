"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { signals } from "@/db/schema";
import type { AgentKey } from "./types";
import {
  getOrCreateOrcConversation,
  appendUserMessage,
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
    // Optimistic append — message appears instantly; server call
    // reconciles when it returns. If the server throws, we roll back
    // the optimistic append so the user sees the right state.
    const optimistic: Message = {
      role: "user",
      content: text,
      ts: new Date().toISOString(),
      stage: activeStage as StageKey,
    };
    const prevMessages = messages ?? [];
    setMessages([...prevMessages, optimistic]);
    setInputValue("");

    startTransition(async () => {
      try {
        const updated = await appendUserMessage(
          conversationId,
          text,
          activeStage as StageKey,
        );
        setMessages(updated);
      } catch (e) {
        console.error("Failed to send ORC message:", e);
        setSendError(
          e instanceof Error ? e.message : "Couldn't send your message.",
        );
        // Roll back the optimistic append
        setMessages(prevMessages);
        // Restore the input so the user can retry without re-typing
        setInputValue(text);
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

function MessageRow({ msg }: { msg: Message }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <div
        className={`font-mono text-[9.5px] tracking-[0.24em] uppercase ${
          msg.role === "orc" ? "text-[rgba(var(--d),0.92)]" : "text-t3"
        }`}
      >
        {msg.role === "orc" ? "ORC" : "You"}
        {msg.ts && <span> · {formatTime(msg.ts)}</span>}
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
        {msg.content}
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
