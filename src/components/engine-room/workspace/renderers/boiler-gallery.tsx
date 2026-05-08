"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { RendererProps } from "./registry";

/**
 * BOILER Gallery Renderer — Phase 11D.
 *
 * Reads `activeManifestation.outputs.BOILER` (populated by the page server
 * component once the BOILER Inngest handler has written its row). Renders
 * 5 distinct states:
 *
 *   1. NO MANIFESTATION — parent workspace with no decade selected. Asks
 *      founder to pick a manifestation from the workspace selector.
 *   2. PROCESSING — BOILER row not yet written (handler is mid-flight or
 *      hasn't fired). Breathing dot + explanatory copy.
 *   3. REFUSED — content.refused === true OR status === REJECTED. Shows
 *      the refusalReason with force-advance / dismiss copy (Phase 11E
 *      ORC tools wire actual buttons).
 *   4. PENDING / GALLERY — 4 concept variants, founder picks one. Each
 *      variant renders the imageDataUri (or hosted URL once Phase 11C.1
 *      lands), the register tag, the rationale, the recommended model,
 *      and a "Pick this concept" CTA.
 *   5. APPROVED — multi-angle viewer (Path A from agents/BOILER.md
 *      Decision §7: framer-motion crossfade between front/back/3-4
 *      angles). When mockups are null (Dynamic Mockups key not yet
 *      configured), shows the picked concept as a single front-only
 *      view with a "Mockups pending" pill explaining the setup step.
 *
 * Cascade banner: shipped on the FURNACE renderer in Phase 10F using
 * `activeManifestation.stokerHasCascade`. Phase 11F will add a parallel
 * `furnaceHasCascade` (FURNACE brief edited past gate) so BOILER can
 * surface "regenerate gallery?" when its upstream brief drifted.
 */

interface BoilerVariant {
  variantSlug: "variant-1" | "variant-2" | "variant-3" | "variant-4";
  register: "type-led" | "iconographic" | "photographic" | "abstract" | "mixed";
  rationale: string;
  imagePrompt: string;
  recommendedModel: string;
  paletteAnchors: string[];
  referenceAnchors: string[];
  imageDataUri?: string; // Phase 11C ships with data URIs; 11C.1 → Cloudinary URL
  imageUrl?: string; // Phase 11C.1 — replaces imageDataUri once Cloudinary lands
  actualModel?: string;
  fallbacksUsed?: number;
  imageGenMs?: number;
}

interface BoilerContent {
  refused?: boolean;
  refusalReason?: string;
  galleryMood?: string;
  editorNotes?: string;
  variants?: BoilerVariant[];
  briefId?: string;
  /** Phase 11C.1 fills this in when Dynamic Mockups key is set. */
  mockups?: {
    front: string;
    back: string;
    threeQuarter?: string;
  } | null;
  mockupsPendingReason?: string;
  storageMode?: "inline-base64-data-uri" | "cloudinary";
  storagePendingReason?: string;
  /** Set by approve_concept_variant ORC tool (Phase 11E) — which variant
   *  the founder picked for this gallery. */
  approvedVariantSlug?: string;
}

const REGISTER_LABELS: Record<BoilerVariant["register"], string> = {
  "type-led": "Type-led",
  iconographic: "Iconographic",
  photographic: "Photographic",
  abstract: "Negative-space abstract",
  mixed: "Mixed register",
};

export function BoilerGallery(props: RendererProps) {
  const { activeManifestation, signal } = props;

  // BOILER only runs on manifestation children — parent workspaces with
  // no active manifestation get a friendly empty state.
  if (signal.parentSignalId === null && !activeManifestation) {
    return <NoActiveManifestation />;
  }
  const manifestation = activeManifestation;
  if (!manifestation) {
    return <NoActiveManifestation />;
  }

  const boilerOutput = manifestation.outputs?.BOILER ?? null;

  // No row yet → the handler is mid-flight (or hasn't fired)
  if (!boilerOutput) {
    return <BoilerProcessing manifestationShortcode={manifestation.shortcode} />;
  }

  const content = (boilerOutput.content ?? {}) as BoilerContent;
  const status = boilerOutput.status;

  // Refused / dismissed — show refusal banner
  if (content.refused === true || status === "REJECTED") {
    return (
      <BoilerRefused
        manifestationShortcode={manifestation.shortcode}
        refusalReason={
          content.refusalReason ?? "(no rationale provided)"
        }
      />
    );
  }

  // APPROVED → multi-angle viewer of the picked variant
  if (status === "APPROVED" && content.approvedVariantSlug) {
    const approved = content.variants?.find(
      (v) => v.variantSlug === content.approvedVariantSlug,
    );
    if (approved) {
      return (
        <BoilerApproved
          manifestationShortcode={manifestation.shortcode}
          variant={approved}
          mockups={content.mockups ?? null}
          mockupsPendingReason={content.mockupsPendingReason}
        />
      );
    }
  }

  // Default → PENDING gallery with 4 variants, founder picks one
  return (
    <BoilerGalleryReview
      manifestationShortcode={manifestation.shortcode}
      content={content}
    />
  );
}

