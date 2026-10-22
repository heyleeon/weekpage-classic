// Calendar writes (ui-spec §2.6–§2.8): what the double-click input saves, item edits, deleting an
// event, and what a drag drop persists (same day: the day's order; another day: the move + the
// target day's order as ONE undoable action). Everything goes through useDataStore.mutate.

import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { applyCalMove, type CalMove, type CalMoveRejection, planCalMove } from "@/lib/calendar";
import { nowMs } from "@/lib/clock";
import { monthDayLabel } from "@/lib/dates";
import { parseTime } from "@/lib/parseTime";
import type { CalItem, Mutation, Snapshot } from "@/types/domain";
import { droppedDayKeys, insertedDayKeys, withDayOrder } from "./dayOrder";

/** Max characters of the double-click input (ui-spec §2.6). */
export const CAL_INPUT_MAX = 200;

/** What the preview line under the input shows (ui-spec §2.6 table). */
export type InputPreview =
  | { kind: "empty" }
  | { kind: "timed"; time: string; title: string }
  | { kind: "untimed"; title: string }
  | { kind: "noTitle"; time: string };

/** Pasted / typed text → one line, at most 200 characters. */
export function cleanInput(raw: string): string {
  return raw.replace(/\r\n|\r|\n/g, " ").slice(0, CAL_INPUT_MAX);
}

/**
 * Preview line under the input, or null when it would only repeat the typed text (ui-spec §2.6,
 * 2026-10-02). Shown when saving rewrites the text (「下午3点 开会」 → 「15:00 开会」), while the
 * title is missing, when an edit drops the item's time, and as the hint of an empty new input.
 * `initial` = the text an edit started from (editText); an unchanged edit saves nothing.
 */
export function inputPreview(raw: string, initial = ""): InputPreview | null {
  const text = raw.trim();
  const before = initial.trim();
  if (before !== "" && text === before) return null;
  if (text === "") return before === "" ? { kind: "empty" } : null;
  const p = parseTime(text);
  if (p.time === null) {
    const droppedTime = before !== "" && parseTime(before).time !== null;
    return p.title !== text || droppedTime ? { kind: "untimed", title: p.title } : null;
  }
  const time = p.endTime ? `${p.time}–${p.endTime}` : p.time;
  if (p.title === "") return { kind: "noTitle", time };
  // Same spelling editText prefills, so a reopened item reads as already tidy.
  const tidy = `${p.endTime ? `${p.time}-${p.endTime}` : p.time} ${p.title}`;
  return text === tidy ? null : { kind: "timed", time, title: p.title };
}

/** Text the input starts with when an existing item is edited (ui-spec §2.8). */
export function editText(item: CalItem): string {
  if (item.kind === "event" && item.time) {
    return `${item.endTime ? `${item.time}-${item.endTime}` : item.time} ${item.title}`;
  }
  if (item.kind === "reminder" && item.time) return `${item.time} ${item.title}`;
  return item.title;
}

/** Result of a commit: close the input, or keep it open (e.g. time without a title). */
export type CommitResult = "close" | "keep";

const highlightNew = (m: Mutation) => (m.id ? { id: m.id, reason: "new" as const } : null);

/** Double-click input on `date` (new event). `viaEnter` = Enter (blur never keeps it open). */
export function commitNewEvent(date: string, raw: string, viaEnter: boolean): CommitResult {
  const text = raw.trim();
  if (text === "") return "close";
  const p = parseTime(text);
  if (p.title === "") return viaEnter ? "keep" : "close";
  void useDataStore
    .getState()
    .mutate(
      () =>
        api.createEvent({ date, time: p.time, endTime: p.time ? p.endTime : null, title: p.title }),
      { highlight: highlightNew },
    );
  return "close";
}

/** Toast after deleting an event: 「已删除「看房」」 / "Deleted “看房”" (ui-spec §15.3). */
export function deletedToast(title: string): string {
  return t("calendar.deletedToast", { title });
}

export function deleteEventItem(item: CalItem): void {
  if (item.kind !== "event") return;
  void useDataStore
    .getState()
    .mutate(() => api.deleteEvent(item.sourceId), { toast: { text: deletedToast(item.title) } });
}

