export function ContentFrame({ children }: { children?: React.ReactNode }) {
  if (children) {
    return (
      <div className="flex-1 overflow-auto relative bg-ink p-8">
        {children}
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto flex items-center justify-center relative bg-ink p-8">
      <div className="font-editorial italic font-light text-[22px] text-warm-muted tracking-[0.01em] select-none">
        — No module loaded —
      </div>
    </div>
  );
}
