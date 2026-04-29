"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RendererProps } from "./registry";
import type { ParentReference, ManifestationOwnDetail } from "./types";
import type { signals } from "@/db/schema";
import {
  approveStokerManifestation,
  dismissStokerManifestation,
  editStokerManifestation,
  type ManifestationEditFields,
} from "@/lib/actions/stoker";

/**
 * STOKER Resonance Renderer — Phase 9D.
 *
 * Renders the parent signal's STOKER tab as a 3-card grid (RCK / RCL /
 * RCD), each card showing:
 *   - Decade label + age range
 *   - Resonance score (0-100, visual weight derived: strong / partial /
 *     weak)
 *   - Framing hook (the editorial one-liner)
 *   - Tension axis + narrative angle
 *   - Per-card actions: Approve / Edit / Dismiss
 *
 * Plus, when STOKER refused (no decade scored >= 50): a refusal banner
 * with per-decade rationales and a "Force-add" affordance (Phase 9G —
 * routes through ORC's add_manifestation tool, scaffolded as disabled
 * here for now).
 *
 * Design notes (locked in v1/v2 prototype + STOKER.md):
 *   - All three decades always shown (even refused/weak ones), so the
 *     founder can audit STOKER's reasoning and override low scores.
 *   - Decade tint via `t-rck` / `t-rcl` / `t-rcd` Ink classes — sets
 *     `--d` so the card's borders / accents pick up the cohort color.
 *   - Per-card status (PENDING / APPROVED / REJECTED) decorates the
 *     card so the founder sees what they've already acted on across
 *     reloads.
 */

// ─── Type contract for the data the page fetches ─────────────────

export interface ParentStokerData {
  parentOutput: {
    id: string;
    content: Record<string, unknown>;
    status: string;
  };
  children: Array<{
    id: string;
    shortcode: string;
    status: string;
    decade: "RCK" | "RCL" | "RCD";
    /** STOKER agent_outputs.status on the child — PENDING / APPROVED /
     *  REJECTED. Null when no output row exists yet (shouldn't happen
     *  in normal flow). */
    outputStatus: string | null;
    outputContent: Record<string, unknown> | null;
  }>;
}

// ─── Shared button styles for the saturated-decade-background context ─

/**
 * Cream-on-decade button styles. The strong-band card surface is a
 * saturated decade color (rgba(var(--d), 0.92)); buttons rendered on
 * top need to NOT use decade-color borders/text or they'd vanish.
 * These three tiers (primary/secondary/tertiary) are used by both
 * CardActions and EditForm so the visual language stays consistent.
 *
 * The RGB triplet matches --cream in globals.css (242, 239, 233).
 * Inline styles rather than CSS-variable references to keep the
 * components portable (no globals.css dependency for testing /
 * Storybook isolation later).
 *
 * CR pass on PR #9 (cc99e80) extracted from inline duplication in
 * CardActions and EditForm.
 */
const CREAM_BUTTON_STYLES = {
  primary: {
    border: "1px solid rgba(242,239,233,0.85)",
    color: "rgb(242,239,233)",
    background: "rgba(242,239,233,0.08)",
  },
  secondary: {
    border: "1px solid rgba(242,239,233,0.4)",
    color: "rgba(242,239,233,0.85)",
  },
  tertiary: {
    border: "1px solid rgba(242,239,233,0.25)",
    color: "rgba(242,239,233,0.65)",
  },
} as const;

// ─── Decade order for stable card ordering ───────────────────────

const DECADE_ORDER: Array<"RCK" | "RCL" | "RCD"> = ["RCK", "RCL", "RCD"];
const DECADE_AGES: Record<string, string> = {
  RCK: "28-38",
  RCL: "38-48",
  RCD: "48-58",
};
const DECADE_TINTS: Record<string, string> = {
  RCK: "t-rck",
  RCL: "t-rcl",
  RCD: "t-rcd",
};

// ─── Resonance band helpers ──────────────────────────────────────

function bandFor(score: number): "strong" | "partial" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 50) return "partial";
  return "weak";
}

// ─── Decoded shape of the STOKER agent_outputs.content ───────────

interface DecadeRow {
  decade: "RCK" | "RCL" | "RCD";
  resonanceScore: number;
  rationale: string;
  manifestation: {
    framingHook: string;
    tensionAxis: string;
    narrativeAngle: string;
    dimensionAlignment: Record<string, string>;
  } | null;
}

interface StokerOutputContent {
  overallRationale: string;
  decades: DecadeRow[];
  refused: boolean;
  refusalRationale: string | null;
}

