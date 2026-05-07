"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RendererProps } from "./registry";
import {
  approveBriefSection,
  approveFullBrief,
  dismissBrief,
  editBriefSection,
  regenerateFullBrief,
} from "@/lib/actions/furnace";
import {
  REQUIRED_SECTIONS,
  SECTION_BOUNDS,
  type SectionName,
} from "@/lib/actions/furnace-shared";

/**
 * FURNACE Brief Renderer — Phase 10D + Phase 10.4 layout revision.
 *
 * Phase 10D first-ship laid the brief out as a 2-column card grid where
 * every section's approve/edit affordance was visually as loud as the
 * design content — the brief read like a checklist, not a brief. Phase
 * 10.4 (this revision) flips the layout to a long-scroll document with
 * a sticky left rail nav. Section content reads first; the per-section
 * actions become small inline text-link affordances under each section.
 *
 * Core surfaces (PENDING state):
 *   - Top hero — brand-fit badge + working title + revision counter
 *   - Cascade banner — when the parent STOKER framing was edited past
 *     gate; offers regenerate CTA
 *   - Body 2-col grid:
 *     - Sticky left rail nav: 10 sections with status pips, click to
 *       smooth-scroll, current section highlighted via scroll-spy
 *     - Document: section flow (H2 with title/status + body prose +
 *       inline actions row), then a bottom "Approve all + advance" CTA
 *
 * APPROVED state inherits the same long-scroll layout, read-only (no
 * inline action affordances; the rail's "Approve all" CTA hides).
 *
 * REFUSED / REJECTED-BY-FOUNDER / NO-MANIFESTATION / PROCESSING states
 * keep their simpler banner layouts — there's nothing to navigate when
 * the brief either doesn't exist or won't.
 *
 * No schema or server-action changes — pure UI rewrite. Every existing
 * mutation (approveBriefSection / approveFullBrief / editBriefSection /
 * dismissBrief / regenerateFullBrief) is wired identically; allowMutation
 * gating, cascade flag, and best-effort memory writes all unchanged.
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
  designDirection: "Design direction",
  tactileIntent: "Tactile intent",
  moodAndTone: "Mood + tone",
  compositionApproach: "Composition approach",
  colorTreatment: "Color treatment",
  typographicTreatment: "Typographic treatment",
  artDirection: "Art direction",
  referenceAnchors: "Reference anchors",
  placementIntent: "Placement intent",
  voiceInVisual: "Voice in visual",
};

/** Section number padding for the H2 marker (01, 02, …, 10). */
function sectionNum(i: number): string {
  return (i + 1).toString().padStart(2, "0");
}

/** DOM id for a section anchor — used by the rail nav for scroll-to. */
function sectionAnchorId(section: SectionName): string {
  return `furnace-section-${section}`;
}

export function FurnaceBrief(props: RendererProps) {
  const { activeManifestation, signal } = props;

  // FURNACE only runs on manifestation children; raw signals don't have
  // briefs. Show an empty state for the parent view.
  if (signal.parentSignalId === null && !activeManifestation) {
    return <NoActiveManifestation />;
  }

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
  const stokerHasCascade = manifestation.stokerHasCascade === true;

  // Refused state — brief was generated but FURNACE refused (brand-fit < 50)
  if (content.refused === true) {
    return (
      <FurnaceRefused
        briefId={briefDetail.id}
        brandFitScore={content.brandFitScore ?? 0}
        refusalReason={content.refusalReason ?? "(no rationale provided)"}
        manifestationShortcode={manifestation.shortcode}
        stokerHasCascade={stokerHasCascade}
      />
    );
  }

  // Approved — read-only long-scroll view
  if (status === "APPROVED") {
    return (
      <FurnaceApproved
        briefId={briefDetail.id}
        content={content}
        manifestationShortcode={manifestation.shortcode}
        stokerHasCascade={stokerHasCascade}
      />
    );
  }

  // Rejected — founder dismissed the brief; offer regen affordance
  if (status === "REJECTED") {
    return (
      <FurnaceRejectedByFounder
        briefId={briefDetail.id}
        manifestationShortcode={manifestation.shortcode}
        stokerHasCascade={stokerHasCascade}
      />
    );
  }

  // Default state: PENDING — long-scroll document for review
  return (
    <FurnaceBriefReview
      briefId={briefDetail.id}
      content={content}
      sectionApprovals={
        sectionApprovals ??
        ((briefDetail as unknown) as { sectionApprovals?: SectionApprovals })
          .sectionApprovals ??
        {}
      }
      manifestationShortcode={manifestation.shortcode}
      revisionsCount={briefDetail.revisionsCount}
      stokerHasCascade={stokerHasCascade}
    />
  );
}

