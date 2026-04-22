import { SectionTabs } from "@/components/engine-room/section-tabs";

/**
 * Engine Room loading boundary — matches the new collections Bridge layout
 * so navigation Settings → Bridge doesn't flash the old card skeleton before
 * the real content loads.
 */
export default function EngineRoomLoading() {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs />
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full max-w-[1600px] mx-auto px-6 md:px-10 lg:px-14 pt-12 pb-40 animate-pulse">
          {/* Hero — h1 + aggregate + actions */}
          <div className="mb-10 flex items-baseline justify-between gap-8 flex-wrap">
            <div className="flex flex-col gap-4">
              <div className="h-8 w-32 bg-white/10 rounded" />
              <div className="h-3 w-72 bg-white/5 rounded" />
            </div>
            <div className="flex gap-2.5">
              <div className="h-9 w-32 bg-white/5 rounded-sm border border-white/10" />
              <div className="h-9 w-28 bg-white/10 rounded-sm border border-white/20" />
            </div>
          </div>

          {/* Stream label */}
          <div className="h-2.5 w-24 bg-white/5 rounded mb-3.5" />

          {/* Spine placeholders */}
          <div className="flex flex-col border-y border-white/5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="grid grid-cols-[16px_1fr_auto] gap-5 items-baseline px-4 py-5 border-b border-white/5 last:border-b-0"
              >
                <div className="h-2 w-2 bg-white/20 rounded-full self-center" />
                <div className="flex flex-col gap-2">
                  <div className="h-4 w-56 bg-white/10 rounded" />
                  <div className="h-2.5 w-64 bg-white/5 rounded" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="h-4 w-6 bg-white/10 rounded" />
                  <div className="h-2 w-16 bg-white/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
