import { describe, expect, it } from "vitest";
import type { CalItem, CalKind, Snapshot } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import {
  applyCalMove,
  dayItemKeys,
  deriveCalendar,
  lockedCalKeys,
  planCalMove,
  retargetDateText,
} from "./calendar";
import { visibleRange } from "./dates";

const demo = fixture as Snapshot;
const TODAY = "2026-09-30";

/** [kind, title, time, done, overdue] — what a day cell shows, top to bottom. */
type Row = [CalKind, string, string | null, boolean, boolean];
const ev = (title: string, time: string | null = null): Row => ["event", title, time, false, false];
const rm = (title: string, time: string | null = null): Row => [
  "reminder",
  title,
  time,
  false,
  false,
];
const cp = (title: string): Row => ["checkpoint", title, null, false, false];
const st = (title: string): Row => ["start", title, null, false, false];
const du = (title: string, overdue = false): Row => ["due", title, null, false, overdue];

// 3 weeks 9/28–10/18, default order (ui-spec §2.7).
const EXPECTED: Record<string, Row[]> = {
  "2026-09-28": [ev("周会", "10:00"), du("交报销单", true)],
  "2026-09-29": [ev("看房", "14:00"), st("课程作业"), st("注册美国公司")],
  "2026-09-30": [
    ev("演唱会", "15:00"),
    ev("和朋友约饭", "19:30"),
    rm("回复房东关于续租的邮件", "18:00"),
    st("交会议 PPT"),
    st("写 Q3 季度总结"),
  ],
  "2026-10-01": [ev("和供应商吃饭，聊下季度订单", "15:00"), cp("注册美卡 · 去查审批")],
  "2026-10-02": [
    ev("收拾去上海的行李"),
    ev("飞上海 CA1519", "18:00"),
    cp("交会议 PPT · 检查一遍初稿"),
    du("课程作业"),
  ],
  "2026-10-03": [ev("展会 · 国家会展中心 2 号馆", "09:30"), du("交会议 PPT")],
  "2026-10-04": [],
  "2026-10-05": [],
  "2026-10-06": [du("写 Q3 季度总结")],
  "2026-10-07": [],
  "2026-10-08": [st("landing 文案")],
  "2026-10-09": [
    ev("牙医复查", "10:30"),
    cp("orbit 域名备案 · 去查管局"),
    rm("问会计：LLC 每年报什么税"),
  ],
  "2026-10-10": [],
  "2026-10-11": [],
  "2026-10-12": [],
  "2026-10-13": [],
  "2026-10-14": [ev("orbit 内测群分享", "20:00")],
  "2026-10-15": [],
  "2026-10-16": [ev("和律师电话会，过 LLC 条款", "14:00"), du("landing 文案")],
  "2026-10-17": [],
  "2026-10-18": [],
};

const rows = (items: CalItem[] | undefined): Row[] =>
  (items ?? []).map((i) => [i.kind, i.title, i.time, i.done, i.overdue]);

function snapWith(patch: Partial<Snapshot>): Snapshot {
  return { ...structuredClone(demo), ...patch };
}

describe("deriveCalendar · default order (9/28–10/18)", () => {
  const { from, to, days } = visibleRange("2026-09-28", 3);
  const cal = deriveCalendar(demo, from, to, TODAY);

  it("covers exactly the 21 visible days", () => {
    expect(days).toHaveLength(21);
    expect([...cal.keys()]).toEqual(days);
  });

  it.each(Object.entries(EXPECTED))("%s", (date, expected) => {
    expect(rows(cal.get(date))).toEqual(expected);
  });

  it("keys, sources and task ids", () => {
    const d930 = cal.get("2026-09-30") ?? [];
    const todo = demo.todos.find((t) => t.title === "回复房东关于续租的邮件");
    const ppt = demo.tasks.find((t) => t.title === "交会议 PPT");
    expect(d930[2]).toMatchObject({ key: `todo:${todo?.id}`, sourceId: todo?.id, taskId: null });
    expect(d930[3]).toMatchObject({ key: `start:${ppt?.id}`, sourceId: ppt?.id, taskId: ppt?.id });
    const kp = demo.keyPoints.find((k) => k.text === "等审批 · 10/1 查");
    expect(cal.get("2026-10-01")?.[1]).toMatchObject({ key: `kp:${kp?.id}`, sourceId: kp?.id });
    expect(dayItemKeys(cal.get("2026-10-02") ?? [])).toEqual(
      (cal.get("2026-10-02") ?? []).map((i) => i.key),
    );
  });
});

