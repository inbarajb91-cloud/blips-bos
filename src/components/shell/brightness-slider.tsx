"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "blips.legibility";

/**
 * Controls the --legibility CSS custom property (0.6–1.0).
 * Chrome surfaces (nav, status bar) consume it via the .chrome-brightness utility.
 * Persists to localStorage so brightness holds across sessions.
 */
export function BrightnessSlider() {
  const [value, setValue] = useState<number>(100);

  // Hydrate from localStorage post-mount to avoid SSR mismatch
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const v = parseInt(stored, 10);
      if (!isNaN(v) && v >= 60 && v <= 100) setValue(v);
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--legibility",
      (value / 100).toString(),
    );
    localStorage.setItem(STORAGE_KEY, value.toString());
  }, [value]);

  return (
    <label className="inline-flex items-center gap-2 h-[26px]">
      <span className="font-mono text-[8px] uppercase tracking-[0.24em] text-warm-muted whitespace-nowrap font-normal">
        Legibility
      </span>
      <input
        type="range"
        min={60}
        max={100}
        step={1}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="brightness-slider w-20 h-px bg-off-white/20 cursor-pointer appearance-none"
        aria-label="Interface legibility"
      />
      <span className="font-mono text-[9px] tracking-[0.12em] text-warm-bright min-w-[30px] text-right tabular-nums">
        {value}%
      </span>
    </label>
  );
}
