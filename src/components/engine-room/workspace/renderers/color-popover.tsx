"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ColorPopover — Phase 11D.4d.
 *
 * Per-role color picker popover used by the BOILER v2 renderer's Palette
 * Roles table. UX matches Design/Phase-11-BOILER-v2/v5.html § .color-popover:
 *   - Header row: small mono label with role name + close X
 *   - Native <input type="color"> (64px tall, full width)
 *   - HEX text input (validates #RRGGBB on commit)
 *   - 16-quick-swatch grid (8 columns × 2 rows) drawn from BLIPS palettes
 *   - Footer note reminding founder that ORC chat can also set colors
 *
 * Controlled component. Parent owns the open/closed state + the currently-
 * selected hex (so multi-popover lists can ensure only one is open at a
 * time). On commit (native picker change, valid hex blur/enter, or quick-
 * swatch click), `onCommit(hex)` fires. Parent decides whether to call
 * the server action immediately or batch.
 *
 * Hex validation: the popover commits immediately on native-picker change
 * (always valid) and on quick-swatch click. The text input commits on
 * blur or Enter, and only when the hex matches /^#[0-9a-fA-F]{6}$/u —
 * otherwise the value resets to the prior hex with no commit fired.
 *
 * Click-outside + ESC close. The popover positions itself absolutely
 * within the parent's relative container — parent is responsible for the
 * positioning context.
 */

interface ColorPopoverProps {
  /** Whether the popover is open. Parent controls. */
  open: boolean;
  /** Close handler — fires on click-outside, ESC, or the close X. */
  onClose: () => void;
  /** Hex code currently bound to this role (e.g. "#5A2020"). */
  currentHex: string;
  /** Human-readable role label (e.g. "Garment base"). Shown in the header. */
  roleLabel: string;
  /**
   * Called when the user commits a new color. `hex` is always 6-digit
   * with leading #. Parent's handler should call the server action
   * + optimistically update local state. May be async.
   */
  onCommit: (hex: string) => void | Promise<void>;
  /** Whether a commit is in flight — disables inputs + shows pending UX. */
  pending?: boolean;
}

// Curated 16-swatch grid pulled from CLAUDE.md / agents/skills.md palettes.
// S01 Raw Industrial · S02 Cold Cosmic · S03 Warm Reckoning + neutral bases.
const QUICK_SWATCHES = [
  // S01 Raw Industrial
  "#5A2020", // forge
  "#2A0F0F", // char
  "#A04040", // signal red
  "#9E5050", // rust haze
  // S02 Cold Cosmic
  "#2E3A47", // deep slate
  "#5A6E7E", // cool slate
  "#B4C4D6", // ice
  "#0A0A0A", // pure dark
  // S03 Warm Reckoning
  "#8C4A28", // rust
  "#C8893D", // amber
  "#6B4B2E", // warm earth
  "#4A1A1A", // burgundy
  // Bases
  "#F2EFE9", // bone
  "#E8D5D2", // ash blush
  "#8A8580", // stone
  "#1A1A1A", // near-black
];

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/u;

export function ColorPopover({
  open,
  onClose,
  currentHex,
  roleLabel,
  onCommit,
  pending,
}: ColorPopoverProps) {
  // Text-input draft (may be temporarily invalid while typing); resets to
  // currentHex when the popover opens or after a commit.
  const [hexDraft, setHexDraft] = useState(currentHex);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Re-sync the draft whenever the prop changes (e.g. after a server-side
  // commit lands and TanStack invalidates). Avoids the popover showing stale
  // hex after a different surface (ORC chat) updated the same role.
  useEffect(() => {
    setHexDraft(currentHex);
  }, [currentHex, open]);

  // Click-outside + ESC close. Only attached when open.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const commitDraftIfValid = () => {
    if (!HEX_REGEX.test(hexDraft)) {
      setHexDraft(currentHex); // reset to known-good
      return;
    }
    if (hexDraft.toLowerCase() === currentHex.toLowerCase()) {
      return; // no-op — same color
    }
    void onCommit(hexDraft);
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={`Edit ${roleLabel}`}
      className="absolute right-0 top-full z-50 mt-1.5 w-[240px] rounded-md border border-rule-3 p-3.5 shadow-xl"
      style={{ background: "#16110f" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="mb-2.5 flex items-center gap-2 font-mono text-[9.5px] tracking-[0.18em] text-t4 uppercase">
        <span className="flex-1 text-t1">{roleLabel}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[18px] w-[18px] items-center justify-center rounded-sm border border-rule-2 text-[10px] text-t4 hover:border-rule-3 hover:text-t1"
          aria-label="Close color picker"
        >
          ×
        </button>
      </div>

      {/* Native color input */}
      <input
        type="color"
        value={currentHex}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (HEX_REGEX.test(next) && next.toLowerCase() !== currentHex.toLowerCase()) {
            setHexDraft(next);
            void onCommit(next);
          }
        }}
        disabled={pending}
        aria-label={`Native color picker for ${roleLabel}`}
        className="h-16 w-full cursor-pointer rounded-sm border border-rule-2 p-0 appearance-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "var(--ink)" }}
      />

      {/* Hex text input */}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="font-mono text-[9px] tracking-[0.18em] text-t5 uppercase">
          Hex
        </span>
        <input
          type="text"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.currentTarget.value)}
          onBlur={commitDraftIfValid}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraftIfValid();
            }
          }}
          disabled={pending}
          spellCheck={false}
          maxLength={7}
          aria-label={`${roleLabel} hex code`}
          className="flex-1 rounded-sm border border-rule-2 px-2 py-1.5 font-mono text-[11px] tracking-[0.04em] text-t1 disabled:opacity-50"
          style={{ background: "rgba(0,0,0,0.4)" }}
        />
      </div>

      {/* Quick swatches */}
      <div className="mt-3 grid grid-cols-8 gap-1">
        {QUICK_SWATCHES.map((hex) => {
          const isCurrent = hex.toLowerCase() === currentHex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => {
                setHexDraft(hex);
                if (hex.toLowerCase() !== currentHex.toLowerCase()) {
                  void onCommit(hex);
                }
              }}
              disabled={pending}
              title={hex}
              aria-label={`Use ${hex}`}
              className="aspect-square cursor-pointer rounded-[2px] border transition-transform hover:scale-[1.12] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: hex,
                borderColor: isCurrent ? "var(--t1)" : "var(--rule-2)",
              }}
            />
          );
        })}
      </div>

      {/* Footer note */}
      <div className="mt-3 border-t border-rule-1 pt-2.5 font-mono text-[9px] tracking-[0.04em] leading-relaxed text-t5">
        ORC can change colors from natural language too — try{" "}
        <span style={{ color: "rgba(var(--d), 0.9)" }}>
          &ldquo;make the garment burgundy&rdquo;
        </span>{" "}
        in chat.
      </div>
    </div>
  );
}
