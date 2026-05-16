"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import type {
  BoilerV2LoadedState,
  BoilerV2VersionRow,
} from "@/lib/actions/boiler-v2";
import type { RendererProps } from "./registry";

/**
 * BOILER v2 Renderer — Phase 11D.4.
 *
 * Production port of the v5 prototype at Design/Phase-11-BOILER-v2/v5.html.
 * Founder approved May 15; backend ready May 16; this is the UI port.
 *
 * Three-column layout (per v5 spec):
 *   - LEFT (340px, collapsible): ORC chat panel (existing OrcPanel component;
 *     wired in by the workspace shell, not by this renderer)
 *   - CENTER (1fr): Design canvas. Toolbar (Flat Art / Mockup view toggle +
 *     Front/Back face toggle + version meta). Stage shows the active design's
 *     flat artwork from Cloudinary. Version strip across the bottom.
 *   - RIGHT (320px): Side panel. Colorway swatches → Active card → Palette
 *     Roles table → Design Spec → Action stack.
 *
 * This first turn ships the READ-ONLY skeleton:
 *   - Renders current state (active version's flat artwork + version strip
 *     + palette + spec).
 *   - View / face toggles work (client state).
 *   - Tier selector + color picker UI present but not wired to actions yet.
 *   - Mockup view shows SVG-illustrated fallback (Phase 11D.5c swaps for
 *     Dynamic Mockups API).
 *
 * Subsequent turns add:
 *   - 11D.4d: Interactive bits wired to server actions / Inngest events
 *   - 11D.4e: Realtime subscriptions on design_versions + boiler_state
 *
 * This renderer reads `boilerV2State` from props (loaded by the page via
 * `loadBoilerV2State()`). The BoilerSwitch dispatcher (Phase 11D.4c) picks
 * between this and the legacy `BoilerGallery` based on the feature flag.
 */

interface BoilerV2RendererProps extends RendererProps {
  /** Loaded by the page via loadBoilerV2State(). May be null when no
   *  generation has run yet (empty state). */
  boilerV2State: BoilerV2LoadedState | null;
}

// ─── State-machine helpers ───────────────────────────────────────────

type ViewMode = "flat" | "mockup";
type Face = "front" | "back";
type TierKey = "low" | "medium" | "high";

const TIER_LABELS: Record<TierKey, { label: string; cost: string }> = {
  low: { label: "Low", cost: "$0.006" },
  medium: { label: "Medium", cost: "$0.053" },
  high: { label: "High · Finalize", cost: "$0.211" },
};

// ─── Top-level component ─────────────────────────────────────────────