// ─── Empty / processing states ────────────────────────────────────

function NoActiveManifestation() {
  return (
    <div className="py-16 px-7 text-center">
      <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-2">
        BOILER · No active manifestation
      </div>
      <div className="font-display text-base font-semibold text-t1 mb-2">
        Pick a manifestation from the selector above
      </div>
      <p className="font-display font-normal text-t3 text-[14px] leading-[1.6] max-w-xl mx-auto">
        BOILER concept galleries are scoped to a single manifestation.
        Use the Manifestation Selector at the top of the workspace to
        pick which decade card&apos;s gallery to review.
      </p>
    </div>
  );
}

function BoilerProcessing({
  manifestationShortcode,
}: {
  manifestationShortcode: string;
}) {
  return (
    <div className="py-16 px-7 text-center">
      <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-2">
        BOILER · Processing
      </div>
      <div className="flex items-center justify-center gap-3 mb-3">
        <span
          className="breathe inline-block rounded-full"
          style={{
            width: 10,
            height: 10,
            background: "rgba(var(--d), 0.85)",
          }}
          aria-label="BOILER is generating the concept gallery"
        />
        <h2 className="font-display text-base font-semibold text-t1">
          Generating gallery for {manifestationShortcode}…
        </h2>
      </div>
      <p className="font-display font-normal text-t3 text-[14px] leading-[1.6] max-w-xl mx-auto">
        BOILER is reading the FURNACE brief, recalling brand DNA + decade
        playbook + materials vocabulary + the fashion-design playbook, and
        producing 4 concept variants (one per design register). Image
        generation takes 30-90 seconds total. The gallery appears here
        when ready.
      </p>
    </div>
  );
}

function BoilerRefused({
  manifestationShortcode,
  refusalReason,
}: {
  manifestationShortcode: string;
  refusalReason: string;
}) {
  return (
    <div className="py-12 px-7">
      <div className="border border-rule-2 rounded-md px-7 py-6 mb-6 bg-[rgba(242,239,233,0.044)]">
        <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-[rgba(var(--d-rck),0.9)] mb-2.5">
          BOILER REFUSED · no design surface
        </div>
        <div className="font-display text-lg font-semibold text-t1 mb-3">
          BOILER refused to produce a gallery for {manifestationShortcode}
        </div>
        <p className="font-display font-normal text-[14.5px] leading-[1.6] text-t2 mb-4 max-w-3xl">
          {refusalReason}
        </p>
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-t4 mt-4 max-w-3xl">
          Founder may force-advance via ORC&apos;s force-advance tool
          (Phase 11E) or dismiss the manifestation entirely on its STOKER
          tab.
        </div>
      </div>
    </div>
  );
}

// ─── PENDING gallery — 4 variants, founder picks ──────────────────

function BoilerGalleryReview({
  manifestationShortcode,
  content,
}: {
  manifestationShortcode: string;
  content: BoilerContent;
}) {
  const variants = content.variants ?? [];

  return (
    <div className="py-8 px-7">
      {/* Top hero — gallery mood + storage status */}
      <div className="bg-wash-1 border border-rule-1 rounded-md px-6 py-5 mb-7">
        <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-1.5">
          BOILER Gallery · {manifestationShortcode}
        </div>
        <div className="font-display font-medium text-base text-t1 leading-[1.4] max-w-2xl">
          {content.galleryMood ?? "(no mood summary)"}
        </div>
        {content.editorNotes && (
          <div className="font-display text-[13px] text-t3 mt-2 max-w-2xl italic">
            {content.editorNotes}
          </div>
        )}
        <div className="flex items-center gap-3 mt-3">
          <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-t5">
            {variants.length} variants · pick one to advance to ENGINE Step 1
          </span>
          {content.storageMode === "inline-base64-data-uri" && (
            <span
              className="font-mono text-[8.5px] tracking-[0.16em] uppercase px-2 py-0.5 rounded-sm"
              style={{
                color: "rgba(212, 144, 138, 0.95)",
                background: "rgba(212, 144, 138, 0.08)",
                border: "1px solid rgba(212, 144, 138, 0.35)",
              }}
              title={
                content.storagePendingReason ??
                "Cloudinary upload not yet configured"
              }
            >
              Storage: inline (set CLOUDINARY_URL)
            </span>
          )}
        </div>
      </div>

      {/* 4-variant grid — 2×2 on desktop, 1col on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {variants.map((variant) => (
          <VariantCard key={variant.variantSlug} variant={variant} />
        ))}
      </div>

      {/* Mockup-pending strip */}
      {content.mockupsPendingReason && (
        <div
          className="mt-7 px-5 py-3 border rounded-md font-mono text-[10.5px] tracking-[0.04em] text-t4 leading-[1.55]"
          style={{
            borderColor: "rgba(242, 239, 233, 0.16)",
            background: "rgba(242, 239, 233, 0.022)",
          }}
        >
          <span className="text-t2 font-medium">Mockups pending:</span>{" "}
          {content.mockupsPendingReason}
        </div>
      )}
    </div>
  );
}

