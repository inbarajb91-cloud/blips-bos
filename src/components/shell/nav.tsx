import { Wordmark } from "./wordmark";
import { ModuleSwitcher } from "./module-switcher";
import { Breadcrumb } from "./breadcrumb";
import { BrightnessSlider } from "./brightness-slider";
import { UserChip } from "./user-chip";
import { GearButton } from "./gear-button";

export function Nav({
  email,
  breadcrumb,
}: {
  email: string;
  breadcrumb: string[];
}) {
  return (
    <nav className="chrome-brightness h-12 flex items-center justify-between px-5 bg-ink/90 backdrop-blur-md border-b border-deep-divider relative z-10">
      <div className="flex items-center gap-5 h-full">
        <Wordmark />
        <span className="w-px h-4 bg-deep-divider" />
        <ModuleSwitcher current="Engine Room" />
        <Breadcrumb path={breadcrumb} />
      </div>
      <div className="flex items-center gap-4 h-full">
        <BrightnessSlider />
        <span className="w-px h-4 bg-deep-divider" />
        <UserChip email={email} />
        <GearButton />
      </div>
    </nav>
  );
}