/** In-place edit of an existing event or reminder (ui-spec §2.8). */
export function commitItemEdit(item: CalItem, raw: string, viaEnter: boolean): CommitResult {
  const text = raw.trim();
  const initial = editText(item);
  if (text === initial.trim()) return "close";
  if (text === "") {
    // Clearing an event and pressing Enter deletes it (undo via toast); blur just restores.
    if (item.kind === "event" && viaEnter) deleteEventItem(item);
    return "close";
  }
  const p = parseTime(text);
  if (p.title === "") return viaEnter ? "keep" : "close";
  const { mutate } = useDataStore.getState();
  if (item.kind === "event") {
    void mutate(() =>
      api.updateEvent(item.sourceId, {
        date: item.date,
        time: p.time,
        endTime: p.time ? p.endTime : null,
        title: p.title,
      }),
    );
  } else if (item.kind === "reminder") {
    void mutate(() =>
      api.updateTodo(item.sourceId, {
        title: p.title,
        remindDate: item.date,
        remindTime: p.time,
      }),
    );
  }
  return "close";
}

/** Double-click on a task-derived item opens the task detail (ui-spec §2.5). */
export function openTaskDetail(item: CalItem): void {
  if (!item.taskId) return;
  useUiStore
    .getState()
    .openOverlay(
      item.kind === "checkpoint"
        ? { kind: "taskDetail", taskId: item.taskId, focusKeyPointId: item.sourceId }
        : { kind: "taskDetail", taskId: item.taskId },
    );
}

/**
 * Drop inside the same cell: patch the snapshot locally (no flicker), then hand every key of the
 * day in the new order to `setDayOrder`. Returns the keys sent.
 */
export function commitDayOrder(
  date: string,
  items: CalItem[],
  activeKey: string,
  index: number,
): string[] {
  const keys = droppedDayKeys(items, activeKey, index);
  const data = useDataStore.getState();
  data.patchLocal((s: Snapshot) => withDayOrder(s, date, keys, nowMs()));
  void data
    .mutate(() => api.setDayOrder(date, keys))
    .then((m) => {
      // A failed write leaves the optimistic order on screen: read the truth back.
      if (!m) void useDataStore.getState().refresh();
    });
  return keys;
}

/** Toast after a cross-day drop: 「已移到 10月3日」 / "Moved to Oct 3" (+ 撤销). */
export function movedToast(date: string): string {
  return t("calendar.movedToast", { day: monthDayLabel(date) });
}

/** Short explanation when a drop on another day is refused (no undo). */
export function moveRejectedText(reason: CalMoveRejection): string {
  return t(`calendar.moveRejected.${reason}`);
}

function runMove(move: CalMove): Promise<Mutation> {
  switch (move.kind) {
    case "event":
      return api.updateEvent(move.id, move.input);
    case "todo":
      return api.updateTodo(move.id, move.input);
    case "keyPoint":
      return api.updateKeyPoint(move.id, move.input);
    case "taskDates":
      return api.setTaskDates(move.id, move.startDate, move.dueDate);
  }
}

/** Whether `item` may be dropped on `date` (another day); null = fine, else the reason. */
export function moveRejection(item: CalItem, date: string): CalMoveRejection | null {
  const snap = useDataStore.getState().snap;
  if (!snap) return "locked";
  const plan = planCalMove(snap, item, date, useUiStore.getState().today);
  return plan.ok ? null : plan.reason;
}

/**
 * Drop on another day (ui-spec §2.7): moves the record (event date / reminder date / key point
 * date / task start or due) and stores the target day's order with the item at `index` among
 * `targetItems` (the day's items before the drop). The snapshot is patched first (no flicker); the
 * toast 「已移到 10月3日」 undoes both writes. A refused move shows why and returns false.
 */
export function commitMove(
  item: CalItem,
  date: string,
  targetItems: CalItem[],
  index: number,
): boolean {
  const data = useDataStore.getState();
  const ui = useUiStore.getState();
  if (!data.snap || item.date === date) return false;
  const plan = planCalMove(data.snap, item, date, ui.today);
  if (!plan.ok) {
    if (plan.reason !== "locked") {
      ui.showToast({ text: moveRejectedText(plan.reason), opIds: [], tone: "notice" });
    }
    return false;
  }
  const keys = insertedDayKeys(targetItems, item.key, index);
  data.patchLocal((s: Snapshot) => withDayOrder(applyCalMove(s, plan.move), date, keys, nowMs()));
  const opIds: string[] = [];
  void data
    .mutate(async () => {
      const moved = await runMove(plan.move);
      opIds.push(moved.opId);
      try {
        opIds.push((await api.setDayOrder(date, keys)).opId);
      } catch (e) {
        // The move itself landed (and stays undoable); only the position in the day is lost.
        api.log(
          "warn",
          `set_day_order after a move failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return moved;
    })
    .then((m) => {
      if (!m) {
        void useDataStore.getState().refresh();
        return;
      }
      useUiStore.getState().showToast({ text: movedToast(date), opIds });
    });
  return true;
}
