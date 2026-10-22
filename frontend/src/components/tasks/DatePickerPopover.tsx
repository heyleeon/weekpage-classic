// Date picker popover (ui-spec §12): todo 「设提醒」 and inbox 「定日期」 share it. PopoverHost
// positions it (the opener anchors it 12px right of the left column, top-aligned with the row).
//
// Quick chips + MiniCalendar (single, pages 3 weeks) + optional time (parseTimeOnly) + footer
// summary (reminderSummary). 确定 / Enter saves, 不提醒 clears (todo) or just closes (inbox),
// Esc / outside click closes without saving (PopoverHost).

import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { MiniCalendar } from "@/components/ui/MiniCalendar";
import { Popover } from "@/components/ui/Popover";
import { Toggle } from "@/components/ui/Toggle";
import { notReady, useAttention } from "@/hooks/useAttention";
import { useDataStore } from "@/hooks/useDataStore";
import { isImeKey } from "@/hooks/useImeSafeEnter";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { t as tr } from "@/i18n";
import { api } from "@/lib/api";
import { addDays, diffDays, mondayOf } from "@/lib/dates";
import { parseTimeOnly } from "@/lib/parseTime";
import { inboxTriageToast } from "@/lib/toasts";
import { reminderSummary } from "@/lib/todos";
import styles from "./DatePickerPopover.module.css";

export type DatePickerPopoverProps = {
  purpose: "todoReminder" | "inboxSchedule";
  /** Todo id (todoReminder) or inbox item id (inboxSchedule). */
  targetId: string;
};

/** Quick chips (ui-spec §12.1): 今天 / 明天 / 周五 (下周五 from Fri–Sun) / 下周一. Labels are in
 *  the language active at call time. */
export function quickDates(today: string): { label: string; date: string }[] {
  const monday = mondayOf(today);
  const friday = addDays(monday, 4);
  const lateWeek = diffDays(friday, today) >= 0;
  return [
    { label: tr("tasks.picker.quick.today"), date: today },
    { label: tr("tasks.picker.quick.tomorrow"), date: addDays(today, 1) },
    lateWeek
      ? { label: tr("tasks.picker.quick.nextFriday"), date: addDays(friday, 7) }
      : { label: tr("tasks.picker.quick.friday"), date: friday },
    { label: tr("tasks.picker.quick.nextMonday"), date: addDays(monday, 7) },
  ];
}

const ARROW_STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

export default function DatePickerPopover({ purpose, targetId }: DatePickerPopoverProps) {
  const { t } = useTranslation();
  const today = useToday();
  const snap = useDataStore((s) => s.snap);
  const mutate = useDataStore((s) => s.mutate);
  const close = useUiStore((s) => s.closePopover);
  const todo = purpose === "todoReminder" ? snap?.todos.find((t) => t.id === targetId) : undefined;
  const item = purpose === "inboxSchedule" ? snap?.inbox.find((i) => i.id === targetId) : undefined;

  const [date, setDate] = useState<string | null>(todo?.remindDate ?? null);
  const [timeOn, setTimeOn] = useState(todo?.remindTime != null);
  const [timeText, setTimeText] = useState(todo?.remindTime ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const flagCalendar = useAttention(calendarRef);
  const time = timeOn ? parseTimeOnly(timeText) : null;

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const confirm = async () => {
    // No day picked yet: point at the calendar instead of doing nothing.
    if (date === null) {
      flagCalendar();
      return;
    }
    close();
    if (todo) {
      await mutate(() =>
        api.updateTodo(todo.id, { title: todo.title, remindDate: date, remindTime: time }),
      );
    } else if (item) {
      await mutate(
        () => api.createTodo({ title: item.text, remindDate: date, remindTime: time }, item.id),
        {
          toast: inboxTriageToast("scheduled", date),
          highlight: (m) => (m.id ? { id: m.id, reason: "fromInbox" } : null),
        },
      );
    }
  };

  const noReminder = async () => {
    close();
    if (todo && todo.remindDate !== null) {
      await mutate(() =>
        api.updateTodo(todo.id, { title: todo.title, remindDate: null, remindTime: null }),
      );
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      if (isImeKey(e, Number.NEGATIVE_INFINITY, 0)) return;
      if (e.target instanceof HTMLElement && e.target.dataset.nativeEnter) return;
      e.preventDefault();
      void confirm();
      return;
    }
    const step = ARROW_STEP[e.key];
    if (step === undefined || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    const next = date ? addDays(date, step) : today;
    if (diffDays(today, next) >= 0) setDate(next);
  };

  return (
    <Popover label={t("tasks.picker.label")} width={280} className={styles.popover}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Enter / arrow keys for the whole panel */}
      <div ref={rootRef} tabIndex={-1} className={styles.root} onKeyDown={onKeyDown}>
        <div className={styles.head}>
          <BellIcon size={16} className={styles.bell} />
          {purpose === "todoReminder"
            ? t("tasks.picker.titleReminder")
            : t("tasks.picker.titleSchedule")}
        </div>
        <div className={styles.quick}>
          {quickDates(today).map((q) => (
            <button
              key={q.label}
              type="button"
              className={cx(styles.chip, date === q.date && styles.chipOn)}
              onClick={() => setDate(q.date)}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div ref={calendarRef} className={styles.calendarWrap} tabIndex={-1}>
          <MiniCalendar today={today} value={date} onPick={setDate} color="rm" />
        </div>
        <div className={styles.time}>
          <Toggle
            checked={timeOn}
            tone="rm"
            label={t("tasks.picker.time")}
            onChange={(on) => {
              setTimeOn(on);
              if (on) window.setTimeout(() => timeRef.current?.focus(), 0);
            }}
          />
          <span className={styles.timeLabel}>{t("tasks.picker.timeOptional")}</span>
          {timeOn ? (
            <input
              ref={timeRef}
              className={styles.timeInput}
              value={timeText}
              placeholder="HH:MM"
              aria-label={t("tasks.picker.timeInput")}
              onChange={(e) => setTimeText(e.target.value)}
              onBlur={() => {
                if (time) setTimeText(time);
              }}
            />
          ) : (
            <span className={styles.timeOff}>{t("tasks.picker.timeOff")}</span>
          )}
        </div>
        <div className={styles.foot}>
          <span className={cx(styles.summary, date === null && styles.summaryEmpty)}>
            {reminderSummary(date, time, today, purpose)}
          </span>
          <Button
            variant="text"
            className={styles.none}
            data-native-enter="true"
            onClick={() => void noReminder()}
          >
            {t("tasks.picker.noReminder")}
          </Button>
          <Button
            variant="ink"
            className={cx(styles.ok, date === null && notReady)}
            aria-disabled={date === null}
            onClick={() => void confirm()}
          >
            {t("common.actions.ok")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
