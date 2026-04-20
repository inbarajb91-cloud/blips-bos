export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-[3px] font-display font-extrabold text-[14px] tracking-tight text-off-white leading-none cursor-pointer">
      BLIPS
      <span
        aria-hidden
        className="inline-block w-[5px] h-[5px] rounded-full bg-off-white breathe -mb-[1px]"
      />
    </span>
  );
}