export function BoilerV2(props: BoilerV2RendererProps) {
  const { activeManifestation, boilerV2State } = props;

  // Guard: no manifestation selected (parent workspace)
  if (!activeManifestation) {
    return (
      <div className="rounded-md border border-rule-2 bg-wash-1 p-12 text-center">
        <div className="mb-3 font-mono text-[10px] tracking-[0.24em] text-t4 uppercase">
          BOILER · No manifestation
        </div>
        <div className="font-display text-t2 text-base">
          Pick a manifestation from the workspace selector to enter the BOILER canvas.
        </div>
      </div>
    );
  }

  // Empty state — no design_versions yet
  const hasAnyVersion = (boilerV2State?.visibleVersions.length ?? 0) > 0;
  if (!boilerV2State || !hasAnyVersion) {
    return <BoilerV2EmptyState shortcode={activeManifestation.shortcode} />;
  }

  return (
    <div className="grid h-[820px] grid-cols-[1fr_320px] gap-0 overflow-hidden rounded-md border border-rule-2 bg-ink-warm">
      {/* CENTER + RIGHT only — LEFT is the workspace's existing OrcPanel,
          wired in by the workspace shell at a higher level. */}
      <BoilerV2Canvas state={boilerV2State} />
      <BoilerV2SidePanel state={boilerV2State} />
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────

function BoilerV2EmptyState({ shortcode }: { shortcode: string }) {
  return (
    <div className="rounded-md border border-rule-2 bg-wash-1 p-12 text-center">
      <div className="mb-3 font-mono text-[10px] tracking-[0.24em] text-t4 uppercase">
        BOILER v2 · {shortcode}
      </div>
      <div className="mb-2 font-display text-t1 text-lg">No design yet</div>
      <div className="mb-6 mx-auto max-w-md font-display text-t3 text-sm leading-relaxed">
        Ask ORC to <code className="font-mono text-[12px] text-t1">generate the first draft</code> in the chat panel.
        ORC will run gpt-image-1 at low tier ($0.006) and put the result on the canvas.
      </div>
      <div className="mx-auto inline-flex items-center gap-2 rounded-sm border border-rule-2 bg-wash-2 px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-t4 uppercase">
        <span>BOILER · Awaiting first generation</span>
      </div>
    </div>
  );
}

// ─── Canvas (center column) ──────────────────────────────────────────

function BoilerV2Canvas({ state }: { state: BoilerV2LoadedState }) {
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [face, setFace] = useState<Face>("front");
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(
    state.activeVersion?.id ?? state.visibleVersions[0]?.id ?? null,
  );

  const currentVersion =
    state.visibleVersions.find((v) => v.id === currentVersionId) ??
    state.activeVersion ??
    state.visibleVersions[0] ??
    null;

  return (
    <section className="flex flex-col overflow-hidden bg-[#0a0a0a]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-rule-1 bg-black/20 px-5 py-3">
        <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
        <FaceToggle face={face} setFace={setFace} viewMode={viewMode} />
        <div className="flex-1" />
        <CanvasMeta version={currentVersion} />
      </div>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-8">
        {viewMode === "flat" ? (
          <FlatArtView version={currentVersion} face={face} />
        ) : (
          <MockupView version={currentVersion} />
        )}
      </div>

      {/* Version strip */}
      <VersionStrip
        versions={state.visibleVersions}
        currentVersionId={currentVersionId}
        finalizedVersionId={state.state?.finalizedVersionId ?? null}
        onPick={(id) => setCurrentVersionId(id)}
      />
    </section>
  );
}

// ─── Toolbar bits ────────────────────────────────────────────────────

function ViewToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
}) {
  return (
    <div className="flex gap-[2px] rounded-sm border border-rule-2 p-[2px]">
      {(["flat", "mockup"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setViewMode(m)}
          className={`rounded-[2px] px-3 py-1.5 font-mono text-[9.5px] tracking-[0.18em] uppercase ${
            viewMode === m ? "font-medium" : "text-t4 hover:text-t2"
          }`}
          style={
            viewMode === m
              ? {
                  color: "rgba(var(--d), 1)",
                  background: "rgba(var(--d), 0.14)",
                }
              : undefined
          }
        >
          {m === "flat" ? "Flat Art" : "Mockup"}
        </button>
      ))}
    </div>
  );
}

