import { Wordmark } from "./wordmark";
import { ModuleSwitcher } from "./module-switcher";
import { BrightnessSlider } from "./brightness-slider";
import { UserChip } from "./user-chip";
import { GearButton } from "./gear-button";
import { SectionTabs } from "@/components/engine-room/section-tabs";

/**
 * Top Nav — consolidated in Phase 7 chrome cleanup.
 *
 * One row, everything orientation + navigation lives here:
 *   Wordmark · Module chip · [Section tabs when inside a module]
 *                                   ...
 *                        Legibility · User chip · Gear
 *
 * Previous versions had a separate section-tabs row below the nav and
 * a breadcrumb inside the nav. Both removed:
 *   - Section tabs moved inline (one less chrome row → more workspace)
 *   - Breadcrumb redundant with wordmark + module chip + active tab
 */
export function Nav({ email }: { email: string }) {
  return (
    <nav className="chrome-brightness h-12 flex items-center justify-between px-5 bg-ink/90 backdrop-blur-md border-b border-deep-divider relative z-10">
      <div className="flex items-center gap-5 h-full">
        <Wordmark />
        <span className="w-px h-4 bg-deep-divider" />
        <ModuleSwitcher />
        {/* Section tabs render themselves only when inside Engine Room;
            returns null on BOS-level screens like /profile or /settings. */}
        <SectionTabs />
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