// ─── Empty / processing state components ─────────────────────────

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
  stokerHasCascade,
}: {
  briefId: string;
  brandFitScore: number;
  refusalReason: string;
  manifestationShortcode: string;
  stokerHasCascade: boolean;
}) {
  return (
    <div className="py-12 px-7">
      {stokerHasCascade && (
        <CascadeBanner briefId={briefId} variant="actionable" />
      )}
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

function FurnaceRejectedByFounder({
  briefId,
  manifestationShortcode,
  stokerHasCascade,
}: {
  briefId: string;
  manifestationShortcode: string;
  stokerHasCascade: boolean;
}) {
  return (
    <div className="py-12 px-7">
      {stokerHasCascade && (
        <CascadeBanner briefId={briefId} variant="actionable" />
      )}
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

// ─── Approved state — long-scroll, read-only ─────────────────────

function FurnaceApproved({
  briefId,
  content,
  manifestationShortcode,
  stokerHasCascade,
}: {
  briefId: string;
  content: BriefContent;
  manifestationShortcode: string;
  stokerHasCascade: boolean;
}) {
  // Approved state has no per-section actions, so the nav rail's pip
  // state is "all approved" and there's no Approve-all CTA. The rest
  // of the layout — sticky rail + scroll-spy + section flow — is the
  // same as the review state, just with `readOnly` flowed through.
  const allApproved = useMemo<SectionApprovals>(
    () =>
      Object.fromEntries(
        REQUIRED_SECTIONS.map((s) => [
          s,
          { approved: true, approvedAt: "", approvedBy: "" },
        ]),
      ),
    [],
  );

  return (
    <div className="py-8 px-7">
      {stokerHasCascade && <CascadeBanner briefId={briefId} variant="readonly" />}

      <ApprovedHero
        manifestationShortcode={manifestationShortcode}
        score={content.brandFitScore ?? 0}
        rationale={content.brandFitRationale ?? null}
      />

      <BriefBody
        briefId={briefId}
        content={content}
        sectionApprovals={allApproved}
        readOnly
      />
    </div>
  );
}

function ApprovedHero({
  manifestationShortcode,
  score,
  rationale,
}: {
  manifestationShortcode: string;
  score: number;
  rationale: string | null;
}) {
  return (
    <div className="bg-wash-1 border border-rule-1 rounded-md px-6 py-5 mb-7 flex items-center justify-between gap-6">
      <div className="flex items-center gap-6">
        <BrandFitBadge score={score} />
        <div>
          <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-1">
            FURNACE · Brief approved · advancing to BOILER
          </div>
          <div className="font-display font-semibold text-base text-t1 leading-tight">
            {manifestationShortcode}
          </div>
          {rationale && (
            <div className="font-display text-[13.5px] text-t3 mt-1.5 max-w-xl leading-[1.5]">
              {rationale}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Pending review — the new long-scroll document layout ────────

function FurnaceBriefReview({
  briefId,
  content,
  sectionApprovals,
  manifestationShortcode,
  revisionsCount,
  stokerHasCascade,
}: {
  briefId: string;
  content: BriefContent;
  sectionApprovals: SectionApprovals;
  manifestationShortcode: string;
  revisionsCount: number;
  stokerHasCascade: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const approvedCount = REQUIRED_SECTIONS.filter(
    (s) => sectionApprovals[s]?.approved === true,
  ).length;
  const allSectionsApproved = approvedCount === REQUIRED_SECTIONS.length;

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
      {stokerHasCascade && (
        <CascadeBanner briefId={briefId} variant="actionable" />
      )}

      {/* Top hero — brand-fit badge + working title + revision meta + dismiss */}
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
              Revision {revisionsCount + 1} · {approvedCount}/
              {REQUIRED_SECTIONS.length} sections approved
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

      {/* Body — sticky left rail + scrolling document */}
      <BriefBody
        briefId={briefId}
        content={content}
        sectionApprovals={sectionApprovals}
        readOnly={false}
        onApproveAll={handleApproveAll}
        approveAllPending={pending}
        approveAllDisabled={pending || allSectionsApproved}
      />

      {/* End-of-document CTA — same Approve-all button, mirrored at the
          bottom for users who scroll past the rail. */}
      <div className="mt-10 pt-6 border-t border-rule-1 flex items-center gap-4">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-t4">
          {approvedCount} of {REQUIRED_SECTIONS.length} sections approved · revision{" "}
          {revisionsCount + 1}
        </div>
        <button
          type="button"
          onClick={handleApproveAll}
          disabled={pending || allSectionsApproved}
          className="ml-auto font-mono text-[10.5px] tracking-[0.18em] uppercase px-5 py-3 rounded-sm border-2 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-40 disabled:cursor-not-allowed"
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

// ─── Body — 2-col grid: sticky rail + scrolling document ─────────

function BriefBody({
  briefId,
  content,
  sectionApprovals,
  readOnly,
  onApproveAll,
  approveAllPending,
  approveAllDisabled,
}: {
  briefId: string;
  content: BriefContent;
  sectionApprovals: SectionApprovals;
  readOnly: boolean;
  onApproveAll?: () => void;
  approveAllPending?: boolean;
  approveAllDisabled?: boolean;
}) {
  const sectionIds = useMemo(
    () => REQUIRED_SECTIONS.map((s) => sectionAnchorId(s)),
    [],
  );
  const activeId = useScrollSpy(sectionIds);

  function handleNavClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* Sticky left rail */}
      <SectionNavRail
        sectionApprovals={sectionApprovals}
        activeAnchorId={activeId}
        onNavClick={handleNavClick}
        readOnly={readOnly}
        onApproveAll={onApproveAll}
        approveAllPending={approveAllPending}
        approveAllDisabled={approveAllDisabled}
      />

      {/* Document — section flow */}
      <div className="min-w-0">
        {REQUIRED_SECTIONS.map((section, i) => {
          const sectionContent = (content[section] ?? "") as string;
          const approved = sectionApprovals[section]?.approved === true;
          return (
            <SectionRow
              key={section}
              index={i}
              section={section}
              content={sectionContent}
              approved={approved}
              briefId={briefId}
              readOnly={readOnly}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Sticky left rail nav ────────────────────────────────────────

function SectionNavRail({
  sectionApprovals,
  activeAnchorId,
  onNavClick,
  readOnly,
  onApproveAll,
  approveAllPending,
  approveAllDisabled,
}: {
  sectionApprovals: SectionApprovals;
  activeAnchorId: string;
  onNavClick: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  readOnly: boolean;
  onApproveAll?: () => void;
  approveAllPending?: boolean;
  approveAllDisabled?: boolean;
}) {
  const approvedCount = REQUIRED_SECTIONS.filter(
    (s) => sectionApprovals[s]?.approved === true,
  ).length;

  return (
    // top-[100px] clears the workspace's sticky tab strip + manifestation
    // selector row (~96px combined). z-1 keeps the rail above the
    // document but below the workspace's own sticky strip.
    <aside className="hidden lg:block sticky top-[100px] self-start max-h-[calc(100dvh-140px)] overflow-y-auto pr-2">
      <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t5 mb-3 pl-3">
        FURNACE brief · {approvedCount} of {REQUIRED_SECTIONS.length} approved
      </div>
      <nav className="border-l border-rule-1 -ml-px">
        {REQUIRED_SECTIONS.map((section) => {
          const id = sectionAnchorId(section);
          const approved = sectionApprovals[section]?.approved === true;
          const isCurrent = activeAnchorId === id;
          return (
            <a
              key={section}
              href={`#${id}`}
              onClick={(e) => onNavClick(e, id)}
              className={`flex items-center gap-3 py-2 pl-3 pr-3 transition-colors duration-150 border-l-2 -ml-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 ${
                isCurrent
                  ? "text-t1 bg-wash-2"
                  : "text-t3 hover:text-t1 hover:bg-wash-1 border-transparent"
              }`}
              style={
                isCurrent
                  ? {
                      borderLeftColor: "rgba(var(--d), 1)",
                    }
                  : undefined
              }
            >
              <span
                className="inline-block rounded-full shrink-0"
                style={{
                  width: 9,
                  height: 9,
                  background: approved
                    ? "rgba(var(--d), 0.85)"
                    : "transparent",
                  border: approved
                    ? "1.5px solid rgba(var(--d), 0.85)"
                    : "1.5px solid var(--color-rule-3)",
                }}
                aria-label={approved ? "Approved" : "Pending"}
              />
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase flex-1 leading-tight">
                {SECTION_LABELS[section]}
              </span>
            </a>
          );
        })}
      </nav>

      {!readOnly && onApproveAll && (
        <div className="mt-5 pl-3">
          <button
            type="button"
            onClick={onApproveAll}
            disabled={approveAllDisabled}
            className="w-full font-mono text-[9.5px] tracking-[0.18em] uppercase px-3 py-2.5 rounded-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              borderColor: "rgba(var(--d), 0.7)",
              background: "rgba(var(--d), 0.12)",
              color: "rgba(var(--d), 1)",
            }}
          >
            {approveAllPending
              ? "Approving…"
              : approveAllDisabled
                ? "All approved"
                : "Approve all + advance →"}
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── Section row — flow element, no card chrome ──────────────────

function SectionRow({
  index,
  section,
  content,
  approved,
  briefId,
  readOnly,
}: {
  index: number;
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
  const charCount = editing ? draft.length : content.length;
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
    <article
      id={sectionAnchorId(section)}
      // scroll-margin-top ensures `scrollIntoView` clears the workspace's
      // sticky tab strip + manifestation selector (~96px) when the rail
      // navs the user to a section. Without this, the section header
      // would land partly hidden behind the strip.
      className="mb-12 scroll-mt-[112px]"
    >
      <header className="flex items-baseline gap-4 pb-3 mb-4 border-b border-rule-1">
        <span className="font-mono text-[10px] tracking-[0.22em] text-t5 w-7 shrink-0 leading-none">
          {sectionNum(index)}
        </span>
        <h2 className="font-display font-semibold text-[18px] text-t1 leading-tight tracking-[0.005em]">
          {SECTION_LABELS[section]}
        </h2>
        <span
          className="ml-auto inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.18em] uppercase shrink-0"
          style={{
            color: approved ? "rgba(var(--d), 1)" : "var(--color-t4)",
          }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 8,
              height: 8,
              background: approved ? "rgba(var(--d), 0.85)" : "transparent",
              border: approved ? "none" : "1.5px solid var(--color-rule-3)",
            }}
          />
          {approved ? "Approved" : "Pending"}
        </span>
      </header>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="w-full bg-black/30 border border-rule-2 text-t1 font-display font-normal text-[14.5px] leading-[1.65] px-4 py-3 rounded-sm outline-none focus:border-[rgba(var(--d),0.7)] resize-vertical max-w-3xl"
          />
          <div className="mt-1 h-[2px] bg-rule-1 rounded-sm overflow-hidden max-w-3xl">
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
          <div className="mt-1 font-mono text-[9.5px] tracking-[0.04em] text-t5">
            {charCount} / {bounds.max} chars · min {bounds.min}
            {charOverBudget && (
              <span className="ml-2 text-[#d4908a]">
                · out of bounds, save will fail
              </span>
            )}
          </div>
          {error && (
            <div className="mt-2 font-display text-[12.5px] text-[#d4908a]">
              {error}
            </div>
          )}
          <div className="mt-3 flex gap-3 max-w-3xl">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(content);
                setError(null);
              }}
              disabled={pending}
              className="font-mono text-[10px] tracking-[0.16em] uppercase text-t4 hover:text-t2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 px-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={pending || charOverBudget}
              className="ml-auto font-mono text-[10px] tracking-[0.16em] uppercase px-4 py-2 rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                borderColor: "rgba(var(--d), 0.7)",
                background: "rgba(var(--d), 0.15)",
                color: "rgba(var(--d), 1)",
              }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p
            className="font-display font-normal text-[15.5px] leading-[1.65] text-t1 max-w-3xl mb-4 whitespace-pre-wrap"
            style={{
              opacity: approved ? 0.92 : 1,
            }}
          >
            {content || (
              <span className="text-t5 italic font-normal">(empty)</span>
            )}
          </p>
          {!readOnly && (
            <div className="flex items-center gap-5 font-mono text-[10px] tracking-[0.16em] uppercase">
              {!approved && (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={pending}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 px-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    color: "rgba(var(--d), 0.95)",
                    borderBottom: "1px dashed rgba(var(--d), 0.5)",
                  }}
                >
                  {pending ? "…" : "Approve"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setEditing(true);
                }}
                disabled={pending}
                className="cursor-pointer text-t4 hover:text-t2 border-b border-dashed border-rule-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 px-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Edit
              </button>
              <button
                type="button"
                disabled
                title="Phase 10E ORC tool integration; ask ORC in the panel for now"
                className="cursor-not-allowed text-t5 border-b border-dashed border-rule-3 px-1 opacity-70"
              >
                Ask ORC to redo
              </button>
              <span className="ml-auto text-t5 text-[9.5px] tracking-[0.04em]">
                {content.length} / {bounds.max} chars
              </span>
            </div>
          )}
          {error && (
            <div className="mt-2 font-display text-[12.5px] text-[#d4908a]">
              {error}
            </div>
          )}
        </>
      )}
    </article>
  );
}

// ─── Cascade banner — Phase 10F (unchanged from prior version) ───
//
// Surfaces when the parent STOKER manifestation framing was edited
// past the IN_STOKER gate (one or more revisions on the STOKER row
// have cascade=true). The brief in front of the user was generated
// against an older framing.
//
// Two variants:
//   - "actionable" (PENDING / REJECTED briefs): includes a regenerate
//     CTA that prompts for a reason and calls regenerateFullBrief.
//   - "readonly" (APPROVED briefs): warning only. Regenerating an
//     approved brief would orphan downstream BOILER output, so we
//     surface awareness without an action.

function CascadeBanner({
  briefId,
  variant,
}: {
  briefId: string;
  variant: "actionable" | "readonly";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRegenerate() {
    const reason = window.prompt(
      "Why are you regenerating? (4-600 chars — e.g. 'manifestation framing was rewritten, need brief against new tension axis')",
      "Manifestation framing changed since this brief was generated — regenerating against updated framing.",
    );
    if (!reason || reason.trim().length < 4) return;
    setError(null);
    startTransition(async () => {
      try {
        await regenerateFullBrief({ briefId, reason: reason.trim() });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to regenerate brief.");
      }
    });
  }

  return (
    <div
      className="mb-6 px-5 py-4 rounded-md border-2"
      style={{
        borderColor: "rgba(212, 144, 138, 0.55)",
        background: "rgba(212, 144, 138, 0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="flex-1 min-w-0">
          <div
            className="font-mono text-[9px] tracking-[0.24em] uppercase mb-1.5"
            style={{ color: "rgba(212, 144, 138, 0.95)" }}
          >
            CASCADE · framing edited past gate
          </div>
          <div className="font-display font-medium text-[14.5px] leading-[1.55] text-t1">
            {variant === "actionable"
              ? "The manifestation framing was rewritten after STOKER was approved. This brief was generated against the older framing."
              : "The manifestation framing was rewritten after this brief was approved. The approved brief reflects the older framing — regenerating would orphan the downstream BOILER output."}
          </div>
          {error && (
            <div className="mt-2 font-display text-[12px] text-[#d4908a]">{error}</div>
          )}
        </div>
        {variant === "actionable" && (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={pending}
            className="font-mono text-[10px] tracking-[0.18em] uppercase px-4 py-2.5 rounded-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            style={{
              borderColor: "rgba(212, 144, 138, 0.7)",
              background: "rgba(212, 144, 138, 0.12)",
              color: "rgba(212, 144, 138, 1)",
            }}
          >
            {pending ? "Regenerating…" : "Regenerate brief"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Brand-fit score badge (unchanged) ───────────────────────────

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

// ─── Scroll-spy hook ─────────────────────────────────────────────
//
// Tracks which of the rendered section anchors is currently the
// "active" one in the workspace's scroll viewport. Used by the rail
// nav to highlight the current section as the founder scrolls.
//
// Implementation notes:
//   - The engine-room layout uses `h-full overflow-auto` on its outer
//     wrapper, so the scroll container is NOT the document/viewport.
//     The hook walks up from the first section to find the closest
//     scrollable ancestor and uses it as IntersectionObserver root.
//   - rootMargin -120px from top (sticky strip clearance) and -45%
//     from bottom (so a section is considered "active" when it sits
//     in roughly the upper third of the viewport, matching reading
//     focus rather than first-pixel-visible).
//   - When multiple sections are visible at once, picks the one
//     closest to the top (most likely the one the user is reading).

function useScrollSpy(sectionIds: string[]): string {
  const [activeId, setActiveId] = useState<string>(sectionIds[0] ?? "");

  // Stable cache key for the dependency array — changes only when
  // the actual list of ids changes, not on every render.
  const idsKey = sectionIds.join("|");

  // Keep a ref to the latest activeId so the observer callback can
  // read it without re-creating itself when the active section
  // changes (which would re-attach the observer every scroll tick).
  const lastReportedRef = useRef<string>(activeId);

  useEffect(() => {
    if (sectionIds.length === 0) return;

    // Find scroll container — first ancestor of the first section
    // that has overflow-y: auto/scroll. Falls back to null (viewport).
    const firstSection = document.getElementById(sectionIds[0]);
    let scrollRoot: Element | null = null;
    let walker: HTMLElement | null = firstSection?.parentElement ?? null;
    while (walker) {
      const style = getComputedStyle(walker);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        scrollRoot = walker;
        break;
      }
      walker = walker.parentElement;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // Maintain a snapshot of all observed entries' visibility +
        // top positions. Pick the topmost one currently intersecting.
        const intersecting = entries.filter((e) => e.isIntersecting);
        if (intersecting.length === 0) return;

        intersecting.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        );
        const topId = intersecting[0].target.id;
        if (topId !== lastReportedRef.current) {
          lastReportedRef.current = topId;
          setActiveId(topId);
        }
      },
      {
        root: scrollRoot,
        // -120px from top clears the workspace's sticky tab strip;
        // -45% from bottom narrows the "active" zone to the upper
        // half + reading-focus region.
        rootMargin: "-120px 0px -45% 0px",
        threshold: 0,
      },
    );

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
    // We deliberately depend only on the ids list, not on activeId,
    // to avoid re-attaching the observer every time the active section
    // changes during scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return activeId;
}
