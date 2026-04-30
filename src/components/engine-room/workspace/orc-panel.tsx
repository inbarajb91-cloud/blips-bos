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
 *
 * Phase 9.5: open/closed state lifted up to WorkspaceFrame so the
 * grid layout can swap between rail (36px) and full panel widths.
 * When `isOpen=false`, the panel renders a thin vertical rail with
 * just the breathing presence dot, the rotated "ORC" label, and the
 * expand affordance — the conversation thread, header, and input row
 * are skipped entirely. State (loaded conversation, in-flight stream,
 * input draft) lives on regardless so reopen is instant, but the
 * mount-time conversation load runs whether collapsed or open: by the
 * time the user expands, the thread is ready to render.
 */
export function OrcPanel({
  signal,
  activeStage,
  lockStatus,
  isOpen,
  onToggle,
}: {
  signal: typeof signals.$inferSelect;
  activeStage: AgentKey;
  /** Lock state from signal_locks. When not held by current user, the
   *  input is disabled so a read-only viewer can't send messages. Null
   *  while the acquire is in flight — treat as still-loading. */
  lockStatus: LockStatus | null;
  /** Phase 9.5 — true when the panel is expanded to its full width;
   *  false when it's collapsed to the rail. */
  isOpen: boolean;
  /** Phase 9.5 — toggles isOpen via the rail's expand button or the
   *  collapse chevron in the open header. */
  onToggle: () => void;
}) {
  const canSend = lockStatus !== null && lockStatus.heldByMe;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Chips per streaming ORC message, keyed by a per-call UUID
  // generated client-side (see `orcClientId` in handleSend). Pre-
  // CodeRabbit-pass-3 we keyed by message timestamp, but two
  // `new Date().toISOString()` calls in the same handleSend can
  // produce identical strings within one millisecond — so the
  // optimistic user row and streaming ORC row could share a key
  // and the chip cleanup could remove the wrong mapping. Per-call
  // UUIDs sidestep that entirely.
  //
  // Persisted messages (loaded from agent_conversations on signal
  // mount) don't carry a clientId, so lookups for them fall through
  // to undefined → no chips rendered. That's correct: chips are
  // ephemeral session-only state, persisted messages never had any.
  //
  // Phase 8.5+ can persist chips to agent_logs and reconstruct on
  // conversation load; for now they live only in this React state.
  const [chipsByClientId, setChipsByClientId] = useState<
    Record<string, OrcChip[]>
  >({});
  // AbortController for the in-flight /api/orc/reply request.
  // Pre-CodeRabbit-pass-2, switching signals mid-stream left the
  // previous fetch alive; its consumeStream callbacks would keep
  // calling setMessages/setChipsByClientId and write into the NEW
  // conversation at the old orcIdx. Now we abort on signal change
  // (and on subsequent send), which causes consumeStream to throw
  // AbortError — the catch ignores AbortError so no UI noise.
  const abortRef = useRef<AbortController | null>(null);
  // Latest signal.id stored in a ref so async callbacks (the recovery
  // reload after a pre-stream failure) can compare what the user is
  // currently viewing against what they were viewing when the failure
  // happened. Updated during render — refs are React-safe to write
  // during render as long as the value is derived from props/state.
  // CodeRabbit pass 3.
  const currentSignalIdRef = useRef(signal.id);
  currentSignalIdRef.current = signal.id;

  // Load conversation on mount + when the signal changes (user navigates
  // to a different signal, the panel reloads with that signal's thread).
  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setLoadError(null);
    // Reset conversationId to disable the Send button until the new
    // signal's conversation has loaded — prevents the user (or the
    // optimistic-UI path) from sending into the previous signal's
    // thread while the swap is in flight.
    setConversationId(null);
    // Clear chip state — chips from the previous signal's conversation
    // would otherwise live in memory; they're ephemeral session-state
    // and don't apply across signals.
    setChipsByClientId({});
    // Clear composer state — a draft typed on the previous signal
    // shouldn't follow the user to the next signal (CodeRabbit pass 5).
    // Same for sendError: an error from the previous thread is
    // misleading on a fresh signal.
    setInputValue("");
    setSendError(null);
    // Abort any in-flight /api/orc/reply for the previous signal so
    // its callbacks can't write into the new conversation.
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
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

  /**
   * Send a message to ORC. By default uses the live input value;
   * pass `overrideText` to send arbitrary text (used by the action-
   * chip Approve / Decline buttons in Phase 9G — they fire synthetic
   * "Approved." / "Decline." messages so ORC's mutation gate fires
   * + the correct tool gets called on the next turn). When override
   * is used, the input value is NOT cleared (the user might be mid-
   * draft typing something else).
   */
  function handleSend(overrideText?: string) {
    if (!conversationId) return;
    const text = (overrideText ?? inputValue).trim();
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

    // Per-call client ID for the streaming ORC message — used as the
    // chip key. crypto.randomUUID is collision-safe (vs. ts which
    // can repeat within a millisecond when the optimistic user row
    // and streaming ORC row are minted back-to-back). The renderer
    // reads this off the message via `msg as Message & { clientId? }`
    // and falls back to undefined (no chips) for persisted messages.
    const orcClientId = crypto.randomUUID();

    // Placeholder ORC "typing" message — starts empty, grows as
    // tokens stream in. The `streaming` flag and `clientId` live in
    // a client-only intersection type; the stored `Message` schema
    // stays clean. We cast back to the base Message for the array
    // push, and the renderer reads them via the intersection cast.
    const streamingOrc = {
      role: "orc",
      content: "",
      ts: new Date().toISOString(),
      streaming: true,
      clientId: orcClientId,
    } as Message & { streaming: boolean; clientId: string };

    const prevMessages = messages ?? [];
    const withPlaceholder = [...prevMessages, optimisticUser, streamingOrc];
    setMessages(withPlaceholder);
    // Only clear the typed-input field when the user actually submitted
    // from the input. For synthetic sends (chip Approve / Decline) the
    // input may hold an unrelated draft we shouldn't wipe.
    if (overrideText === undefined) {
      setInputValue("");
    }

    // Index of the streaming ORC message — we'll mutate this slot
    // in the messages array as tokens arrive.
    const orcIdx = withPlaceholder.length - 1;

    // Abort any prior in-flight request before starting this one.
    // Then create a fresh controller for THIS request and store it
    // so the signal-change useEffect (or a subsequent send) can
    // abort it.
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // Track whether the failure happened BEFORE the stream started
    // (response.ok=false) vs AFTER persistence began. Pre-stream
    // failures may or may not have persisted the user message
    // server-side (429 doesn't, 413 does), so on those we re-fetch
    // the conversation to sync UI with server reality. Post-stream
    // failures: the user message IS persisted, so we keep the
    // optimistic row and just drop the streaming placeholder.
    let failedPreStream = false;

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
          signal: ac.signal,
        });

        if (!response.ok) {
          // Structured error from the route (413, 429, etc.) — body
          // is JSON with a detail field.
          failedPreStream = true;
          const err = (await response.json().catch(() => null)) as {
            detail?: string;
            error?: string;
          } | null;
          throw new Error(
            err?.detail ?? err?.error ?? `Request failed (${response.status})`,
          );
        }

        if (!response.body) {
          failedPreStream = true;
          throw new Error("No stream returned from server.");
        }

        await consumeStream(
          response.body,
          (chunk) => {
            // Text-delta: append to the streaming ORC message.
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
          },
          (chip) => {
            // Chip from flag_concern / request_re_run. Attach to the
            // current streaming ORC message by its per-call clientId
            // (collision-safe key) so it renders below the reply text
            // and stays correct even if the array shifts later.
            setChipsByClientId((curr) => ({
              ...curr,
              [orcClientId]: [...(curr[orcClientId] ?? []), chip],
            }));
          },
        );

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
        // AbortError = caller deliberately cancelled (signal change
        // or a fresh send superseded this one). Don't show an error
        // or rollback — the new context is already taking over.
        if (e instanceof Error && e.name === "AbortError") {
          return;
        }
        console.error("ORC reply failed:", e);
        setSendError(
          e instanceof Error ? e.message : "Something went wrong.",
        );
        // Always drop the streaming ORC placeholder.
        setMessages((curr) => {
          if (!curr) return curr;
          const last = curr[curr.length - 1] as Message & {
            streaming?: boolean;
          } | undefined;
          if (last && last.role === "orc" && last.streaming) {
            return curr.slice(0, -1);
          }
          return curr;
        });
        // Drop any chips that were attached to the failed placeholder
        // — its clientId won't be referenced anywhere now, so they'd
        // just leak in memory.
        setChipsByClientId((curr) => {
          if (!(orcClientId in curr)) return curr;
          const { [orcClientId]: _dropped, ...rest } = curr;
          void _dropped;
          return rest;
        });
        // Pre-stream failure: server may or may not have persisted
        // the user message (429 doesn't, 404 doesn't, 413 does, ...).
        // Re-fetch the conversation so UI matches server reality
        // — drops the optimistic user row when the server didn't
        // commit it, keeps it when it did.
        // CodeRabbit pass 3: capture signal.id at failure time and
        // re-check against currentSignalIdRef before applying. If the
        // user switches signals between failure and reload completion,
        // applying the old conversation would clobber the new signal's
        // thread (race window of ~50-200ms in practice).
        if (failedPreStream) {
          const signalIdAtFailure = signal.id;
          getOrCreateOrcConversation(signalIdAtFailure)
            .then((convo) => {
              if (currentSignalIdRef.current !== signalIdAtFailure) {
                // User switched signals; the new signal's mount
                // useEffect will load its own conversation. Drop ours.
                return;
              }
              setMessages(convo.messages);
            })
            .catch((reloadErr: Error) => {
              console.error(
                "Conversation reload after failure failed:",
                reloadErr,
              );
              // Best-effort: keep whatever local state is there. The
              // user can refresh manually if it really matters.
            });
        }
      } finally {
        // Clear the abort ref only if it's still pointing at OUR
        // controller — a concurrent send may have already replaced
        // it with theirs.
        if (abortRef.current === ac) {
          abortRef.current = null;
        }
      }
    });
  }

  // Rail mode (Phase 9.5) — when collapsed, render a thin vertical
  // strip with a breathing presence dot, the rotated "ORC" label, and
  // an expand chevron. The whole rail is one button: click anywhere
  // expands the panel. Conversation state still lives in this
  // component (loaded on mount), so reopen is a layout flip not a
  // remount — the thread renders instantly with whatever was loaded.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Expand ORC conversation panel"
        aria-expanded={false}
        className="w-full self-stretch min-h-[280px] flex flex-col items-center pt-5 pb-5 gap-4 hover:bg-wash-2 focus-visible:outline-none focus-visible:bg-wash-2 transition-colors group"
      >
        <span
          className="breathe rounded-full shrink-0"
          style={{
            width: 6,
            height: 6,
            background: "rgba(var(--d), 0.9)",
          }}
          aria-hidden
        />
        <span
          className="font-display font-semibold text-[11px] tracking-[0.28em] uppercase text-t3 group-hover:text-t1 transition-colors"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          ORC
        </span>
        <span
          aria-hidden
          className="mt-auto text-t4 group-hover:text-t1 text-[14px] transition-colors"
          style={{ lineHeight: 1 }}
        >
          ›
        </span>
      </button>
    );
  }

  return (
    // Phase 9G fix (April 30) — ORC panel chat-app layout: head pins
    // top, input pins bottom, thread scrolls between them. The aside
    // wrapper in WorkspaceFrame caps overall height + provides
    // overflow-hidden, so the thread's own overflow-y-auto handles
    // long conversations without dragging the page. h-full + min-h-0
    // is the standard flex chat-shell pattern: the inner flex-1
    // section can scroll because min-h-0 lets it shrink below its
    // content height (the default min-h: auto would prevent that).
    <div className="flex flex-col h-full min-h-0">
      {/* Head */}
      <div className="p-[22px_24px_16px] border-b border-rule-1 flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
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
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t5 truncate">
            Signal · {signal.shortcode} · {activeStage}
          </div>
        </div>
        {/* Collapse chevron — symmetric with the rail's expand chevron.
            Lives in the head so the user can fold ORC away when they
            want full canvas width without leaving the workspace. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse ORC conversation panel"
          aria-expanded={true}
          className="w-7 h-7 shrink-0 rounded-full border border-rule-2 bg-ink flex items-center justify-center text-t3 text-[11px] hover:text-t1 hover:border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
        >
          <span style={{ lineHeight: 1 }}>‹</span>
        </button>
      </div>

      {/* Thread — flex-1 + overflow-y-auto + min-h-0 so it scrolls
          within the panel's max-height without dragging the page.
          The min-h-0 is critical: without it, flex children default
          to min-h: auto which means the thread can't shrink below
          its content height, defeating the overflow-y. */}
      <div className="flex-1 overflow-y-auto min-h-0 p-[18px_24px] flex flex-col gap-[22px]">
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
          messages.map((msg, i) => {
            // clientId only present on the streaming ORC placeholder
            // (set in handleSend). Persisted messages don't have one,
            // so the lookup falls through to undefined → no chips,
            // which is correct since chips are ephemeral session state.
            const clientId = (msg as Message & { clientId?: string })
              .clientId;
            return (
              <MessageRow
                key={`${msg.ts}-${i}`}
                msg={msg}
                chips={clientId ? chipsByClientId[clientId] : undefined}
                onChipApprove={() => handleSend("Approved.")}
                onChipDecline={() => handleSend("Decline.")}
              />
            );
          })
        )}
      </div>

      {/* Input row */}
      <div className="p-[16px_24px] border-t border-rule-1 flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <OrcInput
            value={inputValue}
            onChange={setInputValue}
            onSend={() => handleSend()}
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
            onClick={() => handleSend()}
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