// ─── Prose-as-bullets ────────────────────────────────────────────
//
// Phase 9.5 polish — the STOKER agent emits Overall rationale + each
// card's Angle as flowing prose, but the founder asked to read these
// as bullets so multi-clause reasoning stops blurring into a wall of
// editorial text. We don't change the agent's schema (no migration
// pressure, no agent re-run on existing rows) — we just split the
// returned prose at sentence boundaries client-side.
//
// Splitter heuristic: split on `.?!` followed by whitespace and an
// uppercase letter. This catches normal prose (`"… first thought.
// Second thought …"`) while leaving abbreviations like "U.S." and
// decimal numbers intact (those don't have an uppercase letter
// following a single space). Single-sentence prose falls through
// to a plain paragraph render so short-form content doesn't get a
// useless one-bullet list.
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function ProseAsBullets({
  text,
  bulletColor,
  textClassName,
}: {
  text: string;
  /** CSS color for the bullet dot. Defaults to currentColor at 60%
   *  opacity, which reads correctly on both ink and saturated decade
   *  card backgrounds. Pass an explicit rgba to override. */
  bulletColor?: string;
  /** Tailwind className applied to each li's text span. Lets the call
   *  site keep its existing typography (editorial 14px / 15px etc.). */
  textClassName: string;
}) {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    return <p className={textClassName}>{text}</p>;
  }
  return (
    <ul className="space-y-2">
      {sentences.map((sentence, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            aria-hidden
            className="shrink-0 w-1 h-1 rounded-full mt-[10px]"
            style={{
              background: bulletColor ?? "currentColor",
              opacity: bulletColor ? 1 : 0.6,
            }}
          />
          <span className={textClassName}>{sentence}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Renderer ─────────────────────────────────────────────────────

export function StokerResonance({
  signal,
  stokerData,
  parentRef,
  manifestationDetail,
  onSwitchToManifestation,
}: RendererProps) {
  // Phase 9F — manifestation child's STOKER tab. Renders a single
  // detail card for THIS manifestation (not the 3-card grid), tinted
  // in this manifestation's decade color. The 3-card grid is only on
  // the parent's STOKER tab.
  if (signal.parentSignalId !== null) {
    return (
      <ManifestationDetailView
        signal={signal}
        parentRef={parentRef}
        manifestationDetail={manifestationDetail}
      />
    );
  }

  // No STOKER data yet — two distinct sub-states.
  //   - signal.status === IN_STOKER: STOKER is actively running. Show
  //     a live "running" state with a breathing dot. The
  //     WorkspaceRealtime listener catches the agent_outputs insert
  //     and triggers router.refresh(), so this state auto-flips to
  //     the 3-card grid the moment STOKER lands its row — no manual
  //     reload needed (Phase 9 polish).
  //   - any other pre-output status (IN_BUNKER / COLD_BUNKER / etc.):
  //     STOKER hasn't been kicked off yet. Show the explanatory copy.
  if (!stokerData) {
    if (signal.status === "IN_STOKER") {
      return (
        <div className="py-8">
          <div className="text-[9px] font-mono tracking-[0.24em] uppercase text-t4 mb-2">
            DECADE RESONANCE
          </div>
          <div className="flex items-center gap-3 mb-3">
            <span
              aria-hidden
              className="breathe rounded-full"
              style={{
                width: 8,
                height: 8,
                background: "rgba(var(--d), 0.92)",
              }}
            />
            <span className="text-t1 font-display text-base font-semibold">
              STOKER is running…
            </span>
          </div>
          <p className="font-editorial italic text-t3 text-sm max-w-xl">
            Scoring resonance across the three decade cohorts. The cards
            land here as soon as STOKER finishes — no need to refresh.
          </p>
        </div>
      );
    }
    return (
      <div className="py-8">
        <div className="text-[9px] font-mono tracking-[0.24em] uppercase text-t4 mb-1">
          DECADE RESONANCE
        </div>
        <div className="text-t1 font-display text-base font-semibold mb-2">
          STOKER hasn&apos;t run for this signal yet
        </div>
        <p className="font-editorial italic text-t3 text-sm max-w-xl">
          Once you approve this signal at BUNKER, STOKER scores its
          resonance across the three decade cohorts (RCK / RCL / RCD)
          and produces decade-specific manifestations. Each manifestation
          becomes its own signal you advance into FURNACE independently.
        </p>
      </div>
    );
  }

  const content = stokerData.parentOutput.content as unknown as StokerOutputContent;
  const refused = Boolean(content.refused);
  const childByDecade = new Map(
    stokerData.children.map((c) => [c.decade, c]),
  );

  // CR nitpick on PR #8 — the `content` cast trusts the JSONB shape;
  // a malformed agent_outputs row could have content.decades undefined
  // or non-array. Defensive guard so the renderer falls back to empty
  // decade rows rather than crashing on `.find` undefined.
  const decadesArray = Array.isArray(content.decades) ? content.decades : [];

  // Decades pulled in canonical order so the grid is stable
  const orderedDecades: DecadeRow[] = DECADE_ORDER.map((d) => {
    const row = decadesArray.find((r) => r.decade === d);
    return (
      row ?? {
        decade: d,
        resonanceScore: 0,
        rationale: "",
        manifestation: null,
      }
    );
  });

  return (
    <div className="py-2">
      <div className="text-[9px] font-mono tracking-[0.24em] uppercase text-t4 mb-1">
        DECADE RESONANCE · STOKER OUTPUT
      </div>
      <h2 className="font-display text-base font-semibold text-t1 mb-1">
        How {signal.shortcode} lands across the three decades
      </h2>
      <p className="font-editorial italic text-t3 text-sm mb-7 max-w-3xl">
        Scores are advisory — your call overrides. Approve cards to
        advance them to FURNACE. Edits stay on the card before approval.
      </p>

      {/* Overall rationale strip — Phase 9.5 polish: rendered as
          bullets when prose has 2+ sentences. Single-sentence inputs
          stay as a plain paragraph (would be silly to bullet a one-
          liner). */}
      {content.overallRationale && (
        <div className="bg-wash-1 border border-rule-1 rounded-md px-5 py-4 mb-7">
          <div className="text-[9px] font-mono tracking-[0.24em] uppercase text-t4 mb-2">
            Overall rationale
          </div>
          <ProseAsBullets
            text={content.overallRationale}
            textClassName="font-editorial text-[15px] leading-relaxed text-t1"
          />
        </div>
      )}

      {/* Refusal banner — replaces card grid when refused */}
      {refused ? (
        <RefusalBanner
          refusalRationale={content.refusalRationale}
          decades={orderedDecades}
        />
      ) : (
        <>
          {/* Card grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[18px] mb-8">
            {orderedDecades.map((row) => {
              const child = childByDecade.get(row.decade) ?? null;
              return (
                <DecadeCard
                  key={row.decade}
                  row={row}
                  child={child}
                  onSwitchToManifestation={onSwitchToManifestation}
                />
              );
            })}
          </div>

          {/* Fan-out preview strip */}
          <FanOutPreview
            manifestations={stokerData.children}
            onSwitchToManifestation={onSwitchToManifestation}
          />
        </>
      )}
    </div>
  );
}

// ─── DecadeCard ──────────────────────────────────────────────────

function DecadeCard({
  row,
  child,
  onSwitchToManifestation,
}: {
  row: DecadeRow;
  child: ParentStokerData["children"][number] | null;
  /** Phase 9.5 polish — workspace callback. When set on an APPROVED
   *  card, a top-right corner arrow renders that flips active tab to
   *  FURNACE + selects this manifestation. Optional — when undefined
   *  the arrow is omitted (falls back to the card's bottom badge for
   *  any future surface that renders cards without the workspace). */
  onSwitchToManifestation?: RendererProps["onSwitchToManifestation"];
}) {
  const band = bandFor(row.resonanceScore);
  const tint = DECADE_TINTS[row.decade];

  // States the card can be in:
  //   - normal (PENDING founder gate, has manifestation): show actions
  //   - approved (APPROVED gate): show "approved" badge
  //   - rejected (REJECTED gate): show "dismissed" badge
  //   - weak (score < 50, no manifestation): collapsed, dimmed
  //   - editing: show edit form
  const [editing, setEditing] = useState(false);

  if (!row.manifestation) {
    // Weak — STOKER didn't produce a manifestation. Show a dimmed shell
    // explaining the score and rationale so founder can audit + force-
    // approve via the (Phase 9G) ORC tool route.
    return (
      <div
        className={`${tint} rounded-md border border-dashed border-rule-2 bg-transparent p-5 opacity-60`}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-display font-bold tracking-[0.16em] text-t2">
            {row.decade}{" "}
            <span className="font-mono text-[9px] tracking-[0.2em] text-t4 ml-2">
              {DECADE_AGES[row.decade]}
            </span>
          </span>
          <span className="font-display font-semibold text-t4">
            {row.resonanceScore}
          </span>
        </div>
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t4 mb-2">
          STOKER didn&apos;t see strong fit
        </div>
        <ProseAsBullets
          text={row.rationale}
          textClassName="font-editorial italic text-t3 text-[13px] leading-relaxed"
        />
      </div>
    );
  }

  // Status decoration
  const childStatus = child?.outputStatus ?? "PENDING";
  const isApproved = childStatus === "APPROVED";
  const isRejected = childStatus === "REJECTED";

  // Phase 9 polish — solid decade-color card surface with contrasting
  // cream text, replacing the prior faint 8%-tint approach. All three
  // RCK/RCL/RCD palette colors are dark enough that the off-white
  // (--t1) text passes WCAG AA at 14px+. The strong-band card uses a
  // 92% saturated decade color (a bit shy of full so the surface still
  // feels "of the brand" rather than poster-loud); partial uses a
  // dimmed 65%; weak retains the previous transparent dashed treatment
  // for visual de-emphasis.
  const cardBackground =
    band === "strong"
      ? "rgba(var(--d), 0.92)"
      : band === "partial"
        ? "rgba(var(--d), 0.65)"
        : "rgba(242,239,233,0.022)";
  const cardBorder =
    band === "strong"
      ? "rgba(var(--d), 1)"
      : band === "partial"
        ? "rgba(var(--d), 0.7)"
        : undefined; // weak/none falls through to t-class border-rule-2

  const showFurnaceStrip =
    child && childStatus === "APPROVED" && onSwitchToManifestation;

  return (
    <div
      className={`${tint} rounded-md border overflow-hidden ${
        band === "weak" ? "border-rule-2" : ""
      } flex flex-col`}
      style={{
        background: cardBackground,
        ...(cardBorder ? { borderColor: cardBorder } : {}),
      }}
    >
      {/* Approved → FURNACE strip — Phase 9.5 polish round 3.
          Pricing-card-style top banner. Spans the card's full width
          (no inner padding), rests above the content with its own
          horizontal padding, doesn't compress the head/hook/angle
          below. The whole strip is the click target — text on the
          left ("APPROVED · ADVANCE TO FURNACE"), drifting arrow on
          the right (drift-right keyframe in globals.css, same 2.8s
          cadence as everywhere else in the workspace).

          Replaces the bottom ApprovedBadge entirely on cards that
          carry the strip — surface duplication of "Approved · advancing
          to FURNACE" in two places confused the read. The bottom badge
          still lives in the JSX below and renders ONLY when there's
          no workspace callback (read-only audit surface).
          overflow-hidden on the card outer is critical: the strip
          extends to the card's outer border, but without overflow-
          hidden the rounded-md corners would clip the strip's
          background unevenly. */}
      {showFurnaceStrip && (
        <button
          type="button"
          onClick={() => onSwitchToManifestation(child.decade, "FURNACE")}
          aria-label={`Open ${child.decade} manifestation in FURNACE`}
          className="px-[22px] py-2.5 flex items-center justify-between gap-3 transition-colors hover:bg-[rgba(242,239,233,0.18)] focus-visible:outline-none focus-visible:bg-[rgba(242,239,233,0.18)] cursor-pointer"
          style={{
            color: "rgba(242,239,233,0.95)",
            background: "rgba(242,239,233,0.10)",
            borderBottom: "1px solid rgba(242,239,233,0.30)",
          }}
        >
          <span className="font-mono text-[9.5px] tracking-[0.22em] uppercase">
            Approved · advance to FURNACE
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-[9.5px] tracking-[0.22em] uppercase">
              FURNACE
            </span>
            <span
              aria-hidden
              className="drift-right"
              style={{
                lineHeight: 1,
                fontSize: "12px",
                display: "inline-block",
              }}
            >
              →
            </span>
          </span>
        </button>
      )}

      {/* Card content — wraps everything below the strip in the card's
          original 22px padding. Phase 9.5 round 3 split this from the
          outer so the strip can full-bleed to the card edges. flex-1
          lets the content fill remaining card height (so mt-auto on
          bottom badges still pushes them to the card bottom). */}
      <div className="p-[22px] flex flex-col flex-1">
      {/* Card head: decade label + score. Text on filled cards is
          cream (--t1) — high contrast against the saturated decade
          background. Score gets a slightly muted off-white so it
          recedes into the decade color rather than competing. */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-bold text-[13px] tracking-[0.16em] text-t1">
          {row.decade}
          <span
            className="font-mono text-[9px] tracking-[0.2em] ml-2"
            style={{ color: "rgba(242,239,233,0.65)" }}
          >
            {DECADE_AGES[row.decade]}
          </span>
        </span>
        <span
          className="font-display font-bold text-[22px] -tracking-[0.01em] tabular-nums text-t1"
          style={{
            color:
              band === "weak" ? "rgba(242,239,233,0.5)" : "rgb(242,239,233)",
          }}
        >
          {row.resonanceScore}
        </span>
      </div>

      {/* Decade rule — cream-tinted divider on the saturated cards
          rather than the decade color (it's already the background). */}
      <div
        className="h-px mb-3"
        style={{
          background:
            band === "weak"
              ? "var(--color-rule-1)"
              : "rgba(242,239,233,0.25)",
        }}
      />

      {editing && child ? (
        <EditForm
          child={child}
          existing={row.manifestation}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <>
          {/* Hook */}
          <div className="font-display font-medium text-[17px] -tracking-[0.005em] leading-snug text-t1 mb-4">
            {row.manifestation.framingHook}
          </div>

          {/* Tension */}
          <div className="mb-3">
            <div
              className="font-mono text-[9px] tracking-[0.22em] uppercase mb-1"
              style={{ color: "rgba(242,239,233,0.7)" }}
            >
              Tension
            </div>
            <div className="font-mono text-[12px] leading-relaxed text-t1">
              {row.manifestation.tensionAxis}
            </div>
          </div>

          {/* Angle — Phase 9.5 polish: bullets when multi-sentence.
              Bullet color set explicitly to cream (off-white) instead
              of currentColor because currentColor would resolve to the
              decade-saturated card text and disappear against the same
              background. The cream tinted at 70% gives a faint dot
              that's visible but doesn't compete with the prose. */}
          <div className="mb-4">
            <div
              className="font-mono text-[9px] tracking-[0.22em] uppercase mb-1"
              style={{ color: "rgba(242,239,233,0.7)" }}
            >
              Angle
            </div>
            <ProseAsBullets
              text={row.manifestation.narrativeAngle}
              bulletColor="rgba(242,239,233,0.7)"
              textClassName="font-editorial text-[14px] leading-relaxed text-t1"
            />
          </div>

          {/* Status badge or actions. The isApproved / isRejected
              checks are computed from child.outputStatus, but TS can't
              see through the optional chain — so we narrow on `child`
              first, then branch on status.
              Phase 9.5 round 3: ApprovedBadge skipped when the top
              FURNACE strip is rendering — the strip already carries
              the same status text, no point doubling it. The badge
              still renders for read-only audit surfaces (no
              workspace callback) so they stay informative. */}
          {child ? (
            isApproved ? (
              showFurnaceStrip ? null : <ApprovedBadge child={child} />
            ) : isRejected ? (
              <RejectedBadge child={child} />
            ) : (
              <CardActions
                child={child}
                onEdit={() => setEditing(true)}
              />
            )
          ) : (
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-t4 mt-auto pt-3 border-t border-rule-1">
              No manifestation child found — page may need a refresh.
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

// ─── Card actions (Approve / Edit / Dismiss) ─────────────────────

function CardActions({
  child,
  onEdit,
}: {
  child: ParentStokerData["children"][number];
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveStokerManifestation({
          manifestationSignalId: child.id,
        });
        router.refresh();
      } catch (e) {
        // CR pass on PR #8 — safe extraction. (e as Error).message
        // would coerce non-Error throws (string, number, anything from
        // a buggy library) into garbage. instanceof check + String()
        // fallback keeps the UI's error display predictable.
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function handleDismiss() {
    setError(null);
    startTransition(async () => {
      try {
        await dismissStokerManifestation({
          manifestationSignalId: child.id,
        });
        router.refresh();
      } catch (e) {
        // CR pass on PR #8 — safe extraction. (e as Error).message
        // would coerce non-Error throws (string, number, anything from
        // a buggy library) into garbage. instanceof check + String()
        // fallback keeps the UI's error display predictable.
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // Phase 9 polish — buttons styled to read against the saturated
  // decade-color card background. The previous "border-[var(--d)]" /
  // "text-[var(--d)]" treatments would render decade-on-decade
  // (invisible). Now: cream borders + cream text, with the Approve
  // button getting a stronger fill on hover. Dismiss stays low-key.
  return (
    <div
      className="mt-auto pt-3 border-t"
      style={{ borderColor: "rgba(242,239,233,0.25)" }}
    >
      {error && (
        <div
          className="font-mono text-[10px] mb-2"
          style={{ color: "rgba(255,200,200,0.95)" }}
        >
          {error}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleApprove}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          style={CREAM_BUTTON_STYLES.primary}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          style={CREAM_BUTTON_STYLES.secondary}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          style={CREAM_BUTTON_STYLES.tertiary}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ─── Approved / Rejected badges ──────────────────────────────────

function ApprovedBadge({
  child,
}: {
  child: ParentStokerData["children"][number];
}) {
  // Phase 9.5 polish — the previous "Open ↗" link in this badge moved
  // to a top-right corner arrow on the card itself (more discoverable,
  // doesn't compete with the bottom action area). The badge here just
  // surfaces the status text now. The `child` prop is still required
  // (for parity with sibling badges + future audit data on hover).
  void child;
  return (
    <div
      className="mt-auto pt-3 border-t"
      style={{ borderColor: "rgba(242,239,233,0.25)" }}
    >
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t1">
        Approved · advancing to FURNACE
      </span>
    </div>
  );
}

function RejectedBadge({
  child,
}: {
  child: ParentStokerData["children"][number];
}) {
  void child;
  return (
    <div
      className="mt-auto pt-3 border-t"
      style={{ borderColor: "rgba(242,239,233,0.25)" }}
    >
      <span
        className="font-mono text-[10px] tracking-[0.22em] uppercase"
        style={{ color: "rgba(242,239,233,0.55)" }}
      >
        Dismissed
      </span>
    </div>
  );
}

// ─── Edit form (in-place textarea swap) ──────────────────────────

function EditForm({
  child,
  existing,
  onCancel,
  onSaved,
}: {
  child: ParentStokerData["children"][number];
  existing: NonNullable<DecadeRow["manifestation"]>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [framingHook, setFramingHook] = useState(existing.framingHook);
  const [tensionAxis, setTensionAxis] = useState(existing.tensionAxis);
  const [narrativeAngle, setNarrativeAngle] = useState(existing.narrativeAngle);
  const [error, setError] = useState<string | null>(null);

  function persist(approveAfter: boolean) {
    setError(null);
    const fields: ManifestationEditFields = {};
    if (framingHook !== existing.framingHook) fields.framingHook = framingHook;
    if (tensionAxis !== existing.tensionAxis) fields.tensionAxis = tensionAxis;
    if (narrativeAngle !== existing.narrativeAngle) {
      fields.narrativeAngle = narrativeAngle;
    }

    startTransition(async () => {
      try {
        if (Object.keys(fields).length > 0) {
          await editStokerManifestation({
            manifestationSignalId: child.id,
            fields,
          });
        }
        if (approveAfter) {
          await approveStokerManifestation({
            manifestationSignalId: child.id,
          });
        }
        onSaved();
        router.refresh();
      } catch (e) {
        // CR pass on PR #8 — safe extraction. (e as Error).message
        // would coerce non-Error throws (string, number, anything from
        // a buggy library) into garbage. instanceof check + String()
        // fallback keeps the UI's error display predictable.
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* CR nitpick on PR #8 — `<label htmlFor>` already provides the
          accessible name; aria-label is redundant and (per WCAG) when
          both are set the aria-label wins which can desync the visible
          label from the announced one. Keeping the htmlFor association
          alone. Same fix applied to the textareas below. */}
      <label className="sr-only" htmlFor={`stoker-edit-hook-${child.id}`}>
        Framing hook
      </label>
      <input
        id={`stoker-edit-hook-${child.id}`}
        value={framingHook}
        onChange={(e) => setFramingHook(e.target.value)}
        className="bg-black/30 border border-rule-2 text-t1 font-display text-[17px] font-medium -tracking-[0.005em] px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)]"
      />
      {/* Phase 9 polish — labels and buttons styled in cream tones to
          read against the saturated decade-color card background.
          CodeRabbit out-of-diff finding on PR #9 caught these — same
          decade-on-decade invisibility issue I'd already fixed for
          CardActions but missed for the EditForm. Now consistent. */}
      <div>
        <label
          htmlFor={`stoker-edit-tension-${child.id}`}
          className="font-mono text-[9px] tracking-[0.22em] uppercase mb-1 block"
          style={{ color: "rgba(242,239,233,0.7)" }}
        >
          Tension
        </label>
        <textarea
          id={`stoker-edit-tension-${child.id}`}
          value={tensionAxis}
          onChange={(e) => setTensionAxis(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-rule-2 text-t1 font-mono text-[12px] px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)] resize-vertical"
        />
      </div>
      <div>
        <label
          htmlFor={`stoker-edit-angle-${child.id}`}
          className="font-mono text-[9px] tracking-[0.22em] uppercase mb-1 block"
          style={{ color: "rgba(242,239,233,0.7)" }}
        >
          Angle
        </label>
        <textarea
          id={`stoker-edit-angle-${child.id}`}
          value={narrativeAngle}
          onChange={(e) => setNarrativeAngle(e.target.value)}
          rows={4}
          className="w-full bg-black/30 border border-rule-2 text-t1 font-editorial text-[14px] leading-relaxed px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)] resize-vertical"
        />
      </div>
      {error && (
        <div
          className="font-mono text-[10px]"
          style={{ color: "rgba(255,200,200,0.95)" }}
        >
          {error}
        </div>
      )}
      <div className="flex gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => persist(true)}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          style={CREAM_BUTTON_STYLES.primary}
        >
          Save &amp; Approve
        </button>
        <button
          type="button"
          onClick={() => persist(false)}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          style={CREAM_BUTTON_STYLES.secondary}
        >
          Save Draft
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
          style={CREAM_BUTTON_STYLES.tertiary}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Refusal banner ──────────────────────────────────────────────

function RefusalBanner({
  refusalRationale,
  decades,
}: {
  refusalRationale: string | null;
  decades: DecadeRow[];
}) {
  return (
    <div className="border border-rule-2 rounded-md px-7 py-6 mb-6 bg-[rgba(242,239,233,0.044)]">
      <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-[rgba(var(--d-rck),0.9)] mb-2.5">
        REFUSED
      </div>
      <div className="font-display text-lg font-semibold text-t1 mb-3">
        No cohort scores ≥ 50 — refusal threshold not met
      </div>
      {refusalRationale && (
        <p className="font-editorial text-[15px] leading-relaxed text-t2 mb-4 max-w-3xl">
          {refusalRationale}
        </p>
      )}
      <button
        type="button"
        disabled
        title="Force-add lands in Phase 9G via ORC's add_manifestation tool. Ask ORC to add a decade you think STOKER missed."
        className="font-mono text-[10px] tracking-[0.18em] uppercase px-4 py-2.5 border border-rule-3 text-t3 cursor-not-allowed rounded-sm"
      >
        Force-add a decade → (ask ORC)
      </button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-5">
        {decades.map((row) => (
          <div
            key={row.decade}
            className={`${DECADE_TINTS[row.decade]} border border-dashed border-rule-1 rounded-md px-4 py-3.5`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-display font-bold text-[11px] tracking-[0.16em] text-t2">
                {row.decade} · {DECADE_AGES[row.decade]}
              </span>
              <span className="font-display font-semibold text-[14px] text-t3">
                {row.resonanceScore}
              </span>
            </div>
            <p className="font-mono text-[11px] leading-relaxed text-t3">
              {row.rationale}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Fan-out preview ──────────────────────────────────────────────

function FanOutPreview({
  manifestations,
  onSwitchToManifestation,
}: {
  // CR on PR #8: prop was named `children` which collides with React's
  // special children semantics + ESLint react/no-children-prop. The
  // values are data (filtered, mapped), not React nodes — `manifestations`
  // is the correct semantic name.
  manifestations: ParentStokerData["children"];
  /** Phase 9.5 polish — workspace callback. When set, the
   *  per-manifestation pills become buttons that flip active tab to
   *  FURNACE + select this manifestation (instead of a same-page
   *  redirect to the parent that just bounced back to itself).
   *  Optional — when undefined the pills fall back to plain
   *  shortcode display, preserving render parity for future
   *  read-only surfaces. */
  onSwitchToManifestation?: RendererProps["onSwitchToManifestation"];
}) {
  const advancing = manifestations.filter(
    (c) => c.outputStatus === "APPROVED",
  );
  const dismissed = manifestations.filter(
    (c) => c.outputStatus === "REJECTED",
  );

  if (advancing.length === 0 && dismissed.length === 0) {
    return (
      <div className="bg-wash-1 border border-rule-1 rounded-md px-5 py-4 flex items-center gap-4">
        <span className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4">
          Advancing to FURNACE
        </span>
        <span className="font-editorial italic text-t3 text-sm">
          Approve at least one manifestation to advance.
        </span>
      </div>
    );
  }

  return (
    <div className="bg-wash-1 border border-rule-1 border-l-[3px] border-l-[rgba(var(--d),0.6)] rounded-md px-5 py-4 flex items-center gap-4 flex-wrap">
      <span className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4">
        Advancing to FURNACE
      </span>
      {advancing.length === 0 ? (
        <span className="font-editorial italic text-t3 text-sm">
          Nothing yet.
        </span>
      ) : (
        advancing.map((c, i) => (
          <span key={c.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-t4">·</span>}
            {onSwitchToManifestation ? (
              <button
                type="button"
                onClick={() =>
                  onSwitchToManifestation(c.decade, "FURNACE")
                }
                aria-label={`Open ${c.decade} manifestation in FURNACE`}
                className="font-display font-semibold text-[13px] tracking-[0.08em] text-t1 hover:underline focus-visible:outline-none focus-visible:underline cursor-pointer"
              >
                {c.shortcode}
              </button>
            ) : (
              // Read-only fallback — used when the renderer is mounted
              // outside the WorkspaceFrame (e.g., admin / audit views
              // post-Phase-12). Plain text, no navigation.
              <span className="font-display font-semibold text-[13px] tracking-[0.08em] text-t1">
                {c.shortcode}
              </span>
            )}
            <span className={`${DECADE_TINTS[c.decade]} font-mono text-[9px] tracking-[0.2em] uppercase text-[rgba(var(--d),0.95)] px-2 py-0.5 border border-[rgba(var(--d),0.4)] rounded-sm`}>
              {c.decade}
            </span>
          </span>
        ))
      )}
      {dismissed.length > 0 && (
        <span className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 ml-auto">
          {dismissed.length} dismissed
        </span>
      )}
    </div>
  );
}

// ─── Manifestation workspace detail (Phase 9F) ───────────────────

/**
 * Single-card STOKER tab detail rendered on a manifestation child's
 * own workspace. Shows decade chip + score + framing + dimensions —
 * full content for THIS manifestation only. Per-card actions are
 * disabled here because the per-card actions live on the parent's
 * STOKER tab (where the founder reviews all 3 manifestations together).
 *
 * Status badge surfaces the manifestation's current gate state:
 * PENDING (awaiting parent-side approval) / APPROVED (advancing past
 * STOKER) / REJECTED (dismissed).
 */
function ManifestationDetailView({
  signal,
  parentRef,
  manifestationDetail,
}: {
  signal: typeof signals.$inferSelect;
  parentRef: ParentReference | null;
  manifestationDetail: ManifestationOwnDetail | null;
}) {
  if (!manifestationDetail) {
    return (
      <div className="py-8 text-t3 font-editorial italic">
        STOKER output for this manifestation hasn&apos;t been loaded yet.
        If this persists after a refresh, check the parent signal and
        re-run STOKER from there.
      </div>
    );
  }

  const decade = signal.manifestationDecade as "RCK" | "RCL" | "RCD" | null;
  const tint = decade ? DECADE_TINTS[decade] : "";
  const ageRange = decade ? DECADE_AGES[decade] : "";
  const c = manifestationDetail.content as {
    framingHook?: string;
    tensionAxis?: string;
    narrativeAngle?: string;
    rationale?: string;
    resonanceScore?: number;
    dimensionAlignment?: Record<string, string>;
  };

  const status = manifestationDetail.status;
  const isApproved = status === "APPROVED";
  const isRejected = status === "REJECTED";

  return (
    <div className="py-2">
      <div className="text-[9px] font-mono tracking-[0.24em] uppercase text-t4 mb-1">
        STOKER · MANIFESTATION DETAIL
      </div>
      <h2 className="font-display text-base font-semibold text-t1 mb-1">
        This is the {decade ?? "—"} manifestation
        {parentRef && (
          <span className="text-t3"> of {parentRef.shortcode}</span>
        )}
      </h2>
      <p className="font-editorial italic text-t3 text-sm mb-7 max-w-3xl">
        Originally produced by STOKER
        {manifestationDetail.revisionsCount > 0 && (
          <>, last edited (revision {manifestationDetail.revisionsCount})</>
        )}
        . Approve / edit / dismiss this manifestation from{" "}
        {parentRef ? (
          <a
            href={`/engine-room/signals/${encodeURIComponent(parentRef.shortcode)}`}
            className="font-mono text-[12px] tracking-[0.06em] not-italic uppercase text-t2 hover:text-t1 transition-colors"
          >
            {parentRef.shortcode} ↗
          </a>
        ) : (
          "the parent signal"
        )}
        &apos;s STOKER tab.
      </p>

      <div
        className={`${tint} border rounded-md px-8 py-7`}
        style={{
          background: "rgba(var(--d), 0.08)",
          borderColor: "rgba(var(--d), 0.45)",
        }}
      >
        {/* Head */}
        <div
          className="flex items-baseline justify-between mb-4 pb-4 border-b"
          style={{ borderColor: "rgba(var(--d), 0.25)" }}
        >
          <span className="font-display font-bold text-[13px] tracking-[0.16em] text-[rgba(var(--d),1)]">
            {decade}
            <span className="font-mono text-[10px] tracking-[0.2em] text-t4 ml-2.5">
              {ageRange}
            </span>
          </span>
          <div className="flex items-center gap-4">
            {isApproved && (
              <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-[rgba(var(--d),1)]">
                Approved
              </span>
            )}
            {isRejected && (
              <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-t4">
                Dismissed
              </span>
            )}
            {!isApproved && !isRejected && (
              <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-t3">
                Pending parent gate
              </span>
            )}
            {typeof c.resonanceScore === "number" && (
              <span className="font-display font-bold text-[26px] -tracking-[0.01em] tabular-nums text-[rgba(var(--d),1)]">
                {c.resonanceScore}
              </span>
            )}
          </div>
        </div>

        {/* Hook */}
        {c.framingHook && (
          <div className="font-display font-medium text-[22px] -tracking-[0.008em] leading-snug text-t1 mb-5">
            {c.framingHook}
          </div>
        )}

        {/* Tension */}
        {c.tensionAxis && (
          <div className="mb-4">
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 mb-1.5">
              Tension axis
            </div>
            <div className="font-mono text-[13px] leading-relaxed text-t1">
              {c.tensionAxis}
            </div>
          </div>
        )}

        {/* Angle */}
        {c.narrativeAngle && (
          <div className="mb-5">
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 mb-1.5">
              Narrative angle
            </div>
            <div className="font-editorial text-[16px] leading-relaxed text-t1">
              {c.narrativeAngle}
            </div>
          </div>
        )}

        {/* Rationale */}
        {c.rationale && (
          <div className="mb-5">
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 mb-1.5">
              Rationale
            </div>
            <div className="font-editorial text-[14px] leading-relaxed text-t2 italic">
              {c.rationale}
            </div>
          </div>
        )}

        {/* Dimension alignment grid */}
        {c.dimensionAlignment && (
          <div
            className="pt-4 mt-2 border-t"
            style={{ borderColor: "rgba(var(--d), 0.25)" }}
          >
            <div className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4 mb-3">
              Dimension alignment
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 gap-x-8">
              {Object.entries(c.dimensionAlignment).map(([dim, value]) => (
                <div key={dim} className="font-mono text-[11px] leading-tight">
                  <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-t4 mb-0.5">
                    {dim}
                  </div>
                  <div className="text-t1">
                    {value && value.trim().length > 0 ? value : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
