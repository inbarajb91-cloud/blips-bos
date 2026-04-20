"use client";

import { usePathname } from "next/navigation";

/**
 * Smart breadcrumb.
 * Engine Room routes live under /, so `/` shows "BOS / Engine Room".
 * BOS-level routes (settings, profile) show "BOS / <Section>".
 * Engine Room sub-routes (future: /bridge, /signals, etc.) show "BOS / Engine Room / <Section>".
 */
const ENGINE_ROOM_ROUTES: Record<string, string> = {
  "/": "Engine Room",
  // Future Engine Room sections:
  // "/bridge": "Bridge",
  // "/signals": "Signal Workspace",
  // "/agents": "Agents",
};

const BOS_LEVEL_ROUTES: Record<string, string> = {
  "/settings": "Settings",
  "/profile": "Profile",
};

export function Breadcrumb() {
  const pathname = usePathname();

  let path: string[];
  if (pathname in ENGINE_ROOM_ROUTES) {
    path = ["BOS", ENGINE_ROOM_ROUTES[pathname]];
  } else if (pathname in BOS_LEVEL_ROUTES) {
    path = ["BOS", BOS_LEVEL_ROUTES[pathname]];
  } else {
    // Fallback: use the last path segment, title-cased
    const leaf = pathname.split("/").filter(Boolean).slice(-1)[0] ?? "Engine Room";
    path = ["BOS", leaf.charAt(0).toUpperCase() + leaf.slice(1)];
  }

  return (
    <div className="flex items-center font-mono font-light text-[10px] uppercase tracking-[0.16em] text-warm-bright leading-none">
      {path.map((seg, i) => (
        <span key={`${seg}-${i}`} className="inline-flex items-center">
          {i > 0 && (
            <span className="text-warm-muted mx-[9px] font-light">/</span>
          )}
          <span
            className={
              i === path.length - 1
                ? "text-off-white font-normal"
                : "text-warm-bright hover:text-off-white transition-colors cursor-pointer"
            }
          >
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