/** Chip payload — emitted by ORC's flag_concern / request_re_run /
 *  propose_action tools. propose_action chips render with
 *  Approve / Decline / Say-something-else buttons; the others are
 *  informational. */
export interface OrcChip {
  type: "flag_concern" | "request_re_run" | "propose_action";
  reason: string;
  /** Only set for request_re_run chips. */
  stage?: string;
  /** Only set for propose_action chips — short summary above the
   *  buttons. */
  summary?: string;
}

/**
 * Consume a `toUIMessageStreamResponse()` body stream.
 *
 * AI SDK v6 streams a Server-Sent Events format — each event line
 * starts with `data: ` followed by a JSON chunk. Chunk types we care
 * about:
 *   - `text-delta` → append fragment to the streaming reply
 *   - `tool-output-available` → if the tool was flag_concern or
 *     request_re_run, the output is a chip payload to surface in UI
 *   - `error` → throw so caller handles rollback
 *
 * Other types (start, finish, tool-input-*, data-*) flow past. Tool
 * executions still log to agent_logs server-side; we just don't need
 * those events client-side.
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (fragment: string) => void,
  onChip?: (chip: OrcChip) => void,
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

        let chunk: {
          type?: string;
          delta?: string;
          errorText?: string;
          output?: unknown;
        };
        try {
          chunk = JSON.parse(raw);
        } catch {
          continue;
        }

        if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
          onTextDelta(chunk.delta);
        } else if (
          chunk.type === "tool-output-available" &&
          chunk.output &&
          typeof chunk.output === "object"
        ) {
          // Our chip tools return { type: "flag_concern", reason },
          // { type: "request_re_run", stage, reason }, or
          // { type: "propose_action", summary, reason }. Anything else
          // (data tool output, side-effect confirmation) we ignore —
          // text-delta carries the reply copy for those.
          const out = chunk.output as {
            type?: string;
            reason?: string;
            stage?: string;
            summary?: string;
          };
          if (
            (out.type === "flag_concern" ||
              out.type === "request_re_run" ||
              out.type === "propose_action") &&
            typeof out.reason === "string"
          ) {
            onChip?.({
              type: out.type,
              reason: out.reason,
              stage: out.stage,
              summary: out.summary,
            });
          }
        } else if (chunk.type === "error") {
          throw new Error(chunk.errorText ?? "Stream error");
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function MessageRow({
  msg,
  chips,
  onChipApprove,
  onChipDecline,
}: {
  msg: Message & { streaming?: boolean };
  chips?: OrcChip[];
  /** Phase 9G — fires when the user clicks Approve on a propose_action
   *  chip. Threaded down to ChipCard. */
  onChipApprove?: () => void;
  /** Phase 9G — fires when the user clicks Decline on a propose_action
   *  chip. */
  onChipDecline?: () => void;
}) {
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

      {/* Chips — flag_concern / request_re_run / propose_action
          payloads from tool calls. Rendered as decade-tinted cards
          under the reply text. propose_action chips render with
          Approve / Decline / Say-something-else buttons (Phase 9G).
          Ephemeral — chip state clears on reload since it lives in
          component memory, not persisted. */}
      {chips && chips.length > 0 && (
        <div className="mt-[10px] flex flex-col gap-[8px]">
          {chips.map((chip, i) => (
            <ChipCard
              key={i}
              chip={chip}
              onApprove={onChipApprove}
              onDecline={onChipDecline}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChipCard({
  chip,
  onApprove,
  onDecline,
}: {
  chip: OrcChip;
  /** Phase 9G — only fires for propose_action chips. Click sends a
   *  synthetic "Approved." message to ORC; the next ORC turn calls
   *  the side-effect tool it proposed (mutation gate fires on the
   *  word, conversation context disambiguates which tool). */
  onApprove?: () => void;
  /** Phase 9G — only fires for propose_action chips. Click sends a
   *  synthetic "Decline." message; ORC moves on. */
  onDecline?: () => void;
}) {
  // Local "responded" state — once the user clicks any of the three
  // buttons on a propose_action chip, the buttons hide and a small
  // "responded" line takes their place. Prevents accidental double-
  // approves and gives a visual ack that the click landed.
  const [responded, setResponded] = useState(false);

  const isAction = chip.type === "propose_action";
  const label = isAction
    ? "ORC proposes"
    : chip.type === "flag_concern"
      ? "ORC flags"
      : `ORC suggests re-run · ${chip.stage ?? "stage"}`;

  return (
    <div
      className="p-[10px_12px] border rounded-sm"
      style={{
        borderColor: "rgba(var(--d), 0.35)",
        background: "rgba(var(--d), 0.05)",
        borderLeftWidth: 2,
        borderLeftColor: "rgba(var(--d), 0.7)",
      }}
    >
      <div
        className="font-mono text-[9px] tracking-[0.22em] uppercase mb-[4px]"
        style={{ color: "rgba(var(--d), 0.92)" }}
      >
        {label}
      </div>
      {isAction && chip.summary && (
        <div className="font-display font-medium text-[13.5px] leading-[1.4] text-t1 mb-[4px]">
          {chip.summary}
        </div>
      )}
      <div className="font-editorial text-[13px] leading-[1.45] text-t2">
        {chip.reason}
      </div>
      {/* Action buttons — only on propose_action chips, hidden once
          the user has responded. Approve fires the synthetic message
          to ORC; Decline does the same with the opposite intent;
          Say-something-else just dismisses the chip's interactive UI
          so the user can type freely in the input below. */}
      {isAction && !responded && (onApprove || onDecline) && (
        <div className="mt-[10px] flex flex-wrap gap-[6px]">
          {onApprove && (
            <button
              type="button"
              onClick={() => {
                setResponded(true);
                onApprove();
              }}
              className="font-mono text-[9.5px] tracking-[0.22em] uppercase px-[10px] py-[5px] rounded-sm border transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
              style={{
                borderColor: "rgba(var(--d), 0.7)",
                background: "rgba(var(--d), 0.18)",
                color: "rgba(var(--d), 1)",
              }}
            >
              Approve
            </button>
          )}
          {onDecline && (
            <button
              type="button"
              onClick={() => {
                setResponded(true);
                onDecline();
              }}
              className="font-mono text-[9.5px] tracking-[0.22em] uppercase px-[10px] py-[5px] rounded-sm border border-rule-2 text-t3 transition-colors hover:text-t1 hover:border-rule-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
            >
              Decline
            </button>
          )}
          <button
            type="button"
            onClick={() => setResponded(true)}
            className="font-mono text-[9.5px] tracking-[0.22em] uppercase px-[10px] py-[5px] rounded-sm text-t4 transition-colors hover:text-t2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          >
            Say something else
          </button>
        </div>
      )}
      {isAction && responded && (
        <div className="mt-[8px] font-mono text-[9px] tracking-[0.22em] uppercase text-t5">
          Responded
        </div>
      )}
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
