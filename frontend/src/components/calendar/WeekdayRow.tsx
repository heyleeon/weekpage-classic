// 周一 … 周日 above the grid (ui-spec §2.1): h ≈26, 11px --text-muted, bottom line across the grid.
// Names follow the active language (lib/dates.ts weekdayNames: 「周一」 / "Mon").

import { weekdayNames } from "@/lib/dates";
import styles from "./WeekdayRow.module.css";

export function WeekdayRow() {
  return (
    <div className={styles.row} aria-hidden="true">
      {weekdayNames().map((d) => (
        <div key={d} className={styles.day}>
          {d}
        </div>
      ))}
    </div>
  );
}
