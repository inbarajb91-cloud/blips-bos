import { SectionTabs } from "@/components/engine-room/section-tabs";

/**
 * Engine Room loading boundary — shown during navigation between
 * /engine-room/* routes when no child `loading.tsx` applies.
 *
 * Keeps SectionTabs visible so the user sees the nav stays in place
 * while the child content streams. The content area is a skeleton matching
 * the Bridge page layout (the most common landing).
 */
export default function EngineRoomLoading() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs />
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full max-w-[1800px] mx-auto px-6 md:px-10 lg:px-14 pt-10 pb-16 animate-pulse">
          {/* Header row */}
          <div className="mb-10 flex items-end justify-between gap-6">
            <div className="flex flex-col gap-2 flex-1">
              <div className="h-7 w-24 bg-white/10 rounded" />
              <div className="h-3 w-96 max-w-full bg-white/5 rounded" />
            </div>
            <div className="h-7 w-28 bg-white/10 rounded-sm" />
          </div>

          {/* Section heading */}
          <div className="flex items-center justify-between mb-4">
            <div className="h-2.5 w-24 bg-white/5 rounded" />
            <div className="h-2.5 w-20 bg-white/5 rounded" />
          </div>

          {/* Candidate card placeholders */}
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-ink border border-deep-divider rounded-md p-5 flex flex-col gap-3 h-36"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-12 bg-white/10 rounded" />
                    <div className="h-4 w-56 bg-white/10 rounded" />
                  </div>
                  <div className="h-2.5 w-20 bg-white/5 rounded" />
                </div>
                <div className="h-5 w-[80%] bg-white/5 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