describe("deriveCalendar · outside the 3 weeks", () => {
  const cal = deriveCalendar(demo, "2026-09-01", "2026-12-31", TODAY);

  it.each<[string, Row[]]>([
    ["2026-09-12", [st("orbit 域名备案")]],
    ["2026-09-15", [st("orbit 美国商标")]],
    ["2026-09-20", [st("注册美卡")]],
    ["2026-09-24", [st("交报销单"), ["start", "准备护照扫描件和地址证明", null, true, false]]],
    ["2026-10-31", [du("注册美卡"), du("注册美国公司")]],
    ["2026-12-15", [cp("orbit 美国商标 · 去查审查意见")]],
  ])("%s", (date, expected) => {
    expect(rows(cal.get(date))).toEqual(expected);
  });

  it("archived tasks keep marks up to the archive date (all before 9/26)", () => {
    const done = (title: string): Row => ["start", title, null, true, false];
    // Same column 0: 交报销单 (sort key V) before 准备护照… (x).
    expect(rows(cal.get("2026-09-24"))).toEqual([st("交报销单"), done("准备护照扫描件和地址证明")]);
    expect(rows(cal.get("2026-09-26"))).toEqual([
      ["reminder", "续费 orbit 域名", null, true, false],
      ["due", "准备护照扫描件和地址证明", null, true, false],
    ]);
    expect(rows(cal.get("2026-09-10"))).toEqual([done("orbit 软件著作权登记")]);
    // 整理 8 月账单 was archived on 9/4: its 9/5 due is gone, the 9/1 start stays.
    expect(rows(cal.get("2026-09-01"))).toEqual([done("整理 8 月账单")]);
    expect(rows(cal.get("2026-09-05"))).toEqual([]);
  });

  it("done todos stay on the calendar, struck through", () => {
    // 续费 orbit 域名: reminder 9/26, done 9/27.
    expect(rows(cal.get("2026-09-26"))).toContainEqual([
      "reminder",
      "续费 orbit 域名",
      null,
      true,
      false,
    ]);
  });
});

