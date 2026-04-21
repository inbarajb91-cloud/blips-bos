/**
 * Skeleton building blocks for loading states.
 * All use a subtle `bg-white/10` + `animate-pulse` so they're visible on ink
 * without being distracting.
 */

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`bg-white/10 rounded ${className}`} />;
}

export function SkeletonCard({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`bg-ink border border-deep-divider rounded-md ${className}`}
    >
      {children}
    </div>
  );
}
