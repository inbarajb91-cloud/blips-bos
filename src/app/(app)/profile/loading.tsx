export default function ProfileLoading() {
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 pt-10 pb-16 animate-pulse">
      <div className="h-7 w-24 bg-white/10 rounded mb-3" />
      <div className="h-3 w-56 bg-white/5 rounded mb-10" />
      <div className="flex flex-col gap-0 border border-deep-divider rounded-md overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="bg-ink px-5 py-4 flex items-center justify-between gap-6 border-b border-deep-divider last:border-b-0"
          >
            <div className="h-2.5 w-24 bg-white/5 rounded" />
            <div className="h-4 w-40 bg-white/10 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
