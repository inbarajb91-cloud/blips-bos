"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RendererProps } from "./registry";
import {
  approveBriefSection,
  approveFullBrief,
  dismissBrief,
  editBriefSection,
  REQUIRED_SECTIONS,
  SECTION_BOUNDS,
  type SectionName,
} from "@/lib/actions/furnace";

/**
 * FURNACE Brief Renderer — Phase 10D.
 *
 * Renders the FURNACE-generated visual design brief for one approved
 * STOKER manifestation. The brief is one agent_outputs row carrying
 * 11 visual-design sections + an extensible addenda array; this
 * component lets the founder review per-section, edit in place,
 * approve incrementally, or approve the whole brief in one shot.
 *
 * States this renderer handles:
 *   1. No brief yet — manifestation is at IN_FURNACE but FURNACE hasn't
 *      run (Inngest still processing, OR the approve action's
 *      inngest.send failed). Show a "FURNACE processing" empty state.
 *   2. Brief PENDING — section card grid + per-section actions + "Approve
 *      all sections" bottom CTA.
 *   3. Brief APPROVED — read-only success view with "advanced to BOILER"
 *      indication.
 *   4. Brief REJECTED — refusal banner + ORC affordance to regenerate.
 *   5. Brief refused (FURNACE refused, brand-fit < 50) — refusal banner
 *      with rationale + force-advance affordance via ORC.
 *
 * Layout pattern matches Phase 9.5 STOKER renderer:
 *   - Section cards in a 2-column grid (1-column on narrow viewports)
 *   - Decade tinting via `var(--d)` for accents
 *   - Inline edit (textarea expands in place when Edit clicked)
 *   - "Ask ORC to redo this section" placeholder for Phase 10E (the
 *     actual ORC tool integration; this renderer just opens the ORC
 *     panel with a pre-filled prompt context)
 *
 * Cascade banner (Phase 10F): currently shows a static placeholder
 * when STOKER manifestation has been edited past gate. The actual
 * detection logic ships in 10F.
 */

interface BriefContent {
  brandFitScore?: number;
  brandFitRationale?: string | null;
  refused?: boolean;
  refusalReason?: string | null;
  designDirection?: string | null;
  tactileIntent?: string | null;
  moodAndTone?: string | null;
  compositionApproach?: string | null;
  colorTreatment?: string | null;
  typographicTreatment?: string | null;
  artDirection?: string | null;
  referenceAnchors?: string | null;
  placementIntent?: string | null;
  voiceInVisual?: string | null;
  addenda?: Array<{ label: string; content: string; addedBy: string; reason: string }>;
}

interface SectionApprovals {
  [section: string]: { approved: boolean; approvedAt: string; approvedBy: string };
}

const SECTION_LABELS: Record<SectionName, string> = {
  designDirection: "Design Direction",
  tactileIntent: "Tactile Intent",
  moodAndTone: "Mood + Tone",
  compositionApproach: "Composition Approach",
  colorTreatment: "Color Treatment",
  typographicTreatment: "Typographic Treatment",
  artDirection: "Art Direction",
  referenceAnchors: "Reference Anchors",
  placementIntent: "Placement Intent",
  voiceInVisual: "Voice in Visual",
};

