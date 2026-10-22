// Small calendar for the date picker (ui-spec §12.1, circles, single date) and 「变成任务」
// (§11.2–§11.3, square cells, start–end band). Shows `weeks` weeks from the Monday of today,
// pages by the same number of weeks; the 1st of a month reads 「10/1」. Past days read grey and
// are disabled unless `allowPast`; today keeps its `--today` frame even when selected.
// Selection logic (e.g. §11.3 "click twice") stays with the owner: this component reports picks.

import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addDays,
  diffDays,
  formatMD,
  mondayOf,
  monthName,
  monthShortName,
  weekdayNarrowNames,
} from "@/lib/dates";
import { cx } from "./cx";
import styles from "./MiniCalendar.module.css";

export type MiniCalendarProps = {
  today: string;
  /** single: `value`; range: `range` (end may be null while picking). */
  mode?: "single" | "range";
  value?: string | null;
  range?: { start: string | null; end: string | null };
  onPick: (date: string) => void;
  /** Selected colour: rm (reminder) or st (task range). */
  color?: "rm" | "st";
  /** circle = date picker look; cell = square cells with a range band. */
  shape?: "circle" | "cell";
  weeks?: number;
  /** Allow picking days before today (task start dates, detail view date edits). */
  allowPast?: boolean;
};

/** 「9月」 / "September"; two months: 「9月 – 10月」 / "Sep – Oct". */
function monthLabel(days: string[], t: TFunction): string {
  const first = Number(days[0].slice(5, 7));
  const last = Number(days[days.length - 1].slice(5, 7));
  if (first === last) return monthName(first);
  return t("ui.miniCalendar.monthRange", {
    from: monthShortName(first),
    to: monthShortName(last),
  });
}

export function MiniCalendar({
  today,
  mode = "single",
  value = null,
  range,
  onPick,
  color = "rm",
  shape = "circle",
  weeks = 3,
  allowPast = false,
}: MiniCalendarProps) {
  const { t } = useTranslation();
  const base = useMemo(() => mondayOf(today), [today]);
  const [page, setPage] = useState(0);
  const start = addDays(base, page * weeks * 7);
  const days = useMemo(
    () => Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)),
    [start, weeks],
  );
  const lo = range?.start ?? null;
  const hi = range?.end ?? null;

  return (
    <div className={styles.cal}>
      <div className={styles.header}>
        <span className={styles.month}>{monthLabel(days, t)}</span>
        <span className={styles.pager}>
          <button
            type="button"
            className={styles.pageBtn}
            aria-label={t("ui.miniCalendar.prevWeeks", { count: weeks })}
            disabled={!allowPast && page <= 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <CaretLeftIcon size={11} />
          </button>
          <button
            type="button"
            className={styles.pageBtn}
            aria-label={t("ui.miniCalendar.nextWeeks", { count: weeks })}
            onClick={() => setPage((p) => p + 1)}
          >
            <CaretRightIcon size={11} />
          </button>
        </span>
      </div>
      <div className={styles.grid}>
        {weekdayNarrowNames().map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed Monday-first columns (English repeats letters)
          <span key={i} className={styles.weekday} aria-hidden="true">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const past = diffDays(today, d) < 0;
          const isStart = mode === "range" && lo === d;
          const isEnd = mode === "range" && hi === d;
          const selected = mode === "single" ? value === d : isStart || isEnd;
          const inRange = mode === "range" && lo !== null && hi !== null && d > lo && d < hi;
          const label = d.endsWith("-01") ? formatMD(d) : String(Number(d.slice(8)));
          return (
            <button
              key={d}
              type="button"
              aria-pressed={selected}
              aria-label={d}
              data-date={d}
              disabled={past && !allowPast}
              className={styles.cell}
              onClick={() => onPick(d)}
            >
              <span
                className={cx(
                  styles.num,
                  shape === "cell" && styles.numCell,
                  past && allowPast && styles.past,
                  d === today && styles.today,
                  selected && styles.selected,
                  selected && styles[color],
                  inRange && styles.inRange,
                  shape === "cell" && isStart && hi !== null && styles.rangeStart,
                  shape === "cell" && isEnd && styles.rangeEnd,
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
