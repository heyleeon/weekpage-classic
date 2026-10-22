// Today pill on the calendar page (ui-spec §3; the overdue part since 2026-10-02, §9.3).

import type { Snapshot, Task, TodayPillView } from "@/types/domain";
import { addDays, diffDays } from "./dates";
import { overdueDays } from "./keyPoint";
import { displayStatus } from "./taskMath";

/** Board position: column, then sort key (plain `<`). */
function boardCmp(a: Task, b: Task): number {
  if (a.boardColumn !== b.boardColumn) return a.boardColumn - b.boardColumn;
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

export function todayPill(snap: Snapshot, today: string): TodayPillView {
  const todos = snap.todos.filter((t) => t.doneDate === null).length;

  // Nearest due among tasks on the board that are neither done nor overdue.
  const live = snap.tasks.filter((t) => t.archivedDate === null);
  let dueTask: Task | null = null;
  for (const t of live) {
    if (t.dueDate === null || t.dueDate < today) continue;
    const s = displayStatus(t, today);
    if (s === "done" || s === "overdue") continue;
    if (
      dueTask === null ||
      t.dueDate < (dueTask.dueDate as string) ||
      (t.dueDate === dueTask.dueDate && boardCmp(t, dueTask) < 0)
    ) {
      dueTask = t;
    }
  }
  const due = dueTask
    ? {
        taskId: dueTask.id,
        title: dueTask.title,
        days: diffDays(today, dueTask.dueDate as string),
      }
    : null;

  // Key points to check tomorrow (the ones that are on the calendar: check / dated wait).
  const tomorrow = addDays(today, 1);
  const byId = new Map(live.map((t) => [t.id, t]));
  const checkTasks: Task[] = [];
  let checkCount = 0;
  for (const k of snap.keyPoints) {
    if (k.date !== tomorrow || k.doneDate !== null) continue;
    if (k.kind !== "check" && k.kind !== "wait") continue;
    const t = byId.get(k.taskId);
    if (!t || t.status === "done") continue;
    checkCount++;
    checkTasks.push(t);
  }
  checkTasks.sort(boardCmp);
  const check =
    checkCount > 0
      ? { taskId: checkTasks[0].id, title: checkTasks[0].title, more: checkCount - 1 }
      : null;

  // Overdue steps (§9.3), across tasks: the earliest date first, then board order.
  let overdueFirst: { task: Task; date: string } | null = null;
  let overdueCount = 0;
  for (const k of snap.keyPoints) {
    const t = byId.get(k.taskId);
    if (!t || overdueDays(k, t, today) === 0) continue;
    overdueCount++;
    const date = k.date as string;
    if (
      overdueFirst === null ||
      date < overdueFirst.date ||
      (date === overdueFirst.date && boardCmp(t, overdueFirst.task) < 0)
    ) {
      overdueFirst = { task: t, date };
    }
  }
  const overdue = overdueFirst
    ? { taskId: overdueFirst.task.id, title: overdueFirst.task.title, count: overdueCount }
    : null;

  const inbox = snap.inbox.length;
  return {
    overdue,
    todos,
    due,
    check,
    inbox,
    empty: overdue === null && todos === 0 && due === null && check === null && inbox === 0,
  };
}
