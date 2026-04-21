"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Segment = { label: string; href?: string };

/**
 * Smart breadcrumb derived from pathname.
 * Non-leaf segments are real <Link>s (navigable). Leaf segment is a plain span (current location).
 * Never show hover/cursor affordances on elements that aren't actually clickable.
 */
function segmentsFor(pathname: string): Segment[] {
  // Engine Room module routes
  if (pathname === "/engine-room") {
    return [{ label: "BOS", href: "/" }, { label: "Engine Room" }];
  }
  if (pathname === "/engine-room/signals" || pathname.startsWith("/engine-room/signals/")) {
    return [
      { label: "BOS", href: "/" },
      { label: "Engine Room", href: "/engine-room" },
      { label: "Signal Workspace" },
    ];
  }
  if (pathname === "/engine-room/agents" || pathname.startsWith("/engine-room/agents/")) {
    return [
      { label: "BOS", href: "/" },
      { label: "Engine Room", href: "/engine-room" },
      { label: "Agents" },
    ];
  }
  if (pathname === "/engine-room/settings") {
    return [
      { label: "BOS", href: "/" },
      { label: "Engine Room", href: "/engine-room" },
      { label: "Settings" },
    ];
  }

  // BOS-level routes
  if (pathname === "/settings") {
    return [{ label: "BOS", href: "/" }, { label: "Settings" }];
  }
  if (pathname === "/profile") {
    return [{ label: "BOS", href: "/" }, { label: "Profile" }];
  }

  // BOS root (rarely rendered — it redirects to /engine-room)
  if (pathname === "/") {
    return [{ label: "BOS" }];
  }

  // Fallback — derive from last segment
  const leaf = pathname.split("/").filter(Boolean).slice(-1)[0] ?? "Home";
  return [
    { label: "BOS", href: "/" },
    { label: leaf.charAt(0).toUpperCase() + leaf.slice(1) },
  ];
}

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = segmentsFor(pathname);

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center font-mono font-light text-[10px] uppercase tracking-[0.16em] leading-none"
    >
      {segments.map((seg, i) => (
        <span key={`${seg.label}-${i}`} className="inline-flex items-center">
          {i > 0 && (
            <span aria-hidden className="text-warm-muted mx-[9px] font-light">
              /
            </span>
          )}
          {seg.href ? (
            <Link
              href={seg.href}
              className="text-warm-bright hover:text-off-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink rounded-[2px]"
            >
              {seg.label}
            </Link>
          ) : (
            <span
              aria-current="page"
              className="text-off-white font-normal"
            >
              {seg.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
