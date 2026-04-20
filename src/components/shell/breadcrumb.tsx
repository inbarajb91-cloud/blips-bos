export function Breadcrumb({ path }: { path: string[] }) {
  return (
    <div className="flex items-center font-mono font-light text-[10px] uppercase tracking-[0.16em] text-warm-bright leading-none">
      {path.map((seg, i) => (
        <span key={`${seg}-${i}`} className="inline-flex items-center">
          {i > 0 && (
            <span className="text-warm-muted mx-[9px] font-light">/</span>
          )}
          <span
            className={
              i === path.length - 1
                ? "text-off-white font-normal"
                : "text-warm-bright hover:text-off-white transition-colors cursor-pointer"
            }
          >
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