export function FurnaceBrief(props: RendererProps) {
  const { activeManifestation, signal } = props;

  // FURNACE only runs on manifestation children; raw signals don't have
  // briefs. Show an empty state for the parent view.
  if (signal.parentSignalId === null && !activeManifestation) {
    return (
      <NoActiveManifestation />
    );
  }

  // For parent workspaces with manifestations, the workspace's
  // manifestation selector picks `activeManifestation`. The brief
  // lives on that child.
  const manifestation = activeManifestation;
  if (!manifestation) {
    return <NoActiveManifestation />;
  }

  const briefDetail = manifestation.outputs?.FURNACE ?? null;

  // No brief yet — FURNACE hasn't run or is processing
  if (!briefDetail) {
    return <FurnaceProcessing manifestationShortcode={manifestation.shortcode} />;
  }

  const content = (briefDetail.content ?? {}) as BriefContent;
  const sectionApprovals = (briefDetail.content as Record<string, unknown>)
    ?.sectionApprovals as SectionApprovals | undefined;
  const status = briefDetail.status;

  // Refused state — brief was generated but FURNACE refused (brand-fit < 50)
  if (content.refused === true) {
    return (
      <FurnaceRefused
        briefId={briefDetail.id}
        brandFitScore={content.brandFitScore ?? 0}
        refusalReason={content.refusalReason ?? "(no rationale provided)"}
        manifestationShortcode={manifestation.shortcode}
      />
    );
  }

  // Approved — read-only success view
  if (status === "APPROVED") {
    return (
      <FurnaceApproved
        briefId={briefDetail.id}
        content={content}
        manifestationShortcode={manifestation.shortcode}
      />
    );
  }

  // Rejected — founder dismissed the brief; offer regen affordance
  if (status === "REJECTED") {
    return (
      <FurnaceRejectedByFounder
        briefId={briefDetail.id}
        manifestationShortcode={manifestation.shortcode}
      />
    );
  }

  // Default state: PENDING — render the section card grid for review
  return (
    <FurnaceBriefReview
      briefId={briefDetail.id}
      content={content}
      sectionApprovals={sectionApprovals ?? ((briefDetail as unknown) as { sectionApprovals?: SectionApprovals }).sectionApprovals ?? {}}
      manifestationShortcode={manifestation.shortcode}
      revisionsCount={briefDetail.revisionsCount}
    />
  );
}

// ─── Empty / processing / refused / approved state components ────

function NoActiveManifestation() {
  return (
    <div className="py-16 px-7 text-center">
      <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-2">
        FURNACE · No active manifestation
      </div>
      <div className="font-display text-base font-semibold text-t1 mb-2">
        Pick a manifestation from the selector above
      </div>
      <p className="font-display font-normal text-t3 text-[14px] leading-[1.6] max-w-xl mx-auto">
        FURNACE briefs are scoped to a single manifestation. Use the
        Manifestation Selector at the top of the workspace to pick which
        decade card&apos;s brief to review.
      </p>
    </div>
  );
}

function FurnaceProcessing({ manifestationShortcode }: { manifestationShortcode: string }) {
  return (
    <div className="py-16 px-7 text-center">
      <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-2">
        FURNACE · Processing
      </div>
      <div className="flex items-center justify-center gap-3 mb-3">
        <span
          className="breathe inline-block rounded-full"
          style={{
            width: 10,
            height: 10,
            background: "rgba(var(--d), 0.85)",
          }}
          aria-label="FURNACE is generating the brief"
        />
        <h2 className="font-display text-base font-semibold text-t1">
          Generating brief for {manifestationShortcode}…
        </h2>
      </div>
      <p className="font-display font-normal text-t3 text-[14px] leading-[1.6] max-w-xl mx-auto">
        FURNACE is reading the manifestation framing, recalling brand
        DNA + decade playbook + materials vocabulary, and writing the
        visual design brief. This usually takes 10-25 seconds. The brief
        will appear here automatically when ready.
      </p>
    </div>
  );
}

function FurnaceRefused({
  briefId,
  brandFitScore,
  refusalReason,
  manifestationShortcode,
}: {
  briefId: string;
  brandFitScore: number;
  refusalReason: string;
  manifestationShortcode: string;
}) {
  void briefId; // Future: force-advance via ORC tool (Phase 10E)
  return (
    <div className="py-12 px-7">
      <div className="border border-rule-2 rounded-md px-7 py-6 mb-6 bg-[rgba(242,239,233,0.044)]">
        <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-[rgba(var(--d-rck),0.9)] mb-2.5">
          FURNACE REFUSED · brand fit {brandFitScore}/100
        </div>
        <div className="font-display text-lg font-semibold text-t1 mb-3">
          Brand-fit score below 50 — no brief produced for {manifestationShortcode}
        </div>
        <p className="font-display font-normal text-[14.5px] leading-[1.6] text-t2 mb-4 max-w-3xl">
          {refusalReason}
        </p>
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t4 mt-4 max-w-3xl">
          Founder may force-advance via ORC&apos;s force-advance tool (Phase
          10E) or dismiss the manifestation entirely on its STOKER tab.
        </div>
      </div>
    </div>
  );
}

function FurnaceApproved({
  briefId,
  content,
  manifestationShortcode,
}: {
  briefId: string;
  content: BriefContent;
  manifestationShortcode: string;
}) {
  void briefId;
  return (
    <div className="py-8 px-7">
      <div className="bg-wash-1 border border-rule-1 rounded-md px-6 py-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-1.5">
              FURNACE · Brief approved · advancing to BOILER
            </div>
            <div className="font-display text-base font-semibold text-t1">
              {manifestationShortcode}
            </div>
          </div>
          <BrandFitBadge score={content.brandFitScore ?? 0} />
        </div>
      </div>
      <SectionCardGrid content={content} sectionApprovals={{}} readOnly briefId={briefId} />
    </div>
  );
}

