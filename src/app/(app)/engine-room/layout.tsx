/**
 * Engine Room shell layout.
 *
 * Previously rendered a dedicated section-tabs row above the route
 * children. As of Phase 7 chrome cleanup, section tabs live inline in
 * the top Nav (`src/components/shell/nav.tsx`), so this layout reduces
 * to a thin pass-through wrapping the scrollable content area.
 *
 * Kept as a layout file rather than deleted — we'll reintroduce engine-
 * room-specific shell concerns (ORC status indicator, pipeline-wide
 * controls, etc.) in later phases and this is the right seam.
 */
export default function EngineRoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="h-full overflow-auto">{children}</div>;
}
