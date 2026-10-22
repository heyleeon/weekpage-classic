import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@/types/domain";
import { ApiError } from "./api";
import { parseLocal, setClockOffset } from "./clock";
import {
  keyBetween,
  mockApi,
  mockEmit,
  mockSnapshot,
  mockUndo,
  mockWrite,
  resetMockBackend,
} from "./mockBackend";

beforeEach(() => resetMockBackend());

describe("mockBackend · reads", () => {
  it("serves the demo fixture as independent copies", async () => {
    const a = await mockApi.loadSnapshot();
    expect(a.events).toHaveLength(11);
    expect(a.inbox).toHaveLength(3);
    expect(a.tasks.filter((t) => t.archivedAt === null)).toHaveLength(9);
    a.events.pop();
    const b = await mockApi.loadSnapshot();
    expect(b.events).toHaveLength(11);
  });

  it("app info looks like a dev build with vibrancy", async () => {
    const info = await mockApi.appInfo();
    expect(info.isDev).toBe(true);
    expect(info.vibrancy).toBe(true);
    expect(info.shortcut.registered).toBe(false);
  });

  it("cache only accepts the cache: prefix", async () => {
    await mockApi.setCache("cache:holidays", "{}");
    expect(await mockApi.getCache("cache:holidays")).toBe("{}");
    expect(await mockApi.getCache("cache:none")).toBeNull();
    await expect(mockApi.setCache("app", "x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("mockBackend · settings", () => {
  it("merges only present fields and returns the new settings", async () => {
    const res = await mockApi.updateSettings({ lastPage: "tasks" });
    expect(res.settings.lastPage).toBe("tasks");
    const res2 = await mockApi.updateSettings({ calendarWeeks: 4, theme: null });
    expect(res2.settings.lastPage).toBe("tasks");
    expect(res2.settings.calendarWeeks).toBe(4);
    expect(res2.settings.theme).toBe("system");
    expect((await mockApi.loadSnapshot()).settings.calendarWeeks).toBe(4);
  });

  it("defaults the new settings and patches them", async () => {
    const before = (await mockApi.loadSnapshot()).settings;
    expect(before.language).toBe("system");
    expect(before.calendarFirstRow).toBe("thisWeek");
    const res = await mockApi.updateSettings({ language: "en", calendarFirstRow: "lastWeek" });
    expect(res.settings.language).toBe("en");
    expect(res.settings.calendarFirstRow).toBe("lastWeek");
    expect(res.settings.calendarWeeks).toBe(before.calendarWeeks);
  });

  it("rejects values Rust would reject", async () => {
    await expect(mockApi.updateSettings({ calendarWeeks: 5 })).rejects.toBeInstanceOf(ApiError);
    await expect(
      mockApi.updateSettings({ language: "fr" as unknown as "en" }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(mockApi.updateSettings({ shortcut: " " })).rejects.toBeInstanceOf(ApiError);
    expect((await mockApi.loadSnapshot()).settings.language).toBe("system");
  });

  it("a snapshot without the new fields gets their defaults", async () => {
    const old = mockSnapshot();
    const { language: _l, calendarFirstRow: _c, ...rest } = old.settings;
    resetMockBackend({ ...old, settings: rest as Snapshot["settings"] });
    const s = (await mockApi.loadSnapshot()).settings;
    expect(s.language).toBe("system");
    expect(s.calendarFirstRow).toBe("thisWeek");
  });
});

describe("mockBackend · write + undo framework", () => {
  const rename = (title: string) =>
    mockWrite((draft) => {
      draft.inbox[0].text = title;
      return draft.inbox[0].id;
    });

  it("mockWrite applies the change and returns a mutation", () => {
    const m = rename("first");
    expect(m.opId).toMatch(/[0-9a-f-]{36}/);
    expect(m.id).toBe(mockSnapshot().inbox[0].id);
    expect(mockSnapshot().inbox[0].text).toBe("first");
  });

  it("undo of the last op restores the state before it", () => {
    const original = mockSnapshot().inbox[0].text;
    const m1 = rename("one");
    const m2 = rename("two");
    mockUndo([m2.opId]);
    expect(mockSnapshot().inbox[0].text).toBe("one");
    mockUndo([m1.opId]);
    expect(mockSnapshot().inbox[0].text).toBe(original);
  });

  it("undo of several ops goes back before the earliest", async () => {
    const original = mockSnapshot().inbox[0].text;
    const m1 = rename("one");
    const m2 = rename("two");
    await mockApi.undo([m1.opId, m2.opId]);
    expect(mockSnapshot().inbox[0].text).toBe(original);
  });

  it("unknown or already undone ops are a conflict", () => {
    const m = rename("one");
    mockUndo([m.opId]);
    expect(() => mockUndo([m.opId])).toThrowError(ApiError);
    try {
      mockUndo(["nope"]);
    } catch (e) {
      expect((e as ApiError).code).toBe("conflict");
    }
  });

  it("a throwing write leaves data untouched", () => {
    const before = mockSnapshot();
    expect(() =>
      mockWrite((draft) => {
        draft.inbox = [];
        throw new ApiError("invalid", "boom");
      }),
    ).toThrow();
    expect(mockSnapshot()).toEqual(before);
  });
});

describe("mockBackend · stubs and events", () => {
  it("writes outside the preview list still say so", async () => {
    const calls: [string, () => Promise<unknown>][] = [
      ["updateInboxItem", () => mockApi.updateInboxItem("id", "x")],
      ["renameTask", () => mockApi.renameTask("id", "x")],
      ["setTaskRemind", () => mockApi.setTaskRemind("id", true)],
      ["deleteTask", () => mockApi.deleteTask("id")],
    ];
    for (const [name, call] of calls) {
      await expect(call()).rejects.toMatchObject({
        code: "not_implemented",
        message: `not implemented in preview: ${name}`,
      });
    }
  });

  it("mockEmit reaches subscribers until unlisten", async () => {
    const seen: string[] = [];
    const off = await mockApi.onDayChanged((p) => seen.push(p.today));
    mockEmit("clock://day-changed", { today: "2026-10-01" });
    off();
    mockEmit("clock://day-changed", { today: "2026-10-02" });
    expect(seen).toEqual(["2026-10-01"]);
  });
});

// ── the 19 preview writes ──────────────────────────────────────────────────────────────────

const TODAY = "2026-09-30";

beforeEach(() => setClockOffset((parseLocal("2026-09-30T10:00") ?? 0) - Date.now()));
afterEach(() => setClockOffset(0));

const snap = () => mockApi.loadSnapshot();
const openTodos = (s: Snapshot) => s.todos.filter((t) => t.doneDate === null).map((t) => t.id);
const column = (s: Snapshot, c: number) =>
  s.tasks.filter((t) => t.archivedAt === null && t.boardColumn === c).map((t) => t.id);
const timeline = (s: Snapshot, taskId: string) =>
  s.keyPoints.filter((k) => k.taskId === taskId).map((k) => k.id);
const taskId = (s: Snapshot, title: string) => {
  const t = s.tasks.find((x) => x.title === title);
  if (!t) throw new Error(title);
  return t.id;
};
const sorted = (keys: string[]) => keys.every((k, i) => i === 0 || keys[i - 1] < k);

describe("mockBackend · sort keys", () => {
  it("keyBetween is strictly between and rejects bad order", () => {
    for (const [a, b] of [
      [null, null],
      ["V", null],
      [null, "V"],
      ["1", "2"],
      ["z", "zz"],
      ["y", "z"],
    ] as const) {
      const k = keyBetween(a, b);
      expect(a === null || a < k).toBe(true);
      expect(b === null || k < b).toBe(true);
    }
    expect(() => keyBetween("b", "a")).toThrowError(ApiError);
  });
});

describe("mockBackend · events and day orders", () => {
  it("createEvent / updateEvent / deleteEvent, each undoable", async () => {
    const m = await mockApi.createEvent({ date: "2026-10-05", time: "15:00", title: " 看展 " });
    let s = await snap();
    expect(s.events).toHaveLength(12);
    const e = s.events.find((x) => x.id === m.id);
    expect(e).toMatchObject({ title: "看展", time: "15:00", endTime: null, date: "2026-10-05" });
    expect(s.events.map((x) => x.date)).toEqual([...s.events.map((x) => x.date)].sort());

    const u = await mockApi.updateEvent(m.id ?? "", { date: "2026-10-06", title: "改期" });
    s = await snap();
    expect(s.events.find((x) => x.id === m.id)).toMatchObject({ date: "2026-10-06", time: null });

    const d = await mockApi.deleteEvent(m.id ?? "");
    expect((await snap()).events).toHaveLength(11);
    await mockApi.undo([d.opId]);
    expect((await snap()).events.find((x) => x.id === m.id)?.title).toBe("改期");
    await mockApi.undo([u.opId]);
    expect((await snap()).events.find((x) => x.id === m.id)?.title).toBe("看展");
    await mockApi.undo([m.opId]);
    expect((await snap()).events).toHaveLength(11);
  });

  it("event writes reject a blank title or a missing row", async () => {
    await expect(mockApi.createEvent({ date: TODAY, title: "  " })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(mockApi.deleteEvent("ghost")).rejects.toMatchObject({ code: "not_found" });
  });

  it("setDayOrder upserts one row per day and undoes", async () => {
    const a = await mockApi.setDayOrder("2026-10-09", ["todo:a", "event:b", "todo:a"]);
    const b = await mockApi.setDayOrder("2026-10-09", ["event:b"]);
    expect(b.id).toBe(a.id);
    let s = await snap();
    expect(s.dayOrders).toHaveLength(1);
    expect(s.dayOrders[0].itemKeys).toEqual(["event:b"]);
    await mockApi.undo([b.opId]);
    s = await snap();
    expect(s.dayOrders[0].itemKeys).toEqual(["todo:a", "event:b"]);
  });
});

describe("mockBackend · todos", () => {
  it("createTodo appends to the open list with created date today", async () => {
    const before = await snap();
    const m = await mockApi.createTodo({ title: "买牛奶", remindDate: "2026-10-05" });
    const s = await snap();
    expect(openTodos(s)).toEqual([...openTodos(before), m.id]);
    expect(s.todos.find((t) => t.id === m.id)).toMatchObject({
      createdDate: TODAY,
      remindDate: "2026-10-05",
      remindTime: null,
    });
    expect(sorted(s.todos.map((t) => t.sortKey))).toBe(true);
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });

  it("createTodo from the inbox removes the item; undo puts it back", async () => {
    const before = await snap();
    const item = before.inbox[0].id;
    const m = await mockApi.createTodo({ title: "看 Stripe Atlas" }, item);
    expect((await snap()).inbox.map((i) => i.id)).not.toContain(item);
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
    await expect(mockApi.createTodo({ title: "x" }, "ghost")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(mockApi.createTodo({ title: " " })).rejects.toMatchObject({ code: "invalid" });
  });

  it("updateTodo changes title and reminder", async () => {
    const id = openTodos(await snap())[3];
    const m = await mockApi.updateTodo(id, {
      title: "研究快捷键",
      remindDate: "2026-10-02",
      remindTime: "09:00",
    });
    expect((await snap()).todos.find((t) => t.id === id)).toMatchObject({
      title: "研究快捷键",
      remindDate: "2026-10-02",
      remindTime: "09:00",
    });
    await mockApi.undo([m.opId]);
    expect((await snap()).todos.find((t) => t.id === id)?.title).toBe("研究 Tauri 全局快捷键");
  });

  it("setTodoDone checks today and unchecking returns to the old place", async () => {
    const before = await snap();
    const open = openTodos(before);
    const done = await mockApi.setTodoDone(open[1], true);
    let s = await snap();
    expect(s.todos.find((t) => t.id === open[1])).toMatchObject({ doneDate: TODAY });
    expect(openTodos(s)).not.toContain(open[1]);
    await mockApi.setTodoDone(open[1], false);
    s = await snap();
    expect(openTodos(s)).toEqual(open);
    await mockApi.undo([done.opId]);
    expect(await snap()).toEqual(before);
  });

  it("unchecking a todo whose reminder day is over drops the reminder", async () => {
    const m = await mockApi.createTodo({ title: "old", remindDate: "2026-09-29" });
    const id = m.id ?? "";
    await mockApi.setTodoDone(id, true);
    await mockApi.setTodoDone(id, false);
    expect((await snap()).todos.find((t) => t.id === id)?.remindDate).toBeNull();
  });

  it("restoreTodo puts an archived todo at the end of the open list", async () => {
    const before = await snap();
    const archived = before.todos.find((t) => t.doneDate !== null && t.doneDate < TODAY);
    if (!archived) throw new Error("fixture has archived todos");
    const m = await mockApi.restoreTodo(archived.id);
    const s = await snap();
    expect(openTodos(s)).toEqual([...openTodos(before), archived.id]);
    expect(s.todos.find((t) => t.id === archived.id)).toMatchObject({
      doneAt: null,
      doneDate: null,
    });
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });

  it("moveTodo places between neighbours and rejects reversed ones", async () => {
    const open = openTodos(await snap());
    const m = await mockApi.moveTodo(open[3], open[0], open[1]);
    expect(openTodos(await snap())).toEqual([open[0], open[3], open[1], open[2]]);
    await mockApi.undo([m.opId]);
    expect(openTodos(await snap())).toEqual(open);
    await expect(mockApi.moveTodo(open[0], open[3], open[1])).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("deleteTodo removes; undo brings it back in place", async () => {
    const before = await snap();
    const id = openTodos(before)[0];
    const m = await mockApi.deleteTodo(id);
    expect((await snap()).todos.map((t) => t.id)).not.toContain(id);
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });
});

describe("mockBackend · inbox", () => {
  it("createInboxItem: inbox 3 → 4 on top, undo back to 3", async () => {
    expect((await snap()).inbox).toHaveLength(3);
    const m = await mockApi.createInboxItem(" 申请海外学校（UCL / 港大） ");
    const s = await snap();
    expect(s.inbox).toHaveLength(4);
    expect(s.inbox[0]).toMatchObject({ id: m.id, text: "申请海外学校（UCL / 港大）" });
    await mockApi.undo([m.opId]);
    expect((await snap()).inbox).toHaveLength(3);
    await expect(mockApi.createInboxItem("  ")).rejects.toMatchObject({ code: "invalid" });
  });

  it("deleteInboxItem and a merged triage undo (todo + task + delete)", async () => {
    const before = await snap();
    const [a, b, c] = before.inbox.map((i) => i.id);
    const m1 = await mockApi.createTodo({ title: "a", remindDate: "2026-10-05" }, a);
    const m2 = await mockApi.createTask({
      title: "b",
      startDate: TODAY,
      remindDayBefore: false,
      column: 0,
      keyPoints: [],
      fromInboxId: b,
    });
    const m3 = await mockApi.deleteInboxItem(c);
    expect((await snap()).inbox).toHaveLength(0);
    await mockApi.undo([m1.opId, m2.opId, m3.opId]);
    expect(await snap()).toEqual(before);
  });
});

describe("mockBackend · tasks and key points", () => {
  it("createTask goes on top of its column with key points in order", async () => {
    const before = await snap();
    const m = await mockApi.createTask({
      title: "申请海外学校",
      startDate: TODAY,
      dueDate: "2026-12-01",
      remindDayBefore: true,
      column: 2,
      keyPoints: [
        { kind: "do", text: "准备文书" },
        { kind: "note", text: "对方说好" },
      ],
      fromInboxId: before.inbox[0].id,
    });
    const s = await snap();
    const id = m.id ?? "";
    expect(column(s, 2)).toEqual([id, ...column(before, 2)]);
    expect(s.tasks.find((t) => t.id === id)).toMatchObject({ status: "active", boardColumn: 2 });
    const kps = s.keyPoints.filter((k) => k.taskId === id);
    expect(kps.map((k) => k.text)).toEqual(["准备文书", "对方说好"]);
    expect(kps[1]).toMatchObject({ who: "them", date: TODAY });
    expect(s.inbox).toHaveLength(2);
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
    await expect(
      mockApi.createTask({
        title: "x",
        startDate: TODAY,
        dueDate: "2026-09-01",
        remindDayBefore: false,
        column: 0,
        keyPoints: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("addKeyPoint appends; a note goes before the first open key point", async () => {
    const before = await snap();
    const card = taskId(before, "注册美卡");
    const tl = timeline(before, card);
    const k = await mockApi.addKeyPoint(card, { kind: "do", text: "绑定 Apple Pay" });
    const n = await mockApi.addKeyPoint(card, { kind: "note", text: "对方：补交地址证明" });
    const s = await snap();
    expect(timeline(s, card)).toEqual([...tl.slice(0, 4), n.id, tl[4], tl[5], k.id]);
    await mockApi.undo([k.opId]);
    expect(await snap()).toEqual(before);
    await expect(mockApi.addKeyPoint("ghost", { kind: "do", text: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("dated key points keep date order on add / redate; only undated ones move (§10.14)", async () => {
    const before = await snap();
    const ppt = taskId(before, "交会议 PPT");
    // 列提纲, 做 10 页初稿, 10/2 检查一遍初稿, 找同事过一遍
    const [outline, draft, check, review] = timeline(before, ppt);
    const fix =
      (await mockApi.addKeyPoint(ppt, { kind: "do", text: "改稿", date: "2026-10-01" })).id ?? "";
    expect(timeline(await snap(), ppt)).toEqual([outline, draft, fix, check, review]);
    await mockApi.updateKeyPoint(fix, { kind: "do", text: "改稿", date: "2026-10-05" });
    // No later dated one → just after the last dated one (10/2), ahead of the undated 找同事.
    expect(timeline(await snap(), ppt)).toEqual([outline, draft, check, fix, review]);
    await mockApi.moveKeyPoint(review, outline, draft);
    expect(timeline(await snap(), ppt)).toEqual([outline, review, draft, check, fix]);
    await expect(mockApi.moveKeyPoint(check, null, outline)).rejects.toMatchObject({
      code: "invalid",
    });
    const del = await mockApi.deleteKeyPoint(review);
    expect(timeline(await snap(), ppt)).toEqual([outline, draft, check, fix]);
    await mockApi.undo([del.opId]);
    expect(timeline(await snap(), ppt)).toEqual([outline, review, draft, check, fix]);
  });

  it("setKeyPointDone clears current but keeps currentSince", async () => {
    const before = await snap();
    const wait = before.keyPoints.find((k) => k.text === "等审批 · 10/1 查");
    if (!wait) throw new Error("seed");
    const m = await mockApi.setKeyPointDone(wait.id, true);
    expect((await snap()).keyPoints.find((k) => k.id === wait.id)).toMatchObject({
      doneDate: TODAY,
      isCurrent: false,
      currentSince: "2026-09-24",
    });
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
    const note = before.keyPoints.find((k) => k.kind === "note");
    await expect(mockApi.setKeyPointDone(note?.id ?? "", true)).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("setTaskStatus writes and clears done fields", async () => {
    const before = await snap();
    const id = taskId(before, "注册美卡");
    const m = await mockApi.setTaskStatus(id, "done");
    expect((await snap()).tasks.find((t) => t.id === id)).toMatchObject({
      status: "done",
      doneDate: TODAY,
    });
    await mockApi.setTaskStatus(id, "active");
    expect((await snap()).tasks.find((t) => t.id === id)).toMatchObject({
      status: "active",
      doneDate: null,
      doneAt: null,
    });
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });

  it("moveTask within and across columns keeps columns ordered", async () => {
    const before = await snap();
    const [c0, c2] = [column(before, 0), column(before, 2)];
    const m = await mockApi.moveTask(c0[2], 0, null, c0[0]);
    expect(column(await snap(), 0)).toEqual([c0[2], c0[0], c0[1]]);
    await mockApi.moveTask(c0[0], 2, c2[0], c2[1]);
    const s = await snap();
    expect(column(s, 2)).toEqual([c2[0], c0[0], c2[1], c2[2]]);
    for (const c of [0, 1, 2]) {
      const keys = s.tasks
        .filter((t) => t.archivedAt === null && t.boardColumn === c)
        .map((t) => t.sortKey);
      expect(sorted(keys)).toBe(true);
    }
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
    await expect(mockApi.moveTask(c0[0], 0, column(before, 1)[0])).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("archiveTask leaves the board; undo brings the card back", async () => {
    const before = await snap();
    const id = taskId(before, "注册美卡");
    const m = await mockApi.archiveTask(id, "  批了 ");
    const s = await snap();
    expect(s.tasks.find((t) => t.id === id)).toMatchObject({
      archivedDate: TODAY,
      summary: "批了",
    });
    expect(column(s, 0)).not.toContain(id);
    await expect(mockApi.archiveTask(id)).rejects.toMatchObject({ code: "invalid" });
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });

  it("restoreTask goes on top of the given column keeping its status", async () => {
    const before = await snap();
    const archived = before.tasks.find((t) => t.archivedAt !== null);
    if (!archived) throw new Error("fixture has archived tasks");
    const m = await mockApi.restoreTask(archived.id, 1);
    const s = await snap();
    expect(column(s, 1)[0]).toBe(archived.id);
    expect(s.tasks.find((t) => t.id === archived.id)).toMatchObject({
      archivedAt: null,
      archivedDate: null,
      status: archived.status,
    });
    await expect(mockApi.restoreTask(archived.id, 1)).rejects.toMatchObject({ code: "invalid" });
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });
});

describe("mockBackend · calendar drag writes (setTaskDates / updateKeyPoint)", () => {
  it("setTaskDates moves start / due, rejects due < start, undoable", async () => {
    const before = await snap();
    const id = taskId(before, "交会议 PPT");
    const m = await mockApi.setTaskDates(id, "2026-10-01", "2026-10-05");
    expect((await snap()).tasks.find((t) => t.id === id)).toMatchObject({
      startDate: "2026-10-01",
      dueDate: "2026-10-05",
    });
    await expect(mockApi.setTaskDates(id, "2026-10-06", "2026-10-05")).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(mockApi.setTaskDates("nope", "2026-10-01")).rejects.toMatchObject({
      code: "not_found",
    });
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });

  it("updateKeyPoint replaces text and date, keeps done / current, undoable", async () => {
    const before = await snap();
    const kp = before.keyPoints.find((k) => k.text === "10/2 检查一遍初稿");
    if (!kp) throw new Error("fixture has the 10/2 checkpoint");
    const m = await mockApi.updateKeyPoint(kp.id, {
      kind: kp.kind,
      text: "10/4 检查一遍初稿",
      date: "2026-10-04",
      who: kp.who,
    });
    expect((await snap()).keyPoints.find((k) => k.id === kp.id)).toMatchObject({
      text: "10/4 检查一遍初稿",
      date: "2026-10-04",
      doneDate: kp.doneDate,
      isCurrent: kp.isCurrent,
    });
    await expect(mockApi.updateKeyPoint(kp.id, { kind: "check", text: " " })).rejects.toMatchObject(
      { code: "invalid" },
    );
    await mockApi.undo([m.opId]);
    expect(await snap()).toEqual(before);
  });
});
