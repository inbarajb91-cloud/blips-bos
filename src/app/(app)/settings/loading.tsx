export default function BOSSettingsLoading() {
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-10 pt-10 pb-16 animate-pulse">
      <div className="h-7 w-40 bg-white/10 rounded mb-3" />
      <div className="h-3 w-[80%] max-w-xl bg-white/5 rounded mb-10" />
      <div className="flex flex-col gap-px border border-deep-divider rounded-md overflow-hidden">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-ink px-5 py-5 flex items-start justify-between gap-6 border-b border-deep-divider last:border-b-0"
          >
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="h-4 w-28 bg-white/10 rounded" />
              <div className="h-3 w-[70%] max-w-md bg-white/5 rounded" />
            </div>
            <div className="h-2.5 w-16 bg-white/5 rounded mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
