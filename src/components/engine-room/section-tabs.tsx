"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

/**
 * Engine Room section tabs — inline variant.
 *
 * Renders the four section links (Bridge / Signal Workspace / Agents /
 * Settings) as a compact inline group, meant to sit inside the top Nav
 * row next to the module chip. Returns null when the user is outside
 * Engine Room so the tabs don't pollute BOS-level screens.
 *
 * Moved from a dedicated sub-nav strip into the top Nav as part of
 * Phase 7 chrome cleanup — one less row of chrome, more workspace
 * real estate.
 *
 * A11y (CodeRabbit — Phase 7): these are route-changing links, not
 * in-page tabpanels. Using `role="tablist"` / `role="tab"` on them
 * tells screen readers to expect tab keyboard semantics (arrow keys
 * moving focus, Space/Enter toggling panels) and an `aria-controls`
 * panel relationship — none of which this component provides. Wrong
 * mental model for the user, broken affordance.
 *
 * Native navigation semantics are the correct pattern: `<nav>` / `<ul>`
 * / `<li>` / `<a>` with `aria-current="page"` on the active link. SRs
 * announce "navigation landmark, current page" which is exactly what's
 * happening. Visual treatment (active color + breathing underline) is
 * unchanged — only the roles/attributes differ.
 *
 * The AgentTabStrip inside the workspace canvas is a real tab widget
 * (buttons that swap an in-page tabpanel) and keeps `role="tablist"`
 * there correctly.
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

  // Only render inside Engine Room routes. On /profile, /settings (BOS),
  // or /login the section tabs would be orientation-breaking noise.
  if (!pathname.startsWith("/engine-room")) return null;

  return (
    <nav aria-label="Engine Room sections" className="h-full">
      <ul className="flex items-center gap-6 h-full m-0 p-0 list-none">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href} className="h-full">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex items-center h-full font-mono text-[10px] tracking-[0.22em] uppercase transition-colors ${
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
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
