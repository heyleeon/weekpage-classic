// Day head (ui-spec §2.3–§2.4): 「28」 | today in a blue circle | 「10月1日」 on the 1st, then the
// holiday / solar term / adjusted-workday label in small grey text.

import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { monthDayLabel } from "@/lib/dates";
import { dayLabel } from "@/lib/holidays";
import styles from "./DayHead.module.css";

/** 「28」, or 「10月1日」 / "Oct 1" on the first day of a month (active language). */
export function dayNumberText(date: string): string {
  const d = Number(date.slice(8, 10));
  return d === 1 ? monthDayLabel(date) : String(d);
}

export function DayHead({ date, today }: { date: string; today: string }) {
  const { t } = useTranslation();
  const isToday = date === today;
  const past = date < today;
  const first = date.endsWith("-01");
  const label = dayLabel(date);
  return (
    <div className={cx(styles.head, past && styles.past)}>
      {isToday ? (
        <span className={styles.today} title={t("calendar.today")}>
          {dayNumberText(date)}
        </span>
      ) : (
        <span className={cx(styles.num, first && styles.first)}>{dayNumberText(date)}</span>
      )}
      {label && (
        <span className={styles.label} data-label-kind={label.kind}>
          {label.text}
        </span>
      )}
    </div>
  );
}
