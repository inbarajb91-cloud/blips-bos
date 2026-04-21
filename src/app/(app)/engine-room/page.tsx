export const metadata = { title: "Bridge · Engine Room · BLIPS BOS" };

/**
 * Bridge — pipeline overview.
 *
 * Phase 4 ships the empty state. Phase 6 fills this with batch folders,
 * signal rows with 6-stage progress, triage queue, and the ORC command panel.
 */
export default function BridgePage() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8 py-16 gap-6 text-center">
      <p className="font-editorial italic text-warm-bright text-3xl leading-tight max-w-md">
        Nothing in the pipeline yet.
      </p>
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-warm-muted max-w-sm leading-relaxed">
        BUNKER hasn&apos;t woken up. When signals arrive, they&apos;ll land here.
      </p>
    </div>
  );
}
