// Calendar page: double-click input (preview, IME-safe Enter, Esc, save), drag (4px, same-day
// reorder → setDayOrder keys, cross-day moves for every item kind, refused moves, one undo), week
// scrolling (wheel notch / trackpad / list first / grab / keys), today pill texts, item edits and
// delete. Pointer geometry is faked (happy-dom has no layout): see `fakeLayout`.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import { setLang } from "@/i18n";
import { deriveCalendar } from "@/lib/calendar";
import { mockApi, mockSnapshot, resetMockBackend } from "@/lib/mockBackend";
import { todayPill } from "@/lib/todayPill";
import type { CalItem, Snapshot } from "@/types/domain";
import CalendarPage from "./CalendarPage";
import { cleanInput, commitDayOrder, commitMove, editText, inputPreview } from "./calendarActions";
import {
  droppedDayKeys,
  insertedDayKeys,
  insertIndexAt,
  isSameOrder,
  reorderItems,
  withDayOrder,
} from "./dayOrder";
import { pillParts, TodayPill } from "./TodayPill";
import { PAGE_DELAY_MS } from "./useCalDrag";
import { WeekdayRow } from "./WeekdayRow";
import { FLICK_WINDOW_MS, WHEEL_IDLE_MS } from "./weekScroll";

const TODAY = "2026-09-30";
const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

