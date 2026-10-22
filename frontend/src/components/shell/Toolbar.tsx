// Toolbar (ui-spec §1.3): title on the left; on the right
//   calendar page:         [回到今天 (only away from home)] [⚙] [日历 ⌘1 | 任务 ⌘2]
//   tasks / archive pages: [归档 N] [⚙] [日历 ⌘1 | 任务 ⌘2]
// Weeks shown and the first row live in the settings panel; week navigation is the calendar
// page's own (wheel / drag / keys, components/calendar/calendarNav.ts). Units never lay out the
// toolbar. Empty toolbar space drags the window; the controls are not drag regions.

import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { useTranslation } from "react-i18next";
import ArchiveToolbarButton from "@/components/archive/ArchiveToolbarButton";
import BackToToday from "@/components/calendar/BackToToday";
import { IconButton } from "@/components/ui/IconButton";
import { useUiStore } from "@/hooks/useUiStore";
import { isMac } from "@/lib/platform";
import { PageSwitch } from "./PageSwitch";
import { PageTitle } from "./PageTitle";
import styles from "./Toolbar.module.css";

/** Glass gear → settings panel (also mod+, from useGlobalHotkeys). */
export function SettingsButton() {
  const { t } = useTranslation();
  const openOverlay = useUiStore((s) => s.openOverlay);
  const mac = isMac();
  return (
    <IconButton
      variant="plain"
      className={styles.gear}
      label={t("shell.settings.label")}
      title={t("shell.settings.tooltip", { combo: mac ? "⌘," : "Ctrl+," })}
      aria-keyshortcuts={mac ? "Meta+," : "Control+,"}
      style={{ width: "var(--capsule-h)", height: "var(--capsule-h)" }}
      icon={<GearSixIcon size={17} aria-hidden="true" />}
      onClick={() => openOverlay({ kind: "settings" })}
    />
  );
}

export function Toolbar() {
  const onCalendar = useUiStore((s) => s.page === "calendar");
  return (
    <header className={styles.toolbar} data-tauri-drag-region>
      <PageTitle />
      <div className={styles.right} data-tauri-drag-region>
        {onCalendar ? <BackToToday /> : <ArchiveToolbarButton />}
        <SettingsButton />
        <PageSwitch />
      </div>
    </header>
  );
}
