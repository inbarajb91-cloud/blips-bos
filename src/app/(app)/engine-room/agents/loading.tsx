/**
 * Agents page skeleton — mirrors the real layout structure so content streams
 * into place rather than appearing all at once.
 *
 * Shown during navigation to /engine-room/agents while the server does its
 * getCurrentUserWithOrg() + config_agents query. User sees the page shape
 * immediately; actual data fades in.
 */
export default function AgentsLoading() {
  return (
    <div className="w-full px-6 md:px-10 lg:px-14 pt-10 pb-16 max-w-[1800px] mx-auto animate-pulse">
      {/* Header */}
      <header className="mb-10 max-w-4xl">
        <div className="h-7 w-28 bg-white/10 rounded mb-3" />
        <div className="h-3 w-[90%] max-w-xl bg-white/5 rounded mb-1" />
        <div className="h-3 w-[60%] max-w-lg bg-white/5 rounded" />
      </header>

      {/* ORC card skeleton */}
      <div className="bg-ink border border-deep-divider rounded-md p-6 mb-10">
        <div className="flex items-start justify-between gap-6 mb-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="h-7 w-14 bg-white/10 rounded" />
              <div className="h-2 w-2 rounded-full bg-white/10" />
              <div className="h-2.5 w-20 bg-white/5 rounded" />
            </div>
            <div className="h-5 w-64 bg-white/5 rounded" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="h-2.5 w-10 bg-white/5 rounded" />
            <div className="h-3 w-16 bg-white/10 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 pt-5 border-t border-deep-divider">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-2.5 w-20 bg-white/5 rounded" />
              <div className="h-4 w-24 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Skills heading */}
      <div className="h-2.5 w-12 bg-white/5 rounded mb-4" />

      {/* 6 skill card skeletons */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-ink border border-deep-divider rounded-md p-5 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded border border-deep-divider" />
                <div className="h-4 w-20 bg-white/10 rounded" />
              </div>
              <div className="h-2.5 w-20 bg-white/5 rounded" />
            </div>
            <div className="h-4 w-56 max-w-full bg-white/5 rounded" />
            <div className="h-2.5 w-40 max-w-full bg-white/5 rounded" />
            <div className="pt-3 border-t border-deep-divider">
              <div className="h-2.5 w-32 bg-white/5 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
