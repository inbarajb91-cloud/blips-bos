/**
 * Solo-mode module switcher for Phase 1.
 * Becomes a dropdown once we add Store/Vendor/Marketing modules.
 */
export function ModuleSwitcher({ current = "Engine Room" }: { current?: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 px-2.5 py-[5px] border border-deep-divider rounded-[3px] h-[26px] cursor-default"
      title="Only module available"
    >
      <span className="font-mono text-[7px] tracking-[0.24em] uppercase text-warm-muted font-normal">
        MOD
      </span>
      <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-off-white font-medium">
        {current}
      </span>
    </div>
  );
}
