import Link from "next/link";

/**
 * The product wordmark. Always links to BOS home (/).
 * Treatment: BLIPS (display, extrabold) + pulsing dot + BOS (mono, tracked, muted).
 * This combines brand identity (BLIPS) with product identity (BOS) so every screen
 * is explicit about which app the user is in.
 */
export function Wordmark() {
  return (
    <Link
      href="/"
      aria-label="BLIPS BOS — home"
      className="inline-flex items-center gap-[3px] leading-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-off-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink rounded-[2px]"
    >
      <span className="font-display font-extrabold text-[14px] tracking-tight text-off-white">
        BLIPS
      </span>
      <span
        aria-hidden
        className="inline-block w-[5px] h-[5px] rounded-full bg-off-white breathe -mb-[1px]"
      />
      <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-warm-muted ml-[6px] font-normal">
        BOS
      </span>
    </Link>
  );
}
