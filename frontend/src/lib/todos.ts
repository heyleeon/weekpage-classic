// Todo list partition, tags and reminder summaries (ui-spec §5.4, §5.7, §12).
// Texts come from the i18n `tasks.tag.*` / `tasks.picker.*` keys (active language at call time).

import { t } from "@/i18n";
import type { Snapshot, Todo, TodoTag } from "@/types/domain";
import { addDays, formatMD, formatMDW } from "./dates";

const bySortKey = (a: Todo, b: Todo) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
const byDoneAt = (a: Todo, b: Todo) => (a.doneAt ?? 0) - (b.doneAt ?? 0);

/**
 * open (sort order) / done today (by doneAt, oldest first) / archived (done before today, newest
 * first). `done_date < today` means archived (architecture §12: derived, never written).
 */
export function todoLists(
  snap: Snapshot,
  today: string,
): { open: Todo[]; doneToday: Todo[]; archived: Todo[] } {
  const open: Todo[] = [];
  const doneToday: Todo[] = [];
  const archived: Todo[] = [];
  for (const t of snap.todos) {
    if (t.doneDate === null) open.push(t);
    else if (t.doneDate < today) archived.push(t);
    else doneToday.push(t);
  }
  open.sort(bySortKey);
  doneToday.sort(byDoneAt);
  archived.sort((a, b) => byDoneAt(b, a));
  return { open, doneToday, archived };
}

const withTime = (text: string, time: string | null) => (time ? `${text} ${time}` : text);

/**
 * Reminder tag of a todo row (ui-spec §5.4 priority table), or null: no reminder day, or done.
 * An old to-do carries no 「昨天顺延」 tag (dropped 2026-10-02: the list is managed by hand).
 */
export function todoTag(todo: Todo, today: string): TodoTag | null {
  if (todo.doneDate !== null) return null;
  const d = todo.remindDate;
  if (d === null) return null;
  if (d < today) return { text: withTime(formatMD(d), todo.remindTime), tone: "du" };
  let text = formatMD(d);
  if (d === today) text = t("tasks.tag.today");
  else if (d === addDays(today, 1)) text = t("tasks.tag.tomorrow");
  return { text: withTime(text, todo.remindTime), tone: "rm" };
}

/**
 * Date picker footer (ui-spec §12.1 / §12.2):
 * todoReminder → 「10/9 周五 提醒」「10/9 周五 18:00 提醒」「今天 18:00 提醒」「明天 提醒」;
 * inboxSchedule → 「10/5 周一 · 进待办 + 日历」(+ time after the date when set);
 * no date yet → 「选一天」.
 */
export function reminderSummary(
  date: string | null,
  time: string | null,
  today: string,
  purpose: "todoReminder" | "inboxSchedule",
): string {
  if (date === null) return t("tasks.picker.pickDay");
  let day = formatMDW(date);
  if (date === today) day = t("tasks.picker.today");
  else if (date === addDays(today, 1)) day = t("tasks.picker.tomorrow");
  const when = withTime(day, time);
  return purpose === "todoReminder"
    ? t("tasks.picker.summaryReminder", { when })
    : t("tasks.picker.summarySchedule", { when });
}