function FurnaceRejectedByFounder({
  briefId,
  manifestationShortcode,
}: {
  briefId: string;
  manifestationShortcode: string;
}) {
  void briefId;
  return (
    <div className="py-12 px-7">
      <div className="border border-rule-2 rounded-md px-7 py-6 max-w-3xl">
        <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-2.5">
          FURNACE · Brief rejected by founder
        </div>
        <div className="font-display text-lg font-semibold text-t1 mb-3">
          The brief for {manifestationShortcode} was dismissed
        </div>
        <p className="font-display font-normal text-[14.5px] leading-[1.6] text-t2 mb-4">
          Ask ORC to regenerate the full brief with feedback, or dismiss
          the manifestation on its STOKER tab.
        </p>
      </div>
    </div>
  );
}

// ─── Main review state — section card grid ───────────────────────

function FurnaceBriefReview({
  briefId,
  content,
  sectionApprovals,
  manifestationShortcode,
  revisionsCount,
}: {
  briefId: string;
  content: BriefContent;
  sectionApprovals: SectionApprovals;
  manifestationShortcode: string;
  revisionsCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allSectionsApproved = REQUIRED_SECTIONS.every(
    (s) => sectionApprovals[s]?.approved === true,
  );

  function handleApproveAll() {
    setError(null);
    startTransition(async () => {
      try {
        await approveFullBrief({ briefId });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to approve brief.");
      }
    });
  }

  function handleDismiss() {
    const reason = window.prompt(
      "Why are you dismissing this brief? (4-500 chars)",
      "",
    );
    if (!reason || reason.trim().length < 4) return;
    setError(null);
    startTransition(async () => {
      try {
        await dismissBrief({ briefId, reason: reason.trim() });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to dismiss brief.");
      }
    });
  }

  return (
    <div className="py-8 px-7">
      {/* Top strip — brand-fit score + revisions + actions */}
      <div className="bg-wash-1 border border-rule-1 rounded-md px-6 py-5 mb-7 flex items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <BrandFitBadge score={content.brandFitScore ?? 0} />
          <div>
            <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-1">
              FURNACE Brief · {manifestationShortcode}
            </div>
            <div className="font-display font-medium text-base text-t1 leading-tight max-w-xl">
              {content.brandFitRationale}
            </div>
            <div className="font-mono text-[9px] tracking-[0.22em] uppercase text-t5 mt-1.5">
              Revision {revisionsCount + 1} · {Object.values(sectionApprovals).filter((a) => a.approved).length}/{REQUIRED_SECTIONS.length} sections approved
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDismiss}
            disabled={pending}
            className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border border-rule-2 text-t3 hover:text-t1 hover:border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Dismiss
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 border border-[#d4908a]/40 bg-[#a04040]/12 rounded-sm font-display text-[13px] text-t1">
          {error}
        </div>
      )}

      {/* Cascade banner placeholder — Phase 10F */}

      {/* Section card grid */}
      <SectionCardGrid
        content={content}
        sectionApprovals={sectionApprovals}
        briefId={briefId}
      />

      {/* Bottom CTA — approve all sections + advance */}
      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={handleApproveAll}
          disabled={pending || allSectionsApproved}
          className="font-mono text-[10.5px] tracking-[0.18em] uppercase px-5 py-3 rounded-sm border-2 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: "rgba(var(--d), 0.7)",
            background: "rgba(var(--d), 0.12)",
            color: "rgba(var(--d), 1)",
          }}
        >
          {pending
            ? "Approving…"
            : allSectionsApproved
              ? "All sections approved"
              : "Approve all sections + advance to BOILER →"}
        </button>
      </div>
    </div>
  );
}

// ─── Section card grid ───────────────────────────────────────────

function SectionCardGrid({
  content,
  sectionApprovals,
  briefId,
  readOnly = false,
}: {
  content: BriefContent;
  sectionApprovals: SectionApprovals;
  briefId: string;
  readOnly?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {REQUIRED_SECTIONS.map((section) => {
        const sectionContent = (content[section] ?? "") as string;
        const approved = sectionApprovals[section]?.approved === true;
        return (
          <SectionCard
            key={section}
            section={section}
            content={sectionContent}
            approved={approved}
            briefId={briefId}
            readOnly={readOnly}
          />
        );
      })}
    </div>
  );
}