beforeEach(async () => {
  resetMockBackend();
  useUiStore.setState(
    {
      ...initialUi,
      today: TODAY,
      calendarAnchor: "2026-09-28",
      calendarWeeks: 3,
      page: "calendar",
    },
    true,
  );
  useDataStore.setState(initialData, true);
  await useDataStore.getState().refresh();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function EscRoot() {
  useEscDispatcher();
  return null;
}

function renderPage() {
  return render(
    <>
      <EscRoot />
      <CalendarPage />
    </>,
  );
}

function cell(date: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`);
  if (!el) throw new Error(`no cell ${date}`);
  return el;
}

/** Dates of the visible rows (buffer weeks excluded), top-left to bottom-right. */
function visibleDates(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-cal-row]:not([data-buffer]) [data-date]"),
  ).map((e) => e.dataset.date ?? "");
}

function kinds(date: string): string[] {
  return Array.from(cell(date).querySelectorAll<HTMLElement>("[data-kind]")).map(
    (e) => e.dataset.kind ?? "",
  );
}

function openInput(date: string): HTMLTextAreaElement {
  fireEvent.doubleClick(cell(date));
  return within(cell(date)).getByRole("textbox") as HTMLTextAreaElement;
}

/** The preview line under the input, or null when it is hidden (nothing would change). */
function preview(): string | null {
  return screen.queryByTestId("cal-input-preview")?.textContent ?? null;
}

function items(date: string): CalItem[] {
  const snap = useDataStore.getState().snap as Snapshot;
  return deriveCalendar(snap, date, date, TODAY).get(date) ?? [];
}

// ── fake layout (happy-dom has none) ─────────────────────────────────────────────────────────
// Viewport 700×600 at the origin; 3 visible rows of 200 (buffer rows at −200 and 600); 7 columns
// of 100; a day list starts 30 below the cell top; items are 18 high with a 2 gap (+3 padding).

const COL_W = 100;
const ROW_H = 200;
const HEAD_H = 30;
type Box = { left: number; top: number; width: number; height: number };

function boxOf(el: Element | null): Box | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.hasAttribute("data-cal-viewport"))
    return { left: 0, top: 0, width: 7 * COL_W, height: 3 * ROW_H };
  if (el.dataset.date) {
    const row = el.closest("[data-cal-row]");
    if (!row) return null;
    const r = Array.from(document.querySelectorAll("[data-cal-row]")).indexOf(row) - 1;
    const c = Array.from(row.children).indexOf(el);
    return { left: c * COL_W, top: r * ROW_H, width: COL_W, height: ROW_H };
  }
  if (Array.from(el.children).some((c) => c.hasAttribute("data-day-items"))) {
    const cell = boxOf(el.closest("[data-date]"));
    return (
      cell && { left: cell.left, top: cell.top + HEAD_H, width: COL_W, height: ROW_H - HEAD_H }
    );
  }
  const list = el.parentElement;
  if (list?.hasAttribute("data-day-items")) {
    const box = boxOf(list.parentElement);
    const i = Array.from(list.children).indexOf(el);
    return box && { left: box.left, top: box.top + 3 + i * 20, width: COL_W, height: 18 };
  }
  return null;
}

function fakeLayout(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const b = boxOf(this) ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      x: b.left,
      y: b.top,
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
      right: b.left + b.width,
      bottom: b.top + b.height,
      toJSON: () => b,
    } as DOMRect;
  });
}

/** y that inserts before the `index`-th item of a day (above its midpoint). */
function slotY(date: string, index: number): number {
  return (boxOf(cell(date))?.top ?? 0) + HEAD_H + 3 + index * 20 + 2;
}

function colX(date: string): number {
  return (boxOf(cell(date))?.left ?? 0) + 40;
}

function pointer(type: string, target: EventTarget, x: number, y: number, id = 1): boolean {
  return fireEvent(
    target as Element,
    new PointerEvent(type, {
      pointerId: id,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function itemEl(date: string, text: string): HTMLElement {
  const el = Array.from(cell(date).querySelectorAll<HTMLElement>("[data-kind]")).find((e) =>
    e.textContent?.includes(text),
  );
  if (!el) throw new Error(`no item ${text} on ${date}`);
  return el;
}

/** Lifts an item (5px), moves it to (x, y) and drops it there. */
async function dragItem(el: HTMLElement, x: number, y: number): Promise<void> {
  const b = boxOf(el) as Box;
  const sx = b.left + 10;
  const sy = b.top + 9;
  pointer("pointerdown", el, sx, sy);
  pointer("pointermove", document, sx, sy + 5);
  pointer("pointermove", document, x, y);
  await act(async () => {
    pointer("pointerup", document, x, y);
  });
  await flush();
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wheel(target: Element, init: WheelEventInit): WheelEvent {
  const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  // happy-dom drops the modifier keys of a WheelEventInit.
  if (init.ctrlKey) Object.defineProperty(e, "ctrlKey", { value: true });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

const anchor = () => useUiStore.getState().calendarAnchor;

// ── grid ─────────────────────────────────────────────────────────────────────────────────────

describe("CalendarPage grid", () => {
  it("renders 3 weeks from the anchor with data-date / data-kind", () => {
    renderPage();
    const dates = visibleDates();
    expect(dates).toHaveLength(21);
    expect(dates[0]).toBe("2026-09-28");
    expect(dates[20]).toBe("2026-10-18");
    // One hidden, inert buffer week above and below (rows slide in instead of popping).
    const buffers = Array.from(document.querySelectorAll<HTMLElement>("[data-buffer]"));
    expect(buffers.map((r) => r.querySelector<HTMLElement>("[data-date]")?.dataset.date)).toEqual([
      "2026-09-21",
      "2026-10-19",
    ]);
    for (const r of buffers) {
      expect(r.getAttribute("aria-hidden")).toBe("true");
      expect(r.hasAttribute("inert")).toBe(true);
    }
    expect(kinds("2026-10-09")).toEqual(["event", "checkpoint", "reminder"]);
    expect(cell("2026-10-09").textContent).toContain("牙医复查");
    expect(cell("2026-10-09").textContent).toContain("orbit 域名备案 · 去查管局");
    expect(cell("2026-10-09").textContent).toContain("问会计：LLC 每年报什么税");
  });

  it("day heads: today, past, 10月1日, holiday / term / workday labels", () => {
    renderPage();
    expect(cell(TODAY).hasAttribute("data-today")).toBe(true);
    expect(cell("2026-09-28").hasAttribute("data-past")).toBe(true);
    expect(cell("2026-10-01").textContent).toContain("10月1日");
    expect(cell("2026-10-01").textContent).toContain("国庆节");
    expect(cell("2026-10-02").textContent).toContain("国庆 · 2");
    expect(cell("2026-10-08").textContent).toContain("寒露");
    expect(cell("2026-10-10").textContent).toContain("补班");
  });

  it("past items fade, an overdue due does not (ui-spec §2.5)", () => {
    renderPage();
    const meeting = cell("2026-09-28").querySelector<HTMLElement>('[data-kind="event"]');
    const due = cell("2026-09-28").querySelector<HTMLElement>('[data-kind="due"]');
    expect(meeting?.dataset.state).toBe("past");
    expect(due?.dataset.state).toBeUndefined();
  });

  it("event with an end time has a native tooltip", async () => {
    await mockApi.createEvent({
      date: "2026-10-12",
      time: "15:00",
      endTime: "17:00",
      title: "开会",
    });
    await useDataStore.getState().refresh();
    renderPage();
    const ev = cell("2026-10-12").querySelector<HTMLElement>('[data-kind="event"]');
    expect(ev?.getAttribute("title")).toBe("15:00–17:00");
  });
});

// ── double-click input ───────────────────────────────────────────────────────────────────────

describe("CalInput (ui-spec §2.6)", () => {
  it("preview updates on every keystroke, only when saving would change the text", () => {
    renderPage();
    const ta = openInput("2026-10-06");
    expect(preview()).toBe("↳ 打字，时间会自动识别");
    fireEvent.change(ta, { target: { value: "下午3点半和 A 喝咖啡" } });
    expect(preview()).toBe("↳ 15:30 和 A 喝咖啡");
    fireEvent.change(ta, { target: { value: "下午3点" } });
    expect(preview()).toBe("↳ 15:00 还差个标题");
    fireEvent.change(ta, { target: { value: "3点到5点开会" } });
    expect(preview()).toBe("↳ 15:00–17:00 开会");
    fireEvent.change(ta, { target: { value: "9:30 开会" } });
    expect(preview()).toBe("↳ 09:30 开会");
    // Already tidy: the line would repeat the text, so it is hidden.
    fireEvent.change(ta, { target: { value: "15:30 和 A 喝咖啡" } });
    expect(preview()).toBeNull();
    fireEvent.change(ta, { target: { value: "15:00-17:00 开会" } });
    expect(preview()).toBeNull();
    fireEvent.change(ta, { target: { value: "和 A 喝咖啡" } });
    expect(preview()).toBeNull();
  });

  it("Enter saves through api.createEvent with the parsed fields and highlights it", async () => {
    const create = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const ta = openInput("2026-10-06");
    fireEvent.change(ta, { target: { value: "下午3点半和 A 喝咖啡" } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", keyCode: 13 });
    });
    expect(create).toHaveBeenCalledWith({
      date: "2026-10-06",
      time: "15:30",
      endTime: null,
      title: "和 A 喝咖啡",
    });
    expect(within(cell("2026-10-06")).queryByRole("textbox")).toBeNull();
    const ev = cell("2026-10-06").querySelector<HTMLElement>('[data-kind="event"]');
    expect(ev?.textContent).toBe("和 A 喝咖啡15:30");
    const id = (await create.mock.results[0].value).id;
    expect(useUiStore.getState().highlight).toMatchObject({ id, reason: "new" });
  });

  it("an untimed title saves an event without time", async () => {
    const create = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const ta = openInput("2026-10-11");
    fireEvent.change(ta, { target: { value: "收拾行李" } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(create).toHaveBeenCalledWith({
      date: "2026-10-11",
      time: null,
      endTime: null,
      title: "收拾行李",
    });
  });

  it("Enter during IME composition never submits (isComposing / keyCode 229 / compositionstart)", () => {
    const create = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const ta = openInput("2026-10-06");
    fireEvent.change(ta, { target: { value: "he" } });
    fireEvent.keyDown(ta, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(ta, { key: "Enter", isComposing: true });
    fireEvent.compositionStart(ta);
    fireEvent.keyDown(ta, { key: "Enter", keyCode: 13 });
    expect(create).not.toHaveBeenCalled();
    expect(within(cell("2026-10-06")).getByRole("textbox")).toBeTruthy();
  });

  it("Shift+Enter is ignored; time without a title keeps the input open", () => {
    const create = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const ta = openInput("2026-10-06");
    fireEvent.change(ta, { target: { value: "开会" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    fireEvent.change(ta, { target: { value: "下午3点" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(create).not.toHaveBeenCalled();
    expect(within(cell("2026-10-06")).getByRole("textbox")).toBeTruthy();
  });

  it("Esc cancels without saving and the cell is unchanged", () => {
    const create = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const before = kinds("2026-10-06");
    const ta = openInput("2026-10-06");
    fireEvent.change(ta, { target: { value: "和 A 喝咖啡" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(within(cell("2026-10-06")).queryByRole("textbox")).toBeNull();
    expect(kinds("2026-10-06")).toEqual(before);
    expect(create).not.toHaveBeenCalled();
  });

  it("Esc while composing is left to the IME", () => {
    renderPage();
    const ta = openInput("2026-10-06");
    fireEvent.keyDown(ta, { key: "Escape", isComposing: true });
    expect(within(cell("2026-10-06")).getByRole("textbox")).toBeTruthy();
  });

  it("blur saves when there is text; only one input at a time", async () => {
    const create = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const ta = openInput("2026-10-06");
    fireEvent.change(ta, { target: { value: "看展" } });
    await act(async () => {
      fireEvent.blur(ta);
    });
    expect(create).toHaveBeenCalledTimes(1);
    openInput("2026-10-07");
    openInput("2026-10-11");
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("pasted newlines become spaces, 200 characters max", () => {
    expect(cleanInput("a\nb\r\nc")).toBe("a b c");
    expect(cleanInput("字".repeat(250))).toHaveLength(200);
    expect(inputPreview("  ")).toEqual({ kind: "empty" });
  });

  it("inputPreview: an edit shows a line only when it changes something", () => {
    const opened = "09:30 展会 · 国家会展中心 2 号馆";
    expect(inputPreview(opened, opened)).toBeNull();
    expect(inputPreview("09:30 展会 · 国家会展中心 3 号馆", opened)).toBeNull();
    expect(inputPreview("10点 展会 · 国家会展中心 2 号馆", opened)).toEqual({
      kind: "timed",
      time: "10:00",
      title: "展会 · 国家会展中心 2 号馆",
    });
    // The time was deleted: say the item will have none.
    expect(inputPreview("展会 · 国家会展中心 2 号馆", opened)).toEqual({
      kind: "untimed",
      title: "展会 · 国家会展中心 2 号馆",
    });
    // Clearing an edit (Enter deletes, with undo) and an untimed item reopened: nothing to say.
    expect(inputPreview("", opened)).toBeNull();
    expect(inputPreview("看牙", "看牙")).toBeNull();
    expect(inputPreview("看牙医", "看牙")).toBeNull();
  });
});

// ── editing existing items (ui-spec §2.8) ───────────────────────────────────────────────────

describe("item edits", () => {
  it("double-click event prefills 「HH:MM 标题」 and saves the new time", async () => {
    const update = vi.spyOn(mockApi, "updateEvent");
    renderPage();
    const ev = cell(TODAY).querySelector<HTMLElement>('[data-kind="event"]') as HTMLElement;
    fireEvent.doubleClick(ev);
    const ta = within(cell(TODAY)).getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("15:00 演唱会");
    expect(preview()).toBeNull();
    fireEvent.change(ta, { target: { value: "演唱会" } });
    expect(preview()).toBe("↳ 不带时间 · 演唱会");
    fireEvent.change(ta, { target: { value: "16:00 演唱会" } });
    expect(preview()).toBeNull();
    fireEvent.change(ta, { target: { value: "晚上8点 演唱会" } });
    expect(preview()).toBe("↳ 20:00 演唱会");
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      date: TODAY,
      time: "20:00",
      endTime: null,
      title: "演唱会",
    });
  });

  it("clearing an event and pressing Enter deletes it with an undo toast", async () => {
    const del = vi.spyOn(mockApi, "deleteEvent");
    renderPage();
    const ev = cell("2026-09-29").querySelector<HTMLElement>('[data-kind="event"]') as HTMLElement;
    fireEvent.doubleClick(ev);
    const ta = within(cell("2026-09-29")).getByRole("textbox");
    fireEvent.change(ta, { target: { value: "" } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(del).toHaveBeenCalledOnce();
    expect(useUiStore.getState().toast?.text).toBe("已删除「看房」");
  });

  it("reminder edit writes title + remind time back to the todo", async () => {
    const update = vi.spyOn(mockApi, "updateTodo");
    renderPage();
    const rm = cell(TODAY).querySelector<HTMLElement>('[data-kind="reminder"]') as HTMLElement;
    fireEvent.doubleClick(rm);
    const ta = within(cell(TODAY)).getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("18:00 回复房东关于续租的邮件");
    fireEvent.change(ta, { target: { value: "回复房东" } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(update).toHaveBeenCalledWith(expect.any(String), {
      title: "回复房东",
      remindDate: TODAY,
      remindTime: null,
    });
  });

  it("double-click start / checkpoint opens the task detail", () => {
    renderPage();
    fireEvent.doubleClick(cell("2026-10-08").querySelector('[data-kind="start"]') as HTMLElement);
    expect(useUiStore.getState().overlay).toMatchObject({ kind: "taskDetail" });
    useUiStore.getState().closeOverlay();
    const kp = cell("2026-10-01").querySelector<HTMLElement>('[data-kind="checkpoint"]');
    fireEvent.doubleClick(kp as HTMLElement);
    expect(useUiStore.getState().overlay).toMatchObject({
      kind: "taskDetail",
      focusKeyPointId: (kp?.dataset.key ?? "").slice("kp:".length),
    });
  });

  it("Delete on a selected event deletes it; on a reminder nothing happens", async () => {
    const del = vi.spyOn(mockApi, "deleteEvent");
    renderPage();
    fireEvent.click(cell(TODAY).querySelector('[data-kind="reminder"]') as HTMLElement);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(cell("2026-09-29").querySelector('[data-kind="event"]') as HTMLElement);
    expect(useUiStore.getState().selectedCalItemKey).toMatch(/^event:/);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Backspace" });
    });
    expect(del).toHaveBeenCalledOnce();
    expect(useUiStore.getState().toast?.text).toBe("已删除「看房」");
  });

  it("editText formats ranges", () => {
    const base: CalItem = {
      key: "event:x",
      kind: "event",
      date: TODAY,
      title: "开会",
      time: "15:00",
      endTime: "17:00",
      done: false,
      overdue: false,
      sourceId: "x",
      taskId: null,
    };
    expect(editText(base)).toBe("15:00-17:00 开会");
    expect(editText({ ...base, time: null, endTime: null })).toBe("开会");
  });
});

// ── in-cell reorder (ui-spec §2.7) ──────────────────────────────────────────────────────────

describe("day order", () => {
  const list = [{ key: "a" }, { key: "b" }, { key: "c" }];

  it("insertIndexAt counts the midpoints above the pointer", () => {
    expect(insertIndexAt([10, 30], 0)).toBe(0);
    expect(insertIndexAt([10, 30], 20)).toBe(1);
    expect(insertIndexAt([10, 30], 99)).toBe(2);
  });

  it("reorderItems moves the active key to the index among the others", () => {
    expect(reorderItems(list, "c", 0).map((i) => i.key)).toEqual(["c", "a", "b"]);
    expect(reorderItems(list, "a", 2).map((i) => i.key)).toEqual(["b", "c", "a"]);
    expect(reorderItems(list, "b", 9).map((i) => i.key)).toEqual(["a", "c", "b"]);
    expect(isSameOrder(list, "b", 1)).toBe(true);
    expect(isSameOrder(list, "b", 0)).toBe(false);
  });

  it("dragging 「问会计」 to the top hands all 10/9 keys to setDayOrder in the new order", async () => {
    const day = items("2026-10-09");
    expect(day.map((i) => i.kind)).toEqual(["event", "checkpoint", "reminder"]);
    const [ev, kp, todo] = day;
    expect(droppedDayKeys(day, todo.key, 0)).toEqual([todo.key, ev.key, kp.key]);

    const setDayOrder = vi.spyOn(mockApi, "setDayOrder");
    renderPage();
    await act(async () => {
      commitDayOrder("2026-10-09", day, todo.key, 0);
    });
    expect(setDayOrder).toHaveBeenCalledWith("2026-10-09", [todo.key, ev.key, kp.key]);
    expect(kinds("2026-10-09")).toEqual(["reminder", "event", "checkpoint"]);
    // Persisted: a fresh read keeps the order.
    expect(mockSnapshot().dayOrders.find((o) => o.date === "2026-10-09")?.itemKeys).toEqual([
      todo.key,
      ev.key,
      kp.key,
    ]);
  });

  it("withDayOrder replaces only that day's order", () => {
    const snap = useDataStore.getState().snap as Snapshot;
    const a = withDayOrder(snap, "2026-10-09", ["x"], 1);
    const b = withDayOrder(a, "2026-10-09", ["y", "x"], 2);
    expect(b.dayOrders.filter((o) => o.date === "2026-10-09")).toHaveLength(1);
    expect(b.dayOrders.find((o) => o.date === "2026-10-09")?.itemKeys).toEqual(["y", "x"]);
  });
});

// ── drag: 4px, same day, other days (ui-spec §2.7 revised) ──────────────────────────────────

describe("item drag", () => {
  beforeEach(() => fakeLayout());

  it("lifts after 4px of movement, no long press; Esc cancels", () => {
    renderPage();
    const el = itemEl(TODAY, "演唱会");
    const b = boxOf(el) as Box;
    pointer("pointerdown", el, b.left + 10, b.top + 9);
    pointer("pointermove", document, b.left + 10, b.top + 11);
    expect(useUiStore.getState().dragging).toBe(false);
    pointer("pointermove", document, b.left + 10, b.top + 14);
    expect(useUiStore.getState().dragging).toBe(true);
    expect(el.className).toMatch(/ghost/);
    expect(document.documentElement.dataset.calCursor).toBe("grabbing");
    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });
    expect(useUiStore.getState().dragging).toBe(false);
    expect(document.documentElement.dataset.calCursor).toBeUndefined();
    expect(document.querySelector("[data-placeholder]")).toBeNull();
  });

  it("leaving the page mid-drag releases the drag state (blur guard, cursor)", () => {
    const { unmount } = renderPage();
    const el = itemEl(TODAY, "演唱会");
    const b = boxOf(el) as Box;
    pointer("pointerdown", el, b.left + 10, b.top + 9);
    pointer("pointermove", document, b.left + 10, b.top + 20);
    expect(useUiStore.getState().dragging).toBe(true);
    unmount();
    expect(useUiStore.getState().dragging).toBe(false);
    expect(document.documentElement.dataset.calCursor).toBeUndefined();
  });

  it("same day: 「问会计」 dragged to the top hands the new order to setDayOrder", async () => {
    const setDayOrder = vi.spyOn(mockApi, "setDayOrder");
    renderPage();
    const [ev, kp, todo] = items("2026-10-09");
    await dragItem(itemEl("2026-10-09", "问会计"), colX("2026-10-09"), slotY("2026-10-09", 0));
    expect(setDayOrder).toHaveBeenCalledWith("2026-10-09", [todo.key, ev.key, kp.key]);
    expect(kinds("2026-10-09")).toEqual(["reminder", "event", "checkpoint"]);
  });

  it("placeholder shows in the day under the pointer, at the insertion index", () => {
    renderPage();
    const el = itemEl(TODAY, "演唱会");
    const b = boxOf(el) as Box;
    pointer("pointerdown", el, b.left + 10, b.top + 9);
    pointer("pointermove", document, b.left + 10, b.top + 15);
    // Back on its own spot: no placeholder.
    expect(document.querySelector("[data-placeholder]")).toBeNull();
    pointer("pointermove", document, colX("2026-10-02"), slotY("2026-10-02", 1));
    const ph = document.querySelector<HTMLElement>("[data-placeholder]");
    expect(ph?.closest<HTMLElement>("[data-date]")?.dataset.date).toBe("2026-10-02");
    expect(Array.from(ph?.parentElement?.children ?? []).indexOf(ph as HTMLElement)).toBe(1);
    expect(ph?.textContent).toBe("放到这里");
    // Over the 64px gap under the grid: nowhere to land.
    pointer("pointermove", document, colX("2026-10-02"), 3 * ROW_H + 30);
    expect(document.querySelector("[data-placeholder]")).toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });
  });

  it("another day: event moves (time / title kept) and the target day order, one undo", async () => {
    const updateEvent = vi.spyOn(mockApi, "updateEvent");
    const setDayOrder = vi.spyOn(mockApi, "setDayOrder");
    renderPage();
    const target = items("2026-10-02");
    const concert = items(TODAY).find((i) => i.title === "演唱会") as CalItem;
    await dragItem(itemEl(TODAY, "演唱会"), colX("2026-10-02"), slotY("2026-10-02", 1));
    expect(updateEvent).toHaveBeenCalledWith(concert.sourceId, {
      date: "2026-10-02",
      time: "15:00",
      endTime: null,
      title: "演唱会",
    });
    expect(setDayOrder).toHaveBeenCalledWith("2026-10-02", [
      target[0].key,
      concert.key,
      ...target.slice(1).map((i) => i.key),
    ]);
    expect(updateEvent.mock.invocationCallOrder[0]).toBeLessThan(
      setDayOrder.mock.invocationCallOrder[0],
    );
    expect(cell("2026-10-02").textContent).toContain("演唱会");
    expect(cell(TODAY).textContent).not.toContain("演唱会");
    const toast = useUiStore.getState().toast;
    expect(toast?.text).toBe("已移到 10月2日");
    expect(toast?.opIds).toHaveLength(2);

    await act(async () => {
      await useUiStore.getState().undoToast();
    });
    expect(cell(TODAY).textContent).toContain("演唱会");
    expect(mockSnapshot().dayOrders.find((o) => o.date === "2026-10-02")).toBeUndefined();
  });

  it("a refused drop goes back with a toast and writes nothing", async () => {
    const setTaskDates = vi.spyOn(mockApi, "setTaskDates");
    renderPage();
    // 课程作业: start 9/29, due 10/2 → its due cannot go to 9/28.
    const due = cell("2026-10-02").querySelector<HTMLElement>('[data-kind="due"]') as HTMLElement;
    const b = boxOf(due) as Box;
    pointer("pointerdown", due, b.left + 10, b.top + 9);
    pointer("pointermove", document, b.left + 10, b.top + 15);
    pointer("pointermove", document, colX("2026-09-28"), slotY("2026-09-28", 0));
    expect(document.querySelector("[data-placeholder]")).toBeNull();
    await act(async () => {
      pointer("pointerup", document, colX("2026-09-28"), slotY("2026-09-28", 0));
    });
    await flush();
    expect(setTaskDates).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.text).toBe("截止日不能早于开始日");
    expect(useUiStore.getState().toast?.opIds).toEqual([]);
    expect(useUiStore.getState().toast?.tone).toBe("notice");
    expect(kinds("2026-10-02")).toContain("due");
  });

  it("archived tasks' marks cannot be dragged", () => {
    useUiStore.setState({ calendarAnchor: "2026-09-21" });
    renderPage();
    const archivedStart = Array.from(
      cell("2026-09-24").querySelectorAll<HTMLElement>('[data-kind="start"]'),
    ).find((e) => e.textContent?.includes("准备护照")) as HTMLElement;
    expect(archivedStart.getAttribute("aria-disabled")).toBe("true");
    const b = boxOf(archivedStart) as Box;
    pointer("pointerdown", archivedStart, b.left + 10, b.top + 9);
    pointer("pointermove", document, b.left + 10, b.top + 40);
    expect(useUiStore.getState().dragging).toBe(false);
    pointer("pointerup", document, b.left + 10, b.top + 40);
  });

  it("holding an item at the bottom edge pages a week; it can land in the new week", async () => {
    renderPage();
    const el = itemEl(TODAY, "演唱会");
    const b = boxOf(el) as Box;
    pointer("pointerdown", el, b.left + 10, b.top + 9);
    pointer("pointermove", document, b.left + 10, b.top + 15);
    pointer("pointermove", document, colX("2026-10-16"), 3 * ROW_H - 10);
    await act(async () => {
      await sleep(PAGE_DELAY_MS + 120);
    });
    expect(anchor()).toBe("2026-10-05");
    // The row that slid in is under the pointer now.
    pointer("pointermove", document, colX("2026-10-23"), slotY("2026-10-23", 0));
    await act(async () => {
      pointer("pointerup", document, colX("2026-10-23"), slotY("2026-10-23", 0));
    });
    await flush();
    expect(mockSnapshot().events.find((e) => e.title === "演唱会")?.date).toBe("2026-10-23");
  });
});

describe("commitMove (every item kind)", () => {
  const find = (date: string, text: string) =>
    items(date).find((i) => i.title.includes(text)) as CalItem;
  const move = async (item: CalItem, date: string, index = 0) => {
    let ok = false;
    await act(async () => {
      ok = commitMove(item, date, items(date), index);
    });
    await flush();
    return ok;
  };

  it("reminder keeps its time; the toast undoes both writes", async () => {
    const updateTodo = vi.spyOn(mockApi, "updateTodo");
    const todo = find(TODAY, "回复房东");
    expect(await move(todo, "2026-10-05")).toBe(true);
    expect(updateTodo).toHaveBeenCalledWith(todo.sourceId, {
      title: "回复房东关于续租的邮件",
      remindDate: "2026-10-05",
      remindTime: "18:00",
    });
    expect(items("2026-10-05").map((i) => i.key)).toContain(todo.key);
    expect(useUiStore.getState().toast?.opIds).toHaveLength(2);
  });

  it("checkpoint / dated wait move their date and the date in their text", async () => {
    const updateKeyPoint = vi.spyOn(mockApi, "updateKeyPoint");
    const check = find("2026-10-02", "检查一遍初稿");
    await move(check, "2026-10-04", 5);
    expect(updateKeyPoint).toHaveBeenLastCalledWith(check.sourceId, {
      kind: "check",
      text: "10/4 检查一遍初稿",
      date: "2026-10-04",
      who: null,
    });
    const wait = find("2026-10-01", "审批");
    await move(wait, "2026-10-05");
    expect(updateKeyPoint).toHaveBeenLastCalledWith(wait.sourceId, {
      kind: "wait",
      text: "等审批 · 10/5 查",
      date: "2026-10-05",
      who: null,
    });
    expect(
      mockSnapshot()
        .dayOrders.find((o) => o.date === "2026-10-04")
        ?.itemKeys.at(-1),
    ).toBe(check.key);
  });

  it("task start moves only up to the due date", async () => {
    const setTaskDates = vi.spyOn(mockApi, "setTaskDates");
    const start = find(TODAY, "交会议 PPT"); // 9/30 → due 10/3
    expect(await move(start, "2026-10-04")).toBe(false);
    expect(setTaskDates).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.text).toBe("开始日不能晚于截止日");
    expect(await move(start, "2026-10-03")).toBe(true);
    expect(setTaskDates).toHaveBeenCalledWith(start.sourceId, "2026-10-03", "2026-10-03");
  });

  it("task due moves only down to the start date", async () => {
    const setTaskDates = vi.spyOn(mockApi, "setTaskDates");
    const due = find("2026-10-02", "课程作业"); // start 9/29
    expect(await move(due, "2026-09-28")).toBe(false);
    expect(setTaskDates).not.toHaveBeenCalled();
    expect(await move(due, "2026-10-09")).toBe(true);
    expect(setTaskDates).toHaveBeenCalledWith(due.sourceId, "2026-09-29", "2026-10-09");
  });

  it("insertedDayKeys puts the key at the index among the target's items", () => {
    const day = items("2026-10-09");
    expect(insertedDayKeys(day, "x", 1)).toEqual([day[0].key, "x", day[1].key, day[2].key]);
    expect(insertedDayKeys(day, "x", 99).at(-1)).toBe("x");
  });

  it("in English", async () => {
    setLang("en");
    await move(find(TODAY, "演唱会"), "2026-10-03");
    expect(useUiStore.getState().toast?.text).toBe("Moved to Oct 3");
    await move(find(TODAY, "交会议 PPT"), "2026-10-09");
    expect(useUiStore.getState().toast?.text).toBe("The start can't be after the due date");
  });
});

// ── week scrolling (wheel / trackpad / grab / keys) ─────────────────────────────────────────

describe("week scrolling", () => {
  beforeEach(() => fakeLayout());

  it("a wheel notch pages exactly one week (pixel 100 or line mode)", async () => {
    renderPage();
    const e = wheel(cell("2026-10-14"), { deltaY: 100 });
    expect(e.defaultPrevented).toBe(true);
    expect(anchor()).toBe("2026-10-05");
    wheel(cell("2026-10-14"), { deltaY: 100 });
    wheel(cell("2026-10-14"), { deltaY: 240 });
    expect(anchor()).toBe("2026-10-19");
    await act(async () => {
      await sleep(WHEEL_IDLE_MS + 30);
    });
    wheel(cell("2026-10-14"), { deltaY: -3, deltaMode: 1 });
    expect(anchor()).toBe("2026-10-12");
    expect(visibleDates()[0]).toBe("2026-10-12");
  });

  it("trackpad deltas follow the gesture and snap to the nearest week when idle", async () => {
    renderPage();
    const track = document.querySelector<HTMLElement>("[data-cal-row]")
      ?.parentElement as HTMLElement;
    for (let i = 0; i < 6; i++) wheel(cell("2026-10-14"), { deltaY: 10 });
    expect(anchor()).toBe("2026-09-28");
    expect(track.style.transform).toBe("translate3d(0, -260px, 0)");
    for (let i = 0; i < 10; i++) wheel(cell("2026-10-14"), { deltaY: 10 });
    // 160px > half a row: the next week is the first row now, 40px still to go.
    expect(anchor()).toBe("2026-10-05");
    expect(track.style.transform).toBe("translate3d(0, -160px, 0)");
    await act(async () => {
      await sleep(WHEEL_IDLE_MS + 40);
    });
    expect(anchor()).toBe("2026-10-05");
    expect(track.style.transform).toBe("translate3d(0, -200px, 0)");
  });

  it("a tiny wheel gesture (WebKit mouse notch) still pages one week", async () => {
    renderPage();
    wheel(cell("2026-10-14"), { deltaY: 4 });
    await act(async () => {
      await sleep(WHEEL_IDLE_MS + 40);
    });
    expect(anchor()).toBe("2026-10-05");
    wheel(cell("2026-10-14"), { deltaY: -4 });
    await act(async () => {
      await sleep(WHEEL_IDLE_MS + 40);
    });
    expect(anchor()).toBe("2026-09-28");
  });

  it("paging with the wheel saves an open input first (its row may slide out)", async () => {
    const createEvent = vi.spyOn(mockApi, "createEvent");
    renderPage();
    const ta = openInput("2026-10-06");
    ta.focus();
    fireEvent.change(ta, { target: { value: "看展" } });
    await act(async () => {
      wheel(cell("2026-10-14"), { deltaY: 100 });
    });
    await flush();
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-10-06", title: "看展" }),
    );
    expect(anchor()).toBe("2026-10-05");
  });

  it("horizontal and pinch scrolls are ignored", async () => {
    renderPage();
    const h = wheel(cell("2026-10-14"), { deltaX: 40, deltaY: 6 });
    const pinch = wheel(cell("2026-10-14"), { deltaY: 100, ctrlKey: true });
    await act(async () => {
      await sleep(WHEEL_IDLE_MS + 40);
    });
    expect(h.defaultPrevented).toBe(false);
    expect(pinch.defaultPrevented).toBe(false);
    expect(anchor()).toBe("2026-09-28");
  });

  it("a gesture over a day list that can scroll scrolls the list; at its edge it pages", async () => {
    renderPage();
    const scroller = cell(TODAY).querySelector("[data-day-items]")?.parentElement as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 170 });
    const over = cell(TODAY).querySelector("[data-kind]") as HTMLElement;
    const first = wheel(over, { deltaY: 100 });
    expect(first.defaultPrevented).toBe(false);
    expect(anchor()).toBe("2026-09-28");
    // The list reaches its end mid-gesture: still the list's gesture, never paging.
    scroller.scrollTop = 230;
    expect(wheel(over, { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(anchor()).toBe("2026-09-28");
    await act(async () => {
      await sleep(WHEEL_IDLE_MS + 40);
    });
    // A new gesture at the edge pages the weeks; upwards the list scrolls again.
    expect(wheel(over, { deltaY: 100 }).defaultPrevented).toBe(true);
    expect(anchor()).toBe("2026-10-05");
  });

  it("grab: rows follow a press on empty space, release snaps, its double-click is swallowed", async () => {
    renderPage();
    const grid = document.querySelector("[data-cal-grid]") as HTMLElement;
    const head = cell("2026-10-14").firstElementChild as HTMLElement;
    const x = colX("2026-10-14");
    const y = 2 * ROW_H + 10;
    pointer("pointerdown", head, x, y, 5);
    pointer("pointermove", grid, x, y - 2, 5);
    expect(document.documentElement.dataset.calCursor).toBeUndefined();
    for (let i = 1; i <= 15; i++) pointer("pointermove", grid, x, y - i * 10, 5);
    expect(document.documentElement.dataset.calCursor).toBe("grabbing");
    expect(anchor()).toBe("2026-10-05"); // 150px up: past half a row
    await act(async () => {
      await sleep(FLICK_WINDOW_MS + 20); // hold still: not a flick
    });
    pointer("pointerup", grid, x, y - 150, 5);
    expect(document.documentElement.dataset.calCursor).toBeUndefined();
    expect(anchor()).toBe("2026-10-05");
    fireEvent.doubleClick(cell("2026-10-14"));
    expect(document.querySelector("[data-cal-input]")).toBeNull();
    await act(async () => {
      await sleep(550);
    });
    fireEvent.doubleClick(cell("2026-10-14"));
    expect(document.querySelector("[data-cal-input]")).not.toBeNull();
  });

  it("grab: a fast flick carries one more week; sideways presses and items never grab", () => {
    renderPage();
    const grid = document.querySelector("[data-cal-grid]") as HTMLElement;
    const head = cell("2026-10-14").firstElementChild as HTMLElement;
    const x = colX("2026-10-14");
    pointer("pointerdown", head, x, 300, 6);
    for (let i = 1; i <= 4; i++) pointer("pointermove", grid, x, 300 + i * 10, 6);
    pointer("pointerup", grid, x, 340, 6);
    expect(anchor()).toBe("2026-09-21");

    pointer("pointerdown", head, x, 300, 7);
    pointer("pointermove", grid, x + 20, 303, 7);
    pointer("pointermove", grid, x + 20, 340, 7);
    pointer("pointerup", grid, x + 20, 340, 7);
    expect(anchor()).toBe("2026-09-21");
  });

  it("anchor changes slide; the store already holds the destination, so rapid keys add up", async () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if (el !== document.documentElement) return style;
      return {
        ...style,
        getPropertyValue: (n: string) => (n === "--duration-card" ? "200ms" : ""),
      } as CSSStyleDeclaration;
    });
    renderPage();
    const track = document.querySelector<HTMLElement>("[data-cal-row]")
      ?.parentElement as HTMLElement;
    await act(async () => {
      await sleep(350); // boot / hydrate changes do not slide
    });
    const key = (k: string) =>
      act(() => {
        fireEvent.keyDown(document.body, { key: k });
      });
    key("ArrowDown");
    // Starts where the old first row was (one row down), then slides home.
    expect(track.style.transform).toBe("translate3d(0, 0px, 0)");
    key("ArrowDown");
    key("ArrowDown");
    expect(anchor()).toBe("2026-10-19");
    await act(async () => {
      await sleep(80);
    });
    expect(anchor()).toBe("2026-10-19");
    const mid = track.style.transform;
    expect(mid).not.toBe("translate3d(0, -200px, 0)");
    await act(async () => {
      await sleep(400);
    });
    expect(track.style.transform).toBe("translate3d(0, -200px, 0)");
    expect(visibleDates()[0]).toBe("2026-10-19");
  });

  it("keys: ↑ / ← earlier, ↓ / → later, T home; not under an overlay", () => {
    renderPage();
    const key = (k: string) =>
      act(() => {
        fireEvent.keyDown(document.body, { key: k });
      });
    key("ArrowDown");
    expect(anchor()).toBe("2026-10-05");
    key("ArrowRight");
    expect(anchor()).toBe("2026-10-12");
    key("ArrowUp");
    key("ArrowUp");
    key("ArrowLeft");
    expect(anchor()).toBe("2026-09-21");
    key("t");
    expect(anchor()).toBe("2026-09-28");
    act(() => useUiStore.getState().openOverlay({ kind: "settings" }));
    key("ArrowDown");
    expect(anchor()).toBe("2026-09-28");
  });
});

// ── today pill (ui-spec §3) ─────────────────────────────────────────────────────────────────

describe("TodayPill", () => {
  it("renders the seed texts", () => {
    render(<TodayPill />);
    const pill = screen.getByTestId("today-pill");
    const text = pill.textContent ?? "";
    expect(text).toContain("4 件待办");
    expect(text).toContain("课程作业 还剩 2 天");
    expect(text).toContain("注册美卡 明天 去查");
    expect(text).toContain("收件箱 3 件没整理");
    expect(text).toContain("去任务页");
  });

  it("hides empty parts and shows the empty text when all are hidden", () => {
    const snap = useDataStore.getState().snap as Snapshot;
    useDataStore.setState({ snap: { ...snap, inbox: [] } });
    const { unmount } = render(<TodayPill />);
    expect(screen.getByTestId("today-pill").textContent).not.toContain("收件箱");
    expect(document.querySelectorAll("[data-part]")).toHaveLength(3);
    unmount();
    const empty: Snapshot = { ...snap, inbox: [], todos: [], tasks: [], keyPoints: [] };
    expect(todayPill(empty, TODAY).empty).toBe(true);
    useDataStore.setState({ snap: empty });
    render(<TodayPill />);
    expect(screen.getByTestId("today-pill").textContent).toBe("今天没有要紧的事去任务页 ");
  });

  it("click goes to the tasks page", () => {
    render(<TodayPill />);
    fireEvent.click(screen.getByTestId("today-pill"));
    expect(useUiStore.getState().page).toBe("tasks");
  });
});

// ── language (i18n: calendar / holidays sections) ───────────────────────────────────────────

/** Text of the pill parts for a view, one string per part. */
function partTexts(view: Parameters<typeof pillParts>[0]): string[] {
  const { container } = render(
    <div>
      {pillParts(view).map((p) => (
        <span key={p.key} data-test-part={p.key}>
          {p.node}
        </span>
      ))}
    </div>,
  );
  return Array.from(container.querySelectorAll("[data-test-part]")).map((e) => e.textContent ?? "");
}

const VIEW = { overdue: null, todos: 0, due: null, check: null, inbox: 0, empty: false };

describe("today pill parts (both languages)", () => {
  it("zh-Hans: due today, several checks, singular counts", () => {
    expect(
      partTexts({
        ...VIEW,
        todos: 1,
        due: { taskId: "a", title: "交报告", days: 0 },
        check: { taskId: "b", title: "注册美卡", more: 2 },
        inbox: 1,
      }),
    ).toEqual(["1 件待办", "交报告 今天截止", "注册美卡 等 3 项 明天 去查", "收件箱 1 件没整理"]);
  });

  it("en: plurals and word order", () => {
    setLang("en");
    expect(
      partTexts({
        ...VIEW,
        todos: 1,
        due: { taskId: "a", title: "Report", days: 1 },
        check: { taskId: "b", title: "Visa", more: 1 },
        inbox: 1,
      }),
    ).toEqual([
      "1 to-do",
      "Report due in 1 day",
      "Check Visa and 1 more tomorrow",
      "1 unsorted in Inbox",
    ]);
    expect(
      partTexts({ ...VIEW, todos: 2, due: { taskId: "a", title: "Report", days: 0 }, inbox: 5 }),
    ).toEqual(["2 to-dos", "Report due today", "5 unsorted in Inbox"]);
  });

  it("overdue steps come first, in red (ui-spec §9.3)", () => {
    expect(
      partTexts({ ...VIEW, overdue: { taskId: "a", title: "交会议 PPT", count: 1 }, todos: 2 }),
    ).toEqual(["交会议 PPT 有 1 步逾期", "2 件待办"]);
    expect(partTexts({ ...VIEW, overdue: { taskId: "a", title: "交会议 PPT", count: 3 } })).toEqual(
      ["交会议 PPT 等 3 步逾期"],
    );
    setLang("en");
    expect(partTexts({ ...VIEW, overdue: { taskId: "a", title: "Slides", count: 1 } })).toEqual([
      "1 step overdue in Slides",
    ]);
    expect(partTexts({ ...VIEW, overdue: { taskId: "a", title: "Slides", count: 2 } })).toEqual([
      "2 steps overdue, first in Slides",
    ]);
  });

  it("titles are text, never markup", () => {
    const [due] = partTexts({
      ...VIEW,
      due: { taskId: "a", title: "<b>x</b> & <task/>", days: 3 },
    });
    expect(due).toBe("<b>x</b> & <task/> 还剩 3 天");
  });

  it("the number is bold", () => {
    render(<TodayPill />);
    const todos = document.querySelector('[data-part="todos"] b');
    expect(todos?.textContent).toBe("4");
  });
});

describe("calendar page in English", () => {
  beforeEach(() => setLang("en"));

  it("weekday row, day heads, holiday / term / workday labels", () => {
    render(<WeekdayRow />);
    renderPage();
    const heads = Array.from(document.querySelectorAll("[aria-hidden='true'] > div")).map(
      (e) => e.textContent,
    );
    expect(heads.slice(0, 7)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(screen.getByRole("region", { name: "Calendar" })).toBeTruthy();
    expect(cell(TODAY).querySelector("[title]")?.getAttribute("title")).toBe("Today");
    expect(cell("2026-10-01").textContent).toContain("Oct 1");
    expect(cell("2026-10-01").textContent).toContain("National Day");
    expect(cell("2026-10-02").textContent).toContain("National Day · 2");
    expect(cell("2026-10-08").textContent).toContain("Cold Dew");
    expect(cell("2026-10-10").textContent).toContain("Workday");
  });

  it("double-click input: accessible names and preview states", () => {
    renderPage();
    const ta = openInput("2026-10-06");
    expect(ta.getAttribute("aria-label")).toBe("New event on Oct 6");
    expect(preview()).toBe("↳ Type — times are detected automatically");
    fireEvent.change(ta, { target: { value: "下午3点" } });
    expect(preview()).toBe("↳ 15:00 Needs a title");
    fireEvent.keyDown(ta, { key: "Escape" });
    const ev = cell(TODAY).querySelector<HTMLElement>('[data-kind="event"]') as HTMLElement;
    fireEvent.doubleClick(ev);
    const edit = within(cell(TODAY)).getByRole("textbox");
    expect(edit.getAttribute("aria-label")).toBe("Edit “演唱会”");
    fireEvent.change(edit, { target: { value: "演唱会" } });
    expect(preview()).toBe("↳ No time · 演唱会");
  });

  it("deleting an event toasts in English", async () => {
    renderPage();
    fireEvent.click(cell("2026-09-29").querySelector('[data-kind="event"]') as HTMLElement);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Delete" });
    });
    expect(useUiStore.getState().toast?.text).toBe("Deleted “看房”");
  });

  it("today pill", () => {
    render(<TodayPill />);
    const text = screen.getByTestId("today-pill").textContent ?? "";
    expect(text).toContain("4 to-dos");
    expect(text).toContain("课程作业 due in 2 days");
    expect(text).toContain("Check 注册美卡 tomorrow");
    expect(text).toContain("3 unsorted in Inbox");
    expect(text).toContain("Go to Tasks");
    const snap = useDataStore.getState().snap as Snapshot;
    act(() => {
      useDataStore.setState({ snap: { ...snap, inbox: [], todos: [], tasks: [], keyPoints: [] } });
    });
    expect(screen.getByTestId("today-pill").textContent).toBe("Nothing pressing todayGo to Tasks ");
  });
});