function FaceToggle({
  face,
  setFace,
  viewMode,
}: {
  face: Face;
  setFace: (f: Face) => void;
  viewMode: ViewMode;
}) {
  // In mockup view, both faces show side-by-side — hide the face toggle
  if (viewMode === "mockup") return null;
  return (
    <div className="flex gap-[2px] rounded-sm border border-rule-2 p-[2px]">
      {(["front", "back"] as const).map((f) => (
        <button
          key={f}
          onClick={() => setFace(f)}
          className={`rounded-[2px] px-3 py-1.5 font-mono text-[9.5px] tracking-[0.18em] uppercase ${
            face === f ? "bg-wash-2 text-t1" : "text-t4 hover:text-t2"
          }`}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

function CanvasMeta({ version }: { version: BoilerV2VersionRow | null }) {
  if (!version) return null;
  const verification =
    (version.compositionMeta as { verification?: { passed?: boolean; overall_score?: number } })
      .verification ?? null;
  return (
    <div className="font-mono text-[9.5px] tracking-[0.18em] text-t5 uppercase">
      <span>tier · </span>
      <span className="text-t2 font-medium">{version.tier}</span>
      <span className="ml-3">cost · </span>
      <span className="text-t2 font-medium">
        ${Number(version.costUsd ?? "0").toFixed(3)}
      </span>
      {verification && (
        <>
          <span className="ml-3">verify · </span>
          <span
            className="font-medium"
            style={{
              color: verification.passed
                ? "rgba(var(--d), 1)"
                : "rgba(140, 74, 40, 1)" /* RCD warm for fail */,
            }}
          >
            {verification.passed ? "PASS" : "FAIL"} {verification.overall_score}/100
          </span>
        </>
      )}
    </div>
  );
}

// ─── Stage content ───────────────────────────────────────────────────

function FlatArtView({
  version,
  face,
}: {
  version: BoilerV2VersionRow | null;
  face: Face;
}) {
  if (!version?.flatArtworkUrl) {
    return (
      <div className="rounded-sm border border-dashed border-rule-2 px-6 py-8 font-mono text-[10px] tracking-[0.2em] text-t5 uppercase">
        No flat artwork on this version.
      </div>
    );
  }

  // The Images API produces ONE image per call — front-only currently. Phase
  // 11D.4 follow-up: separate generate-back tool produces a sibling version
  // with face=back. For now: show the same artwork for both face toggles
  // and surface a small "back face pending" note on back.
  return (
    <div className="relative w-full max-w-[540px]" style={{ aspectRatio: "1 / 1.18" }}>
      <Image
        src={version.flatArtworkUrl}
        alt={`BOILER design version ${version.id} · ${face} face`}
        fill
        sizes="540px"
        className="object-contain"
        unoptimized // Cloudinary already serves optimized; skip Next's image pipeline
      />
      {face === "back" && (
        <div className="absolute bottom-2 right-2 rounded-sm bg-black/70 px-2 py-1 font-mono text-[9px] tracking-[0.14em] text-t4 uppercase">
          Back face pending — coming via separate generation
        </div>
      )}
    </div>
  );
}

function MockupView({ version }: { version: BoilerV2VersionRow | null }) {
  if (!version?.flatArtworkUrl) {
    return (
      <div className="rounded-sm border border-dashed border-rule-2 px-6 py-8 font-mono text-[10px] tracking-[0.2em] text-t5 uppercase">
        No mockup — generate a design first.
      </div>
    );
  }
  // Phase 11D.5c swaps this for a real Dynamic Mockups composite. For now:
  // SVG-illustrated tee with the design composited via CSS overlay.
  return (
    <div className="grid w-full max-w-[1080px] grid-cols-2 items-center gap-7">
      <SvgTeeMockup designUrl={version.flatArtworkUrl} face="front" />
      <SvgTeeMockup designUrl={version.flatArtworkUrl} face="back" />
    </div>
  );
}

function SvgTeeMockup({
  designUrl,
  face,
}: {
  designUrl: string;
  face: Face;
}) {
  return (
    <div className="relative" style={{ aspectRatio: "1 / 1.22" }}>
      {/* Simple flat-lay tee shape — replaced by DM API photo-real render in 11D.5c */}
      <svg
        viewBox="0 0 540 660"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id={`mu-shadow-${face}`} x="-15%" y="-10%" width="130%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="13" />
            <feOffset dx="6" dy="22" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.42" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter={`url(#mu-shadow-${face})`}>
          {/* Refined adult tee silhouette — single closed path */}
          <path
            d="M 60 138 Q 50 230 96 252 L 130 245 L 130 246 Q 124 252 122 256 L 118 612 Q 158 624 270 624 Q 382 624 422 612 L 418 256 Q 416 252 410 245 L 444 245 Q 490 230 480 138 Q 395 92 345 90 Q 308 116 270 116 Q 232 116 195 90 Q 145 92 60 138 Z"
            fill="#5A2020"
          />
        </g>
      </svg>
      {/* Design composite overlay */}
      <div
        className="absolute inset-x-[18%] top-[27%] bottom-[18%]"
        style={{
          backgroundImage: `url(${designUrl})`,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          opacity: 0.92,
        }}
      />
      <div className="absolute -bottom-5 left-0 right-0 text-center font-mono text-[9.5px] tracking-[0.22em] text-t5 uppercase">
        {face}
      </div>
    </div>
  );
}

// ─── Version strip (canvas bottom) ───────────────────────────────────

function VersionStrip({
  versions,
  currentVersionId,
  finalizedVersionId,
  onPick,
}: {
  versions: BoilerV2VersionRow[];
  currentVersionId: string | null;
  finalizedVersionId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 overflow-x-auto border-t border-rule-1 bg-black/20 px-5 py-3">
      <span className="flex-shrink-0 font-mono text-[9px] tracking-[0.22em] text-t5 uppercase mr-1">
        History
      </span>
      {versions.length === 0 && (
        <span className="font-mono text-[10px] text-t5">(no versions yet)</span>
      )}
      {versions
        .slice()
        .reverse() // chronological L→R
        .map((v, idx) => {
          const isCurrent = v.id === currentVersionId;
          const isFinalized = v.id === finalizedVersionId;
          const tierBadge =
            v.tier === "low" ? "L" : v.tier === "medium" ? "M" : "H";
          return (
            <button
              key={v.id}
              onClick={() => onPick(v.id)}
              className="relative h-14 w-12 flex-shrink-0 cursor-pointer overflow-hidden rounded-sm border transition-all hover:-translate-y-px"
              style={{
                backgroundColor:
                  (v.paletteRoles?.garment_base as string) ?? "#5A2020",
                borderColor: isCurrent
                  ? "rgba(var(--d), 0.8)"
                  : "rgba(242, 239, 233, 0.16)",
                boxShadow: isCurrent
                  ? "0 0 0 1px rgba(var(--d), 0.3)"
                  : undefined,
              }}
              title={`v${idx + 1} · tier=${v.tier} · ${new Date(v.generatedAt).toLocaleTimeString()}`}
            >
              <span className="absolute right-1 top-1 rounded-[1px] bg-black/55 px-1 py-px font-mono text-[7px] tracking-wider text-white/80">
                {tierBadge}
              </span>
              {v.flatArtworkUrl && (
                <Image
                  src={v.flatArtworkUrl}
                  alt={`Version ${idx + 1} thumbnail`}
                  fill
                  sizes="48px"
                  unoptimized
                  className="object-cover opacity-90"
                />
              )}
              <span className="absolute bottom-1 left-1.5 font-mono text-[7.5px] tracking-tight text-white/85">
                v{idx + 1}
              </span>
              {isFinalized && (
                <span
                  className="absolute inset-0 rounded-sm border-2"
                  style={{ borderColor: "rgba(var(--d), 0.9)" }}
                />
              )}
            </button>
          );
        })}
    </div>
  );
}

// ─── Side panel (right column) ───────────────────────────────────────

function BoilerV2SidePanel({ state }: { state: BoilerV2LoadedState }) {
  const palette =
    state.state?.activePaletteRoles ??
    state.activeVersion?.paletteRoles ??
    {};
  const garmentHex = (palette as Record<string, string>).garment_base ?? "#5A2020";

  return (
    <aside className="flex flex-col overflow-y-auto border-l border-rule-1 bg-black/10">
      {/* Colorway header */}
      <div className="border-b border-rule-1 px-5 py-4">
        <SectionLabel>Colorway</SectionLabel>
        <div className="mb-1 font-display text-t1 text-[13.5px] font-medium">
          Active
        </div>
        <div className="font-mono text-[10px] tracking-[0.04em] text-t4">
          {garmentHex} · garment base
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="h-6 w-12 rounded-sm border border-rule-2"
            style={{ backgroundColor: garmentHex }}
          />
        </div>
      </div>

      {/* Palette · Roles table */}
      <div className="border-b border-rule-1 px-5 py-4">
        <SectionLabel>
          Palette · Roles
          <span className="ml-2 text-[8.5px] tracking-[0.08em] text-t6 normal-case">
            click hex or chip to edit
          </span>
        </SectionLabel>
        <PaletteRolesTable palette={palette as Record<string, string>} />
      </div>

      {/* Design spec */}
      <div className="border-b border-rule-1 px-5 py-4">
        <SectionLabel>Design Spec</SectionLabel>
        <DesignSpecTable version={state.activeVersion} />
      </div>

      {/* Action stack */}
      <div className="border-b border-rule-1 px-5 py-4">
        <SectionLabel>Actions</SectionLabel>
        <ActionStack state={state} />
      </div>

      {/* Verifier verdict (read-only display of current active version's verdict) */}
      {state.activeVersion && (
        <VerifierVerdict version={state.activeVersion} />
      )}
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 font-mono text-[9px] tracking-[0.24em] text-t5 uppercase">
      {children}
    </div>
  );
}

const PALETTE_ROLE_LABELS: Record<string, string> = {
  garment_base: "Garment base",
  ring_outer: "Ring outer edge",
  ring_inner: "Ring inner glow",
  front_ink: "Front ink",
  back_ink: "Back ink",
};

function PaletteRolesTable({ palette }: { palette: Record<string, string> }) {
  const roles = useMemo(
    () => ["garment_base", "ring_outer", "ring_inner", "front_ink", "back_ink"],
    [],
  );
  return (
    <div>
      {roles.map((role) => {
        const hex = palette[role] ?? "—";
        const label = PALETTE_ROLE_LABELS[role];
        return (
          <div
            key={role}
            className="flex items-center gap-2.5 border-b border-rule-1 py-1.5 last:border-b-0"
          >
            <button
              className="h-3.5 w-3.5 flex-shrink-0 rounded-[2px] border border-rule-2 transition-transform hover:scale-[1.15]"
              style={{ backgroundColor: hex }}
              title={`Edit ${label}`}
              // TODO 11D.4d: open color popover, call boiler_v2_set_color
              disabled
            />
            <div className="flex-1 font-mono text-[9.5px] tracking-[0.14em] text-t4 uppercase">
              {label}
            </div>
            <button
              className="rounded-[2px] border border-transparent px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-t2 transition-all hover:border-rule-2 hover:bg-wash-1 hover:text-t1"
              title={`Edit ${label}`}
              // TODO 11D.4d
              disabled
            >
              {hex.toUpperCase()}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DesignSpecTable({ version }: { version: BoilerV2VersionRow | null }) {
  if (!version) return null;
  const meta = version.compositionMeta;
  const rows: Array<[string, string]> = [
    ["Silhouette", "Tee · classic"],
    ["Print", `${meta.print_spec?.method ?? "screen"} · ${meta.print_spec?.separations ?? 2} separations`],
    [
      "Bleed",
      meta.print_spec?.full_bleed
        ? "Full · sleeves additive"
        : "Anchored",
    ],
    [
      "Type",
      meta.typography
        ? `${meta.typography.front_weight ?? "—"} · ${meta.typography.back_weight ?? "—"}`
        : "—",
    ],
    ["Tier", version.tier],
    ["Model", "gpt-image-1"],
  ];
  return (
    <div className="font-mono text-[10px] tracking-[0.06em]">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-center gap-2.5 border-b border-rule-1 py-1.5 last:border-b-0"
        >
          <span className="w-[84px] flex-shrink-0 font-mono text-[9px] tracking-[0.16em] text-t5 uppercase">
            {k}
          </span>
          <span className="text-t2">{v}</span>
        </div>
      ))}
    </div>
  );
}

function ActionStack({ state }: { state: BoilerV2LoadedState }) {
  const hasActive = !!state.activeVersion;
  const hasFinalized = !!state.finalizedVersion;
  const finalized = state.state?.finalized ?? false;

  return (
    <div className="flex flex-col gap-2">
      <button
        disabled={!hasActive || finalized}
        // TODO 11D.4d: fire boiler.v2.generate with mode=finalize
        className="cursor-pointer rounded-sm border-[1.5px] px-3 py-3 font-mono text-[10px] tracking-[0.2em] uppercase transition-all disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: "rgba(var(--d), 0.75)",
          background: "rgba(var(--d), 0.14)",
          color: "rgba(var(--d), 1)",
        }}
      >
        Finalize · High pass
      </button>
      <button
        disabled={!hasFinalized || finalized}
        // TODO 11D.4d: call boiler_v2_approve_and_advance
        className="cursor-pointer rounded-sm border border-rule-2 px-3 py-2.5 font-mono text-[9.5px] tracking-[0.18em] text-t3 uppercase transition-all hover:border-rule-3 hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {finalized ? "Approved · advanced to ENGINE" : "Approve & advance to ENGINE"}
      </button>
      <button
        disabled={!hasActive}
        // TODO 11D.4d: fire boiler.v2.generate with mode=branch
        className="cursor-pointer rounded-sm border border-rule-2 px-3 py-2.5 font-mono text-[9.5px] tracking-[0.18em] text-t3 uppercase transition-all hover:border-rule-3 hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Branch new version
      </button>
      <button
        disabled={!hasActive || finalized}
        // TODO 11D.4d: call boiler_v2_discard_version (guarded — can't discard active)
        className="cursor-pointer rounded-sm border border-rule-2 px-3 py-2.5 font-mono text-[9.5px] tracking-[0.18em] text-t3 uppercase transition-all hover:border-rule-3 hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Discard current version
      </button>
      <div className="mt-1 font-mono text-[9.5px] leading-relaxed tracking-[0.04em] text-t5">
        Finalize re-runs the active design at High tier ($0.211) for the canonical artwork. Approve advances to ENGINE Step 1.
      </div>
    </div>
  );
}

function VerifierVerdict({ version }: { version: BoilerV2VersionRow }) {
  const v = (
    version.compositionMeta as {
      verification?: {
        passed?: boolean;
        overall_score?: number;
        text_legibility?: { score: number };
        palette_adherence?: { score: number };
        composition?: { score: number };
        conceptual_fit?: { score: number };
        refinement_suggestions?: string[];
      };
    }
  ).verification;

  if (!v) {
    return (
      <div className="border-b border-rule-1 px-5 py-4">
        <SectionLabel>Verifier</SectionLabel>
        <div className="font-mono text-[10px] text-t5">
          Not run (verifier unavailable or skipped).
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-rule-1 px-5 py-4">
      <SectionLabel>
        Verifier ·{" "}
        <span
          className="font-medium"
          style={{
            color: v.passed
              ? "rgba(var(--d), 1)"
              : "rgba(140, 74, 40, 1)",
          }}
        >
          {v.passed ? "PASSED" : "FAILED"} · {v.overall_score}/100
        </span>
      </SectionLabel>
      <div className="space-y-1 font-mono text-[10px] tracking-[0.04em] text-t3">
        <SubScore label="Text legibility" score={v.text_legibility?.score ?? 0} />
        <SubScore label="Palette adherence" score={v.palette_adherence?.score ?? 0} />
        <SubScore label="Composition" score={v.composition?.score ?? 0} />
        <SubScore label="Conceptual fit" score={v.conceptual_fit?.score ?? 0} />
      </div>
      {v.refinement_suggestions && v.refinement_suggestions.length > 0 && (
        <div className="mt-3 border-t border-rule-1 pt-3">
          <div className="mb-1.5 font-mono text-[9px] tracking-[0.22em] text-t5 uppercase">
            Suggestions
          </div>
          <ul className="space-y-0.5 font-mono text-[10px] leading-snug text-t3">
            {v.refinement_suggestions.slice(0, 4).map((s, i) => (
              <li key={i} className="before:mr-1 before:content-['—']">
                {" "}
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SubScore({ label, score }: { label: string; score: number }) {
  const color =
    score >= 70
      ? "rgba(var(--d), 1)"
      : score >= 50
        ? "rgba(242, 239, 233, 0.92)"
        : "rgba(140, 74, 40, 1)";
  return (
    <div className="flex items-center justify-between">
      <span className="text-t4">{label}</span>
      <span className="font-medium" style={{ color }}>
        {score}/100
      </span>
    </div>
  );
}
