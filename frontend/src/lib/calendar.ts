// Calendar item derivation (ui-spec §2.5, §2.7) and the rules of a cross-day
// drop (which write moves an item to another date, which moves are refused, the optimistic
// snapshot). Visible range and titles live in lib/dates.ts (visibleRange / calendarTitle).

import type {
  CalItem,
  EventInput,
  KeyPoint,
  KeyPointInput,
  Snapshot,
  Task,
  TodoInput,
} from "@/types/domain";
import { addDays } from "./dates";
import { calendarLabel, findDateTokens, overdueDays } from "./keyPoint";
import { displayStatus } from "./taskMath";

/** Plain `<` comparison (sort keys are ASCII base62; never localeCompare). */
function cmp(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Default-order group (ui-spec §2.7): event → checkpoint → reminder → start → due. */
const GROUP: Record<CalItem["kind"], number> = {
  event: 0,
  checkpoint: 1,
  reminder: 2,
  start: 3,
  due: 4,
};

type Ranked = { item: CalItem; rank: (string | number)[] };

/** Archived tasks keep only marks on or before the archive date ("past marks stay"). */
function keepMark(task: Task, date: string): boolean {
  return task.archivedDate === null || date <= task.archivedDate;
}

/** Items per date in [from, to], already in display order (manual day order first). Every date of
 *  the range is present (empty days map to []). */
export function deriveCalendar(
  snap: Snapshot,
  from: string,
  to: string,
  today: string,
): Map<string, CalItem[]> {
  const inRange = (d: string | null): d is string => d !== null && d >= from && d <= to;
  const ranked: Ranked[] = [];
  const add = (item: CalItem, rank: (string | number)[]) =>
    ranked.push({ item, rank: [GROUP[item.kind], ...rank] });

  for (const e of snap.events) {
    if (!inRange(e.date)) continue;
    add(
      {
        key: `event:${e.id}`,
        kind: "event",
        date: e.date,
        title: e.title,
        time: e.time,
        endTime: e.endTime,
        done: false,
        overdue: false,
        sourceId: e.id,
        taskId: null,
      },
      // No time first, then by time, then by creation.
      [e.time === null ? 0 : 1, e.time ?? "", e.createdAt, e.id],
    );
  }

  for (const t of snap.todos) {
    if (!inRange(t.remindDate)) continue;
    add(
      {
        key: `todo:${t.id}`,
        kind: "reminder",
        date: t.remindDate,
        title: t.title,
        time: t.remindTime,
        endTime: null,
        done: t.doneDate !== null,
        overdue: false,
        sourceId: t.id,
        taskId: null,
      },
      [t.sortKey, t.id],
    );
  }

  const tasks = new Map(snap.tasks.map((t) => [t.id, t]));
  for (const t of snap.tasks) {
    const board = [t.boardColumn, t.sortKey, t.id];
    const done = t.status === "done";
    if (inRange(t.startDate) && keepMark(t, t.startDate)) {
      add(taskItem(t, "start", t.startDate, done, false), board);
    }
    if (inRange(t.dueDate) && keepMark(t, t.dueDate)) {
      const overdue = t.archivedDate === null && displayStatus(t, today) === "overdue";
      add(taskItem(t, "due", t.dueDate, done, overdue), board);
    }
  }

  for (const k of snap.keyPoints) {
    if ((k.kind !== "check" && k.kind !== "wait") || !inRange(k.date)) continue;
    const t = tasks.get(k.taskId);
    if (!t || !keepMark(t, k.date)) continue;
    add(kpItem(k, t, today), [t.boardColumn, t.sortKey, t.id, k.sortKey, k.id]);
  }

  ranked.sort((a, b) => {
    const n = Math.max(a.rank.length, b.rank.length);
    for (let i = 0; i < n; i++) {
      const c = cmp(a.rank[i] ?? "", b.rank[i] ?? "");
      if (c !== 0) return c;
    }
    return 0;
  });

  const out = new Map<string, CalItem[]>();
  for (let d = from; d <= to; d = addDays(d, 1)) out.set(d, []);
  for (const { item } of ranked) out.get(item.date)?.push(item);

  // Manual order: keys in the stored order first (unknown keys skipped), new items appended.
  for (const order of snap.dayOrders) {
    const items = out.get(order.date);
    if (!items || items.length === 0) continue;
    const byKey = new Map(items.map((i) => [i.key, i]));
    const first: CalItem[] = [];
    for (const key of order.itemKeys) {
      const item = byKey.get(key);
      if (item) {
        first.push(item);
        byKey.delete(key);
      }
    }
    out.set(order.date, [...first, ...items.filter((i) => byKey.has(i.key))]);
  }
  return out;
}

function taskItem(
  t: Task,
  kind: "start" | "due",
  date: string,
  done: boolean,
  overdue: boolean,
): CalItem {
  return {
    key: `${kind}:${t.id}`,
    kind,
    date,
    title: t.title,
    time: null,
    endTime: null,
    done,
    overdue,
    sourceId: t.id,
    taskId: t.id,
  };
}

function kpItem(k: KeyPoint, t: Task, today: string): CalItem {
  return {
    key: `kp:${k.id}`,
    kind: "checkpoint",
    date: k.date as string,
    title: calendarLabel(k, t.title, today),
    time: null,
    endTime: null,
    done: k.doneDate !== null || t.status === "done",
    overdue: overdueDays(k, t, today) > 0,
    sourceId: k.id,
    taskId: t.id,
  };
}

/** Keys of a day's items in their current order, for `setDayOrder` after a drag. */
export function dayItemKeys(items: CalItem[]): string[] {
  return items.map((i) => i.key);
}

// ── cross-day drop (ui-spec §2.7) ────────────────────────────────────────────────────────────

/** The one write that moves a calendar item to another date. */
export type CalMove =
  | { kind: "event"; id: string; input: EventInput }
  | { kind: "todo"; id: string; input: TodoInput }
  | { kind: "keyPoint"; id: string; input: KeyPointInput }
  | { kind: "taskDates"; id: string; startDate: string; dueDate: string | null };

/** Why a drop on another date is refused: a start after the due date, a due before the start,
 *  or a locked source (archived task, row gone). */
export type CalMoveRejection = "startAfterDue" | "dueBeforeStart" | "locked";

export type CalMovePlan = { ok: true; move: CalMove } | { ok: false; reason: CalMoveRejection };

/** Keys of items that cannot be dragged: every mark of an archived task (read-only history). */
export function lockedCalKeys(snap: Snapshot): Set<string> {
  const archived = new Set(snap.tasks.filter((t) => t.archivedAt !== null).map((t) => t.id));
  const out = new Set<string>();
  for (const id of archived) {
    out.add(`start:${id}`);
    out.add(`due:${id}`);
  }
  for (const k of snap.keyPoints) if (archived.has(k.taskId)) out.add(`kp:${k.id}`);
  return out;
}

/** 「10/2」 → 「10/4」, 「10月2日」 → 「10月4日」 (same style; the 日 / 号 suffix is kept). */
function dateTokenLike(original: string, date: string): string {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  // not-ui-copy: rewrites a date the user typed, in the style they typed it
  if (original.includes("月")) return `${m}月${d}${original.endsWith("号") ? "号" : "日"}`;
  return `${m}/${d}`;
}

/**
 * A key point text whose date fragments that meant `from` now say `to` (「等审批 · 10/1 查」 moved
 * to 10/3 → 「等审批 · 10/3 查」), so the task card and the detail agree with the calendar.
 * Fragments for other dates and texts without one are left alone.
 */
export function retargetDateText(text: string, from: string, to: string, today: string): string {
  let out = text;
  for (const tok of findDateTokens(text, today).reverse()) {
    if (tok.date !== from) continue;
    out =
      out.slice(0, tok.start) +
      dateTokenLike(text.slice(tok.start, tok.end), to) +
      out.slice(tok.end);
  }
  return out;
}

/**
 * The write for dropping `item` on `to` (≠ its date): an event or a reminder keeps its time and
 * title; a key point keeps its kind and text (date fragment retargeted); a task start may not
 * pass the due date and a due may not come before the start (equal is fine).
 */
export function planCalMove(snap: Snapshot, item: CalItem, to: string, today: string): CalMovePlan {
  const locked: CalMovePlan = { ok: false, reason: "locked" };
  switch (item.kind) {
    case "event": {
      const e = snap.events.find((x) => x.id === item.sourceId);
      if (!e) return locked;
      return {
        ok: true,
        move: {
          kind: "event",
          id: e.id,
          input: { date: to, time: e.time, endTime: e.endTime, title: e.title },
        },
      };
    }
    case "reminder": {
      const t = snap.todos.find((x) => x.id === item.sourceId);
      if (!t) return locked;
      return {
        ok: true,
        move: {
          kind: "todo",
          id: t.id,
          input: { title: t.title, remindDate: to, remindTime: t.remindTime },
        },
      };
    }
    case "checkpoint": {
      const k = snap.keyPoints.find((x) => x.id === item.sourceId);
      const task = k && snap.tasks.find((x) => x.id === k.taskId);
      if (!k || !task || task.archivedAt !== null) return locked;
      const text = k.date ? retargetDateText(k.text, k.date, to, today) : k.text;
      return {
        ok: true,
        move: { kind: "keyPoint", id: k.id, input: { kind: k.kind, text, date: to, who: k.who } },
      };
    }
    case "start":
    case "due": {
      const task = snap.tasks.find((x) => x.id === item.sourceId);
      if (!task || task.archivedAt !== null) return locked;
      if (item.kind === "start") {
        if (task.dueDate !== null && to > task.dueDate)
          return { ok: false, reason: "startAfterDue" };
        return {
          ok: true,
          move: { kind: "taskDates", id: task.id, startDate: to, dueDate: task.dueDate },
        };
      }
      if (to < task.startDate) return { ok: false, reason: "dueBeforeStart" };
      return {
        ok: true,
        move: { kind: "taskDates", id: task.id, startDate: task.startDate, dueDate: to },
      };
    }
  }
}

/** Optimistic snapshot of a move (shown until the command's refresh replaces it). */
export function applyCalMove(snap: Snapshot, move: CalMove): Snapshot {
  switch (move.kind) {
    case "event":
      return {
        ...snap,
        events: snap.events.map((e) =>
          e.id === move.id
            ? {
                ...e,
                date: move.input.date,
                time: move.input.time ?? null,
                endTime: move.input.endTime ?? null,
              }
            : e,
        ),
      };
    case "todo":
      return {
        ...snap,
        todos: snap.todos.map((t) =>
          t.id === move.id
            ? {
                ...t,
                remindDate: move.input.remindDate ?? null,
                remindTime: move.input.remindTime ?? null,
              }
            : t,
        ),
      };
    case "keyPoint":
      return {
        ...snap,
        keyPoints: snap.keyPoints.map((k) =>
          k.id === move.id ? { ...k, text: move.input.text, date: move.input.date ?? null } : k,
        ),
      };
    case "taskDates":
      return {
        ...snap,
        tasks: snap.tasks.map((t) =>
          t.id === move.id ? { ...t, startDate: move.startDate, dueDate: move.dueDate } : t,
        ),
      };
  }
}
