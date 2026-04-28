"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RendererProps } from "./registry";
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

// ─── Renderer ─────────────────────────────────────────────────────

export function StokerResonance({ signal, stokerData }: RendererProps) {
  // Manifestation children's workspace shouldn't render this — they get
  // a different STOKER tab in Phase 9F. Defensive guard.
  if (signal.parentSignalId !== null) {
    return (
      <div className="text-t3 text-sm font-mono uppercase tracking-[0.18em]">
        STOKER detail for manifestations renders on the manifestation's
        own STOKER tab — Phase 9F.
      </div>
    );
  }

  // No STOKER data yet — placeholder while the signal is pre-STOKER.
  if (!stokerData) {
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

  // Decades pulled in canonical order so the grid is stable
  const orderedDecades: DecadeRow[] = DECADE_ORDER.map((d) => {
    const row = content.decades?.find((r) => r.decade === d);
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

      {/* Overall rationale strip */}
      {content.overallRationale && (
        <div className="bg-wash-1 border border-rule-1 rounded-md px-5 py-4 mb-7">
          <div className="text-[9px] font-mono tracking-[0.24em] uppercase text-t4 mb-2">
            Overall rationale
          </div>
          <div className="font-editorial text-[15px] leading-relaxed text-t1">
            {content.overallRationale}
          </div>
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
                />
              );
            })}
          </div>

          {/* Fan-out preview strip */}
          <FanOutPreview children={stokerData.children} />
        </>
      )}
    </div>
  );
}

// ─── DecadeCard ──────────────────────────────────────────────────

function DecadeCard({
  row,
  child,
}: {
  row: DecadeRow;
  child: ParentStokerData["children"][number] | null;
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
        <p className="font-editorial italic text-t3 text-[13px] leading-relaxed">
          {row.rationale}
        </p>
      </div>
    );
  }

  // Status decoration
  const childStatus = child?.outputStatus ?? "PENDING";
  const isApproved = childStatus === "APPROVED";
  const isRejected = childStatus === "REJECTED";

  return (
    <div
      className={`${tint} rounded-md border ${
        band === "strong"
          ? "border-[rgba(var(--d),0.55)]"
          : "border-rule-2"
      } p-[22px] flex flex-col`}
      style={{
        background:
          band === "strong"
            ? "rgba(var(--d), 0.08)"
            : "rgba(242,239,233,0.022)",
        opacity: band === "partial" ? 0.92 : 1,
      }}
    >
      {/* Card head: decade label + score */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-display font-bold text-[13px] tracking-[0.16em] text-t1">
          {row.decade}
          <span className="font-mono text-[9px] tracking-[0.2em] text-t4 ml-2">
            {DECADE_AGES[row.decade]}
          </span>
        </span>
        <span
          className={`font-display font-bold text-[22px] -tracking-[0.01em] tabular-nums ${
            band === "strong"
              ? "text-[rgba(var(--d),1)]"
              : band === "partial"
                ? "text-t2"
                : "text-t4"
          }`}
        >
          {row.resonanceScore}
        </span>
      </div>

      {/* Decade rule */}
      <div
        className="h-px mb-3"
        style={{
          background:
            band === "strong"
              ? "rgba(var(--d), 0.35)"
              : "var(--color-rule-1)",
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
            <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-t4 mb-1">
              Tension
            </div>
            <div className="font-mono text-[12px] leading-relaxed text-t1">
              {row.manifestation.tensionAxis}
            </div>
          </div>

          {/* Angle */}
          <div className="mb-4">
            <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-t4 mb-1">
              Angle
            </div>
            <div className="font-editorial text-[14px] leading-relaxed text-t1">
              {row.manifestation.narrativeAngle}
            </div>
          </div>

          {/* Status badge or actions. The isApproved / isRejected
              checks are computed from child.outputStatus, but TS can't
              see through the optional chain — so we narrow on `child`
              first, then branch on status. */}
          {child ? (
            isApproved ? (
              <ApprovedBadge child={child} />
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
        setError((e as Error).message);
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
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mt-auto pt-3 border-t border-rule-1">
      {error && (
        <div className="font-mono text-[10px] text-[rgba(var(--d-rck),0.95)] mb-2">
          {error}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleApprove}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 border border-[rgba(var(--d),0.7)] text-[rgba(var(--d),1)] hover:bg-[rgba(var(--d),0.1)] disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 border border-rule-2 text-t2 hover:text-t1 hover:border-rule-3 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 border border-rule-1 text-t3 hover:text-t1 hover:border-rule-2 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
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
  return (
    <div className="mt-auto pt-3 border-t border-rule-1 flex items-center justify-between">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[rgba(var(--d),1)]">
        Approved · advancing to FURNACE
      </span>
      <a
        href={`/engine-room/signals/${child.shortcode}`}
        className="font-mono text-[9px] tracking-[0.22em] uppercase text-t3 hover:text-t1 transition-colors"
      >
        Open ↗
      </a>
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
    <div className="mt-auto pt-3 border-t border-rule-1">
      <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-t4">
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
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        value={framingHook}
        onChange={(e) => setFramingHook(e.target.value)}
        className="bg-black/30 border border-rule-2 text-t1 font-display text-[17px] font-medium -tracking-[0.005em] px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)]"
      />
      <div>
        <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-[rgba(var(--d),0.85)] mb-1">
          Tension
        </div>
        <textarea
          value={tensionAxis}
          onChange={(e) => setTensionAxis(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-rule-2 text-t1 font-mono text-[12px] px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)] resize-vertical"
        />
      </div>
      <div>
        <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-[rgba(var(--d),0.85)] mb-1">
          Angle
        </div>
        <textarea
          value={narrativeAngle}
          onChange={(e) => setNarrativeAngle(e.target.value)}
          rows={4}
          className="w-full bg-black/30 border border-rule-2 text-t1 font-editorial text-[14px] leading-relaxed px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)] resize-vertical"
        />
      </div>
      {error && (
        <div className="font-mono text-[10px] text-[rgba(var(--d-rck),0.95)]">
          {error}
        </div>
      )}
      <div className="flex gap-1.5 mt-2">
        <button
          type="button"
          onClick={() => persist(true)}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 border border-[rgba(var(--d),0.7)] text-[rgba(var(--d),1)] hover:bg-[rgba(var(--d),0.1)] disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
        >
          Save &amp; Approve
        </button>
        <button
          type="button"
          onClick={() => persist(false)}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 border border-rule-2 text-t2 hover:text-t1 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
        >
          Save Draft
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 font-mono text-[9px] tracking-[0.22em] uppercase px-3 py-2 border border-rule-1 text-t3 hover:text-t1 disabled:opacity-50 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
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
  children,
}: {
  children: ParentStokerData["children"];
}) {
  const advancing = children.filter((c) => c.outputStatus === "APPROVED");
  const dismissed = children.filter((c) => c.outputStatus === "REJECTED");

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
            <a
              href={`/engine-room/signals/${c.shortcode}`}
              className="font-display font-semibold text-[13px] tracking-[0.08em] text-t1 hover:underline"
            >
              {c.shortcode}
            </a>
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
