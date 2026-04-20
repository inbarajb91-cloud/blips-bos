"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { signOut } from "@/app/login/actions";

export function UserChip({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const initials = email.slice(0, 2).toUpperCase();

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-[3px] h-[26px] border transition-colors ${
          open
            ? "bg-white/[0.03] border-deep-divider"
            : "border-transparent hover:border-deep-divider"
        }`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-sm bg-white/[0.03] border border-deep-divider font-mono text-[8px] tracking-[0.05em] text-warm-bright font-medium">
          {initials}
        </span>
        <span className="font-mono text-[10px] tracking-[0.04em] text-warm-bright font-light hover:text-off-white">
          {email}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+6px)] right-0 min-w-[220px] bg-ink border border-deep-divider rounded p-1 shadow-[0_2px_0_rgba(0,0,0,0.6),0_24px_48px_rgba(0,0,0,0.5)] z-30 flex flex-col"
        >
          <div className="px-3 py-2.5 border-b border-white/[0.06] mb-0.5 flex flex-col gap-[3px]">
            <span className="font-mono text-[10px] text-off-white tracking-[0.04em]">
              {email}
            </span>
            <span className="font-mono text-[8px] text-warm-muted tracking-[0.22em] uppercase">
              Founder · HELM
            </span>
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            className="px-3 py-2.5 rounded-sm font-mono text-[9px] tracking-[0.2em] uppercase text-warm-bright hover:bg-white/[0.03] hover:text-off-white transition-colors block"
          >
            Profile
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="px-3 py-2.5 rounded-sm font-mono text-[9px] tracking-[0.2em] uppercase text-warm-bright hover:bg-white/[0.03] hover:text-off-white transition-colors block"
          >
            BOS Settings
          </Link>
          <div className="h-px bg-white/[0.06] my-0.5" />
          <form action={signOut}>
            <button
              type="submit"
              className="w-full px-3 py-2.5 rounded-sm font-mono text-[9px] tracking-[0.2em] uppercase text-warm-bright hover:bg-white/[0.03] hover:text-off-white transition-colors text-left cursor-pointer"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
