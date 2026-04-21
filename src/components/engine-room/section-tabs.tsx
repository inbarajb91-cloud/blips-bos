"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

/**
 * Engine Room section tab strip.
 *
 * Four tabs per architecture: Bridge / Signal Workspace / Agents / Settings.
 * Active tab gets a breathing underline (2.8s cycle, matching the wordmark dot).
 * Inactive tabs hover to off-white. Keyboard navigable via underlying <Link>s.
 *
 * Aligns flush with the nav above — no side padding on the strip itself;
 * each tab owns its own px-5 spacing.
 */
const TABS = [
  { href: "/engine-room", label: "Bridge" },
  { href: "/engine-room/signals", label: "Signal Workspace" },
  { href: "/engine-room/agents", label: "Agents" },
  { href: "/engine-room/settings", label: "Settings" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/engine-room") {
    // Bridge is only active on exact /engine-room, not on deeper routes
    return pathname === "/engine-room";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SectionTabs() {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      aria-label="Engine Room sections"
      className="chrome-brightness h-10 flex items-center px-5 border-b border-deep-divider bg-ink/70 backdrop-blur-md relative z-[8]"
    >
      <div className="flex items-center gap-6">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={`relative inline-flex items-center h-10 font-mono text-[10px] tracking-[0.22em] uppercase transition-colors ${
                active
                  ? "text-off-white"
                  : "text-warm-muted hover:text-warm-bright"
              } focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink rounded-[2px]`}
            >
              {tab.label}
              {active && (
                <motion.span
                  layoutId="section-tab-underline"
                  aria-hidden
                  className="absolute left-0 right-0 bottom-0 h-[1.5px] bg-off-white"
                  style={{ animation: "breathe 2.8s ease-in-out infinite" }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
