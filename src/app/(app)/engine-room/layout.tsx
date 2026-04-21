import { SectionTabs } from "@/components/engine-room/section-tabs";

export default function EngineRoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      <SectionTabs />
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
