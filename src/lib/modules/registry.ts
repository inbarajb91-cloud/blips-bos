/**
 * Module registry — the lightweight manifest BOS uses to know what modules
 * exist, where they live in the URL tree, and whether they're active.
 *
 * Adding a new module:
 *   1. Add an entry here with status: "soon"
 *   2. Build its routes under `/<routePrefix>/...`
 *   3. Flip status to "active"
 *   4. BOS home grid + ModuleSwitcher automatically surface it
 */

export interface ModuleEntry {
  key: string;
  name: string;
  tagline: string;
  status: "active" | "soon";
  /** URL prefix — routes for this module live under this path. */
  routePrefix: string;
  /** Top-level sections inside the module (for the section tab strip). */
  sections?: ReadonlyArray<{ name: string; href: string }>;
}

export const MODULE_REGISTRY: ReadonlyArray<ModuleEntry> = [
  {
    key: "engine-room",
    name: "Engine Room",
    tagline: "Signal pipeline — cultural signals in, finished products out",
    status: "active",
    routePrefix: "/engine-room",
    sections: [
      { name: "Bridge", href: "/engine-room" },
      { name: "Signal Workspace", href: "/engine-room/signals" },
      { name: "Agents", href: "/engine-room/agents" },
      { name: "Settings", href: "/engine-room/settings" },
    ],
  },
  {
    key: "store",
    name: "Store",
    tagline: "E-commerce operations",
    status: "soon",
    routePrefix: "/store",
  },
  {
    key: "vendor",
    name: "Vendor",
    tagline: "Supplier & production",
    status: "soon",
    routePrefix: "/vendor",
  },
  {
    key: "marketing",
    name: "Marketing",
    tagline: "Campaigns & content",
    status: "soon",
    routePrefix: "/marketing",
  },
] as const;

export function getActiveModule(pathname: string): ModuleEntry | undefined {
  return MODULE_REGISTRY.find(
    (m) =>
      pathname === m.routePrefix || pathname.startsWith(`${m.routePrefix}/`),
  );
}

export function getActiveModuleCount(): number {
  return MODULE_REGISTRY.filter((m) => m.status === "active").length;
}