function SectionCard({
  section,
  content,
  approved,
  briefId,
  readOnly,
}: {
  section: SectionName;
  content: string;
  approved: boolean;
  briefId: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState<string | null>(null);

  const bounds = SECTION_BOUNDS[section];
  const charCount = draft.length;
  const charBudgetWidth = Math.min(100, (charCount / bounds.max) * 100);
  const charOverBudget = charCount > bounds.max || charCount < bounds.min;

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveBriefSection({ briefId, section });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to approve section.");
      }
    });
  }

  function handleSaveEdit() {
    setError(null);
    startTransition(async () => {
      try {
        await editBriefSection({
          briefId,
          section,
          newContent: draft,
        });
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save section.");
      }
    });
  }

  return (
    <div
      className={`p-5 rounded-md border transition-colors ${
        approved
          ? "border-[rgba(var(--d),0.55)] bg-[rgba(var(--d),0.04)]"
          : "border-rule-2 bg-wash-1"
      }`}
    >
      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[10px] tracking-[0.24em] uppercase text-t4 mb-1">
            {SECTION_LABELS[section]}
          </div>
          <div
            className="font-mono text-[8.5px] tracking-[0.18em] uppercase mb-2"
            style={{
              color: approved ? "rgba(var(--d), 0.85)" : "var(--color-t5)",
            }}
          >
            {approved ? "▣ approved" : "▢ pending"} ·{" "}
            <span className={charOverBudget ? "text-[#d4908a]" : ""}>
              {editing ? draft.length : content.length}
            </span>
            /{bounds.max} chars
          </div>
        </div>
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="w-full bg-black/30 border border-rule-2 text-t1 font-display font-normal text-[13.5px] leading-[1.6] px-3 py-2.5 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)] resize-vertical"
          />
          <div className="mt-1 h-[2px] bg-rule-1 rounded-sm overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${charBudgetWidth}%`,
                background: charOverBudget
                  ? "#d4908a"
                  : "rgba(var(--d), 0.7)",
              }}
            />
          </div>
          {error && (
            <div className="mt-2 font-display text-[12px] text-[#d4908a]">{error}</div>
          )}
          <div className="mt-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(content);
                setError(null);
              }}
              disabled={pending}
              className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border border-rule-2 text-t3 hover:text-t1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={pending || charOverBudget}
              className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                borderColor: "rgba(var(--d), 0.7)",
                background: "rgba(var(--d), 0.15)",
                color: "rgba(var(--d), 1)",
              }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-display font-normal text-[14px] leading-[1.6] text-t1 whitespace-pre-wrap">
            {content || (
              <span className="text-t5 italic">(empty)</span>
            )}
          </p>
          {!readOnly && (
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setEditing(true);
                }}
                disabled={pending}
                className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border border-rule-2 text-t3 hover:text-t1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Edit
              </button>
              {!approved && (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={pending}
                  className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    borderColor: "rgba(var(--d), 0.7)",
                    background: "rgba(var(--d), 0.12)",
                    color: "rgba(var(--d), 1)",
                  }}
                >
                  {pending ? "…" : "Approve"}
                </button>
              )}
            </div>
          )}
          {error && (
            <div className="mt-2 font-display text-[12px] text-[#d4908a]">{error}</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Brand fit score badge ───────────────────────────────────────

function BrandFitBadge({ score }: { score: number }) {
  const band = score >= 80 ? "strong" : score >= 50 ? "partial" : "weak";
  return (
    <div
      className="rounded-md px-4 py-3 border-2 text-center shrink-0"
      style={{
        borderColor: "rgba(var(--d), 0.7)",
        background: "rgba(var(--d), 0.08)",
        minWidth: 90,
      }}
    >
      <div
        className="font-display font-bold text-[28px] leading-none"
        style={{ color: "rgba(var(--d), 1)" }}
      >
        {score}
      </div>
      <div
        className="font-mono text-[8.5px] tracking-[0.22em] uppercase mt-1"
        style={{ color: "rgba(var(--d), 0.85)" }}
      >
        brand fit · {band}
      </div>
    </div>
  );
}
