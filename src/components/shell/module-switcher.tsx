"use client";

import { usePathname } from "next/navigation";
import {
  getActiveModule,
  getActiveModuleCount,
} from "@/lib/modules/registry";

/**
 * Module switcher in the top nav.
 *
 * Phase 4: solo-mode chiclet — only one active module (Engine Room), no dropdown.
 * When a second module goes "active" (Store / Vendor / Marketing in later phases),
 * `getActiveModuleCount()` goes to 2+ and this becomes a real dropdown.
 */
export function ModuleSwitcher() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const activeCount = getActiveModuleCount();

  // Solo mode — single-module state
  if (activeCount <= 1) {
    return (
      <div
        className="inline-flex items-center gap-2 px-2.5 py-[5px] border border-deep-divider rounded-[3px] h-[26px] cursor-default"
        title="Only module available"
      >
        <span className="font-mono text-[7px] tracking-[0.24em] uppercase text-warm-muted font-normal">
          MOD
        </span>
        <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-off-white font-medium">
          {active?.name ?? "BOS"}
        </span>
      </div>
    );
  }

  // Multi-module dropdown — implemented when a 2nd module ships
  // (intentionally left as future work per CONTEXT.md deferred-items list)
  return null;
}
