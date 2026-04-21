import { SectionTabs } from "@/components/engine-room/section-tabs";

/**
 * Engine Room loading boundary — shown during navigation between
 * /engine-room/* routes when no child `loading.tsx` applies.
 *
 * We render the SectionTabs so the user sees the nav stay in place while
 * content below streams. Subtle pulse dot in the content area.
 */
export default function EngineRoomLoading() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs />
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full bg-off-white breathe"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-warm-muted">
            Loading
          </span>
        </div>
      </div>
    </div>
  );
}