describe("deriveCalendar · manual day order (ui-spec §2.7)", () => {
  it("stored keys first, unknown keys skipped, new items appended in default order", () => {
    const cal0 = deriveCalendar(demo, "2026-10-09", "2026-10-09", TODAY);
    const [dentist, domain, accountant] = dayItemKeys(cal0.get("2026-10-09") ?? []);
    const snap = snapWith({
      dayOrders: [
        {
          id: "o1",
          date: "2026-10-09",
          itemKeys: [accountant, "event:gone", dentist],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    const cal = deriveCalendar(snap, "2026-10-01", "2026-10-31", TODAY);
    expect(dayItemKeys(cal.get("2026-10-09") ?? [])).toEqual([accountant, dentist, domain]);
    // Other days keep the default order.
    expect(rows(cal.get("2026-10-16"))).toEqual(EXPECTED["2026-10-16"]);
  });
});

describe("deriveCalendar · default-order details", () => {
  it("events: no time first, then by time, then by creation; reminders by todo order", () => {
    const base = demo.events[0];
    const todo = demo.todos[0];
    const snap = snapWith({
      events: [
        { ...base, id: "e1", date: "2026-10-20", time: "09:00", title: "b", createdAt: 2 },
        { ...base, id: "e2", date: "2026-10-20", time: "09:00", title: "a", createdAt: 1 },
        { ...base, id: "e3", date: "2026-10-20", time: null, title: "c", createdAt: 3 },
        { ...base, id: "e4", date: "2026-10-20", time: "08:00", title: "d", createdAt: 4 },
      ],
      todos: [
        { ...todo, id: "t1", sortKey: "x", remindDate: "2026-10-20", title: "late" },
        { ...todo, id: "t2", sortKey: "a", remindDate: "2026-10-20", title: "first" },
      ],
    });
    const cal = deriveCalendar(snap, "2026-10-20", "2026-10-20", TODAY);
    expect((cal.get("2026-10-20") ?? []).map((i) => i.title)).toEqual([
      "c",
      "d",
      "a",
      "b",
      "first",
      "late",
    ]);
  });

  it("archiving 注册美卡 on 9/30 drops the 10/1 checkpoint and the 10/31 due, keeps 9/20 start", () => {
    const snap = snapWith({});
    const card = snap.tasks.find((t) => t.title === "注册美卡");
    if (!card) throw new Error("seed");
    Object.assign(card, {
      status: "done",
      doneDate: TODAY,
      doneAt: 1,
      archivedDate: TODAY,
      archivedAt: 2,
    });
    const cal = deriveCalendar(snap, "2026-09-01", "2026-10-31", TODAY);
    expect(rows(cal.get("2026-10-01"))).toEqual([EXPECTED["2026-10-01"][0]]);
    expect(rows(cal.get("2026-10-31"))).toEqual([du("注册美国公司")]);
    expect(rows(cal.get("2026-09-20"))).toEqual([["start", "注册美卡", null, true, false]]);
  });

  it("a done task marks its items done; its due is no longer overdue", () => {
    const snap = snapWith({});
    const t = snap.tasks.find((x) => x.title === "交报销单");
    if (!t) throw new Error("seed");
    Object.assign(t, { status: "done", doneDate: TODAY, doneAt: 1 });
    const cal = deriveCalendar(snap, "2026-09-28", "2026-09-28", TODAY);
    expect(rows(cal.get("2026-09-28"))[1]).toEqual(["due", "交报销单", null, true, false]);
  });

  it("an open checkpoint past its date is overdue (ui-spec §9.3); ticked or on a done task it is not", () => {
    const snap = snapWith({});
    const late = (s: Snapshot) =>
      (deriveCalendar(s, "2026-10-01", "2026-10-02", "2026-10-03").get("2026-10-01") ?? []).find(
        (i) => i.kind === "checkpoint",
      )?.overdue;
    expect(late(snap)).toBe(true);
    expect(
      (deriveCalendar(snap, "2026-10-01", "2026-10-01", "2026-10-01").get("2026-10-01") ?? [])[0]
        .overdue,
    ).toBe(false);
    const kp = snap.keyPoints.find((k) => k.text === "等审批 · 10/1 查");
    if (kp) kp.doneDate = "2026-10-01";
    expect(late(snap)).toBe(false);
    if (kp) kp.doneDate = null;
    const t = snap.tasks.find((x) => x.title === "注册美卡");
    if (t) Object.assign(t, { status: "done", doneDate: "2026-10-02", doneAt: 1 });
    expect(late(snap)).toBe(false);
  });
});

// ── cross-day drop (ui-spec §2.7) ────────────────────────────────────────────────────────────

describe("planCalMove · the write for a drop on another day", () => {
  const day = (date: string) => deriveCalendar(demo, date, date, TODAY).get(date) ?? [];
  const item = (date: string, text: string) => {
    const hit = day(date).find((i) => i.title.includes(text));
    if (!hit) throw new Error(`${date} ${text}`);
    return hit;
  };

  it("event: date changes, time / end time / title kept", () => {
    const ev = item(TODAY, "演唱会");
    expect(planCalMove(demo, ev, "2026-10-05", TODAY)).toEqual({
      ok: true,
      move: {
        kind: "event",
        id: ev.sourceId,
        input: { date: "2026-10-05", time: "15:00", endTime: null, title: "演唱会" },
      },
    });
  });

  it("reminder: remind date changes, remind time kept", () => {
    const rm = item(TODAY, "回复房东");
    expect(planCalMove(demo, rm, "2026-09-28", TODAY)).toEqual({
      ok: true,
      move: {
        kind: "todo",
        id: rm.sourceId,
        input: { title: "回复房东关于续租的邮件", remindDate: "2026-09-28", remindTime: "18:00" },
      },
    });
  });

  it("checkpoint / dated wait: date and the date fragment in the text", () => {
    const cp = item("2026-10-02", "检查一遍初稿");
    const plan = planCalMove(demo, cp, "2026-10-04", TODAY);
    expect(plan).toMatchObject({
      ok: true,
      move: {
        kind: "keyPoint",
        input: { kind: "check", text: "10/4 检查一遍初稿", date: "2026-10-04" },
      },
    });
    const wait = item("2026-10-01", "审批");
    expect(planCalMove(demo, wait, "2026-10-12", TODAY)).toMatchObject({
      ok: true,
      move: { input: { kind: "wait", text: "等审批 · 10/12 查", date: "2026-10-12" } },
    });
  });

  it("start ≤ due and due ≥ start (equal is fine); a task without a due moves freely", () => {
    const start = day(TODAY).find((i) => i.kind === "start" && i.title === "交会议 PPT");
    if (!start) throw new Error("start");
    expect(planCalMove(demo, start, "2026-10-04", TODAY)).toEqual({
      ok: false,
      reason: "startAfterDue",
    });
    expect(planCalMove(demo, start, "2026-10-03", TODAY)).toMatchObject({
      ok: true,
      move: { kind: "taskDates", startDate: "2026-10-03", dueDate: "2026-10-03" },
    });
    const due = day("2026-10-02").find((i) => i.kind === "due");
    if (!due) throw new Error("due");
    expect(planCalMove(demo, due, "2026-09-28", TODAY)).toEqual({
      ok: false,
      reason: "dueBeforeStart",
    });
    expect(planCalMove(demo, due, "2026-09-29", TODAY)).toMatchObject({
      ok: true,
      move: { startDate: "2026-09-29", dueDate: "2026-09-29" },
    });
    const noDue = deriveCalendar(demo, "2026-09-12", "2026-09-12", TODAY)
      .get("2026-09-12")
      ?.find((i) => i.kind === "start" && i.title === "orbit 域名备案");
    if (!noDue) throw new Error("no-due start");
    expect(planCalMove(demo, noDue, "2027-01-01", TODAY)).toMatchObject({
      ok: true,
      move: { startDate: "2027-01-01", dueDate: null },
    });
  });

  it("archived tasks are locked (and listed by lockedCalKeys)", () => {
    const archived = demo.tasks.find((t) => t.title === "准备护照扫描件和地址证明");
    if (!archived) throw new Error("archived");
    const start = deriveCalendar(demo, "2026-09-24", "2026-09-24", TODAY)
      .get("2026-09-24")
      ?.find((i) => i.sourceId === archived.id);
    if (!start) throw new Error("archived start");
    expect(planCalMove(demo, start, "2026-09-25", TODAY)).toEqual({ ok: false, reason: "locked" });
    const locked = lockedCalKeys(demo);
    expect(locked.has(`start:${archived.id}`)).toBe(true);
    expect(locked.has(`due:${archived.id}`)).toBe(true);
    expect([...locked].every((k) => !k.startsWith("event:") && !k.startsWith("todo:"))).toBe(true);
  });

  it("applyCalMove patches only the moved row", () => {
    const ev = item(TODAY, "演唱会");
    const plan = planCalMove(demo, ev, "2026-10-05", TODAY);
    if (!plan.ok) throw new Error("plan");
    const next = applyCalMove(demo, plan.move);
    expect(next.events.find((e) => e.id === ev.sourceId)?.date).toBe("2026-10-05");
    expect(
      next.events.filter((e) => e.date !== demo.events.find((x) => x.id === e.id)?.date),
    ).toHaveLength(1);
    expect(
      deriveCalendar(next, "2026-10-05", "2026-10-05", TODAY).get("2026-10-05")?.[0]?.key,
    ).toBe(ev.key);
    expect(demo.events.find((e) => e.id === ev.sourceId)?.date).toBe(TODAY);
  });
});

describe("retargetDateText", () => {
  it.each([
    ["10/2 检查一遍初稿", "2026-10-02", "2026-10-04", "10/4 检查一遍初稿"],
    ["等审批 · 10/1 查", "2026-10-01", "2026-11-12", "等审批 · 11/12 查"],
    ["10月2日 检查", "2026-10-02", "2026-10-09", "10月9日 检查"],
    ["10月2号前交", "2026-10-02", "2026-10-09", "10月9号前交"],
    ["１０/２ 全角", "2026-10-02", "2026-10-05", "10/5 全角"],
    ["10/3 和 10/2 对一下", "2026-10-02", "2026-10-05", "10/3 和 10/5 对一下"],
    ["没有日期", "2026-10-02", "2026-10-05", "没有日期"],
    ["做完 3/4 页", "2026-03-04", "2026-03-05", "做完 3/4 页"],
  ])("%s (%s → %s) = %s", (text, from, to, out) => {
    expect(retargetDateText(text, from, to, TODAY)).toBe(out);
  });
});