function VariantCard({ variant }: { variant: BoilerVariant }) {
  const imageSrc = variant.imageUrl ?? variant.imageDataUri ?? null;

  return (
    <article className="border border-rule-1 rounded-md overflow-hidden bg-wash-1 flex flex-col">
      {/* Image area */}
      <div className="relative aspect-square bg-black/40">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={`${REGISTER_LABELS[variant.register]} concept variant`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-t5">
              No image
            </span>
          </div>
        )}
        {/* Register tag overlay */}
        <span
          className="absolute top-3 left-3 font-mono text-[9px] tracking-[0.22em] uppercase px-2.5 py-1 rounded-sm"
          style={{
            color: "var(--color-t1)",
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
          }}
        >
          {REGISTER_LABELS[variant.register]}
        </span>
        {/* Model used (when generated) */}
        {variant.actualModel && (
          <span
            className="absolute bottom-3 right-3 font-mono text-[8.5px] tracking-[0.18em] uppercase px-2 py-0.5 rounded-sm"
            style={{
              color: "rgba(242, 239, 233, 0.85)",
              background: "rgba(0, 0, 0, 0.65)",
              backdropFilter: "blur(4px)",
            }}
          >
            {variant.actualModel}
            {variant.fallbacksUsed && variant.fallbacksUsed > 0
              ? ` · fb${variant.fallbacksUsed}`
              : ""}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        <p className="font-display text-[13.5px] leading-[1.5] text-t2 flex-1">
          {variant.rationale}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {variant.paletteAnchors.slice(0, 3).map((c) => (
            <span
              key={c}
              className="font-mono text-[9px] tracking-[0.04em] px-2 py-0.5 rounded-sm bg-wash-2 text-t3"
            >
              {c}
            </span>
          ))}
          {variant.referenceAnchors.slice(0, 2).map((r) => (
            <span
              key={r}
              className="font-mono text-[9px] tracking-[0.04em] px-2 py-0.5 rounded-sm bg-wash-2 text-t4 italic"
            >
              {r}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2 border-t border-rule-1 mt-auto">
          <button
            type="button"
            disabled
            title="Phase 11E will wire this to the approve_concept_variant ORC tool. For now, ask ORC in the panel: 'approve the type-led variant' (or whichever)."
            className="font-mono text-[10px] tracking-[0.18em] uppercase px-3 py-2 rounded-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              borderColor: "rgba(var(--d), 0.7)",
              background: "rgba(var(--d), 0.10)",
              color: "rgba(var(--d), 1)",
            }}
          >
            Pick this concept
          </button>
          <span className="ml-auto font-mono text-[9px] tracking-[0.18em] uppercase text-t5">
            via ORC →
          </span>
        </div>
      </div>
    </article>
  );
}

// ─── APPROVED — multi-angle viewer ────────────────────────────────

type Angle = "front" | "back" | "threeQuarter";

const ANGLE_LABELS: Record<Angle, string> = {
  front: "Front",
  back: "Back",
  threeQuarter: "3/4",
};

function BoilerApproved({
  manifestationShortcode,
  variant,
  mockups,
  mockupsPendingReason,
}: {
  manifestationShortcode: string;
  variant: BoilerVariant;
  mockups: {
    front: string;
    back: string;
    threeQuarter?: string;
  } | null;
  mockupsPendingReason?: string;
}) {
  const conceptSrc = variant.imageUrl ?? variant.imageDataUri ?? null;
  const availableAngles: Angle[] = mockups
    ? mockups.threeQuarter
      ? ["front", "back", "threeQuarter"]
      : ["front", "back"]
    : [];
  const [activeAngle, setActiveAngle] = useState<Angle>(
    availableAngles[0] ?? "front",
  );

  // When mockups aren't ready yet, fall back to the concept image alone
  // (single-angle view). The angle selector is hidden in this state.
  const usingMockups = mockups !== null && availableAngles.length > 0;
  const currentSrc = usingMockups
    ? (mockups[activeAngle] ?? null)
    : conceptSrc;

  return (
    <div className="py-8 px-7">
      {/* Approved header */}
      <div className="bg-wash-1 border border-rule-1 rounded-md px-6 py-5 mb-7 flex items-center justify-between gap-6">
        <div>
          <div className="font-mono text-[9px] tracking-[0.24em] uppercase text-t4 mb-1.5">
            BOILER · Concept approved · advancing to ENGINE Step 1
          </div>
          <div className="font-display font-semibold text-base text-t1 leading-tight">
            {manifestationShortcode}
          </div>
          <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-t5 mt-1.5">
            {REGISTER_LABELS[variant.register]} · {variant.actualModel ?? "—"}
          </div>
        </div>
      </div>

      {/* Multi-angle viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-7">
        {/* Image canvas */}
        <div>
          <div
            className="relative aspect-square bg-black/40 rounded-md overflow-hidden border border-rule-1"
            style={{ minHeight: 420 }}
          >
            <AnimatePresence mode="wait">
              {currentSrc ? (
                <motion.img
                  key={`${variant.variantSlug}-${activeAngle}-${currentSrc.slice(0, 32)}`}
                  src={currentSrc}
                  alt={`${variant.register} concept — ${activeAngle}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-t5">
                    No image
                  </span>
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Angle selector — only when mockups ready */}
          {usingMockups && availableAngles.length > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {availableAngles.map((angle) => {
                const isActive = angle === activeAngle;
                return (
                  <button
                    key={angle}
                    type="button"
                    onClick={() => setActiveAngle(angle)}
                    className="font-mono text-[10px] tracking-[0.18em] uppercase px-4 py-2 rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-t2"
                    style={
                      isActive
                        ? {
                            borderColor: "rgba(var(--d), 0.7)",
                            background: "rgba(var(--d), 0.14)",
                            color: "rgba(var(--d), 1)",
                          }
                        : {
                            borderColor: "var(--color-rule-2)",
                            background: "transparent",
                            color: "var(--color-t3)",
                          }
                    }
                  >
                    {ANGLE_LABELS[angle]}
                  </button>
                );
              })}
            </div>
          )}

          {/* Mockup-pending strip */}
          {!usingMockups && mockupsPendingReason && (
            <div
              className="mt-4 px-4 py-2.5 border rounded-md font-mono text-[10px] tracking-[0.04em] text-t4 leading-[1.55]"
              style={{
                borderColor: "rgba(242, 239, 233, 0.16)",
                background: "rgba(242, 239, 233, 0.022)",
              }}
            >
              <span className="text-t2 font-medium">Mockups pending:</span>{" "}
              {mockupsPendingReason}
            </div>
          )}
        </div>

        {/* Side panel — variant detail */}
        <aside className="font-display text-[13.5px] leading-[1.6] text-t2">
          <h3 className="font-mono text-[9px] tracking-[0.22em] uppercase text-t5 mb-2">
            Concept rationale
          </h3>
          <p className="mb-5 max-w-xs">{variant.rationale}</p>

          <h3 className="font-mono text-[9px] tracking-[0.22em] uppercase text-t5 mb-2">
            Palette
          </h3>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {variant.paletteAnchors.map((c) => (
              <span
                key={c}
                className="font-mono text-[9px] tracking-[0.04em] px-2 py-0.5 rounded-sm bg-wash-2 text-t3"
              >
                {c}
              </span>
            ))}
          </div>

          <h3 className="font-mono text-[9px] tracking-[0.22em] uppercase text-t5 mb-2">
            References
          </h3>
          <ul className="font-mono text-[10.5px] text-t4 leading-[1.6] mb-5">
            {variant.referenceAnchors.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>

          <h3 className="font-mono text-[9px] tracking-[0.22em] uppercase text-t5 mb-2">
            Generated by
          </h3>
          <p className="font-mono text-[10.5px] text-t3">
            {variant.actualModel ?? variant.recommendedModel}
            {variant.fallbacksUsed && variant.fallbacksUsed > 0 ? (
              <span className="text-t5">
                {" "}
                · {variant.fallbacksUsed} fallback
                {variant.fallbacksUsed === 1 ? "" : "s"}
              </span>
            ) : null}
          </p>
        </aside>
      </div>
    </div>
  );
}
