// Page title (ui-spec §1.3): calendar = month / year of the first visible day,
// tasks and archive = today's date / weekday. Part of the window drag region.

import { useUiStore } from "@/hooks/useUiStore";
import { calendarTitle, todayTitle } from "@/lib/dates";
import styles from "./PageTitle.module.css";

export function PageTitle() {
  const page = useUiStore((s) => s.page);
  const anchor = useUiStore((s) => s.calendarAnchor);
  const today = useUiStore((s) => s.today);
  const { main, sub } = page === "calendar" ? calendarTitle(anchor) : todayTitle(today);
  return (
    <h1 className={styles.title} data-tauri-drag-region>
      <span className={styles.main} data-tauri-drag-region>
        {main}
      </span>
      <span className={styles.sub} data-tauri-drag-region>
        {sub}
      </span>
    </h1>
  );
}
