import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { KeyPoint, Snapshot, Task } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import { addDays, diffDays, formatMDW } from "./dates";
import {
  countParts,
  detailTrack,
  displayStatus,
  dueDelta,
  dueUrgent,
  timeBar,
  usedDays,
  waitingDays,
} from "./taskMath";

const demo = fixture as Snapshot;
const T = "2026-09-30";

const task = (title: string): Task => {
  const t = demo.tasks.find((x) => x.title === title);
  if (!t) throw new Error(`no task ${title}`);
  return t;
};
const kps = demo.keyPoints;

/** A done copy of a seed task. */
const doneOn = (t: Task, C: string): Task => ({ ...t, status: "done", doneDate: C, doneAt: 1 });

/** Plain-text view of a bar: [topLeft, topRight, fill (3 dp), bottom start, bottom end]. */
function texts(t: Task, ks: KeyPoint[] = kps, today = T) {
  const b = timeBar(t, ks, today);
  return [
    b.topLeft.text,
    b.topRight?.text ?? null,
    Math.round(b.fill * 1000) / 1000,
    b.bottom?.start.text ?? null,
    b.bottom?.end.text ?? null,
  ];
}

describe("timeBar · ui-spec §20 (T = 9/30)", () => {
  it("课程作业 9/29–10/2: M=4 N=2 X=2, fill 0.50", () => {
    expect(texts(task("课程作业"))).toEqual([
      "今天 · 第 2 / 4 天",
      "还剩 2 天",
      0.5,
      "9/29 开始",
      "10/2 截止",
    ]);
  });

  it("写 Q3 季度总结 9/30–10/6: M=7 N=1 X=6, fill 0.143", () => {
    expect(texts(task("写 Q3 季度总结"))).toEqual([
      "今天 · 第 1 / 7 天",
      "还剩 6 天",
      0.143,
      "9/30 开始",
      "10/6 截止",
    ]);
  });

  it("交会议 PPT 9/30–10/3: M=4 N=1 X=3, fill 0.25", () => {
    expect(texts(task("交会议 PPT"))).toEqual([
      "今天 · 第 1 / 4 天",
      "还剩 3 天",
      0.25,
      "9/30 开始",
      "10/3 截止",
    ]);
  });

  it("注册美卡 9/20–10/31 (waiting): M=42 N=11 X=31, fill 0.262, rm", () => {
    expect(texts(task("注册美卡"))).toEqual([
      "今天 · 第 11 / 42 天",
      "还剩 31 天",
      0.262,
      "9/20 开始",
      "10/31 截止",
    ]);
    expect(timeBar(task("注册美卡"), kps, T).fillTone).toBe("rm");
  });

  it("注册美国公司 9/29–10/31: M=33 N=2 X=31, fill 0.061", () => {
    expect(texts(task("注册美国公司"))).toEqual([
      "今天 · 第 2 / 33 天",
      "还剩 31 天",
      0.061,
      "9/29 开始",
      "10/31 截止",
    ]);
  });

  it("申请海外学校 9/30–12/15: M=77 N=1 X=76", () => {
    const t: Task = {
      ...task("课程作业"),
      title: "申请海外学校",
      startDate: T,
      dueDate: "2026-12-15",
    };
    expect(texts(t).slice(0, 2)).toEqual(["今天 · 第 1 / 77 天", "还剩 76 天"]);
  });

  it("landing 文案 (upcoming) 10/8–10/16: 共 9 天, 还有 8 天, no fill, due not red", () => {
    const b = timeBar(task("landing 文案"), kps, T);
    expect(texts(task("landing 文案"))).toEqual([
      "10/8 开始 · 共 9 天",
      "还有 8 天",
      0,
      "10/8 开始",
      "10/16 截止",
    ]);
    expect(b.topLeft).toEqual({ text: "10/8 开始 · 共 9 天", tone: "subtle", strong: true });
    expect(b.fillTone).toBe("none");
    expect(b.bottom?.end.tone).toBe("muted");
  });

  it("orbit 官网做英文版 (upcoming) 10/5–10/9: 共 5 天, 还有 5 天, remind 10/8", () => {
    const t: Task = {
      ...task("landing 文案"),
      title: "orbit 官网做英文版",
      startDate: "2026-10-05",
      dueDate: "2026-10-09",
      remindDayBefore: true,
    };
    expect(texts(t).slice(0, 2)).toEqual(["10/5 开始 · 共 5 天", "还有 5 天"]);
    expect(detailTrack(t, [], T).remindDate).toBe("2026-10-08");
  });

  it("交报销单 (overdue) 9/24–9/28: 截止 9/28 周一 · 已过 2 天", () => {
    const b = timeBar(task("交报销单"), kps, T);
    expect(texts(task("交报销单"))).toEqual([
      "截止 9/28 周一",
      "已过 2 天",
      1,
      "9/24 开始",
      "9/28 截止",
    ]);
    expect(b.topLeft.tone).toBe("du");
    expect(b.topRight?.tone).toBe("du");
    expect(b.fillTone).toBe("du");
    // The due label stays muted: the red is in the headline (ui-spec §8.4).
    expect(b.bottom?.end.tone).toBe("muted");
  });

  it("orbit 域名备案 (no due) 9/12, 4/7: 已进行 19 天, fill 0.571, no bottom row", () => {
    expect(texts(task("orbit 域名备案"))).toEqual([
      "已进行 19 天",
      "9/12 开始 · 不设截止",
      0.571,
      null,
      null,
    ]);
  });

  it("orbit 美国商标 (no due) 9/15, 1/3: 已进行 16 天, fill 0.333", () => {
    expect(texts(task("orbit 美国商标"))).toEqual([
      "已进行 16 天",
      "9/15 开始 · 不设截止",
      0.333,
      null,
      null,
    ]);
  });

  it("注册美卡 done 9/30: 今天完成 · 用时 11 天 + 提前 31 天", () => {
    const t = doneOn(task("注册美卡"), T);
    const b = timeBar(t, kps, T);
    expect(texts(t)).toEqual(["今天完成 · 用时 11 天", "提前 31 天", 1, "9/20 开始", "10/31 截止"]);
    expect(b.topLeft.tone).toBe("st");
    expect(b.fillTone).toBe("done");
    expect(usedDays(t)).toBe(11);
    expect(dueDelta(t)).toEqual({ kind: "early", days: 31 });
  });

  it("课程作业 done 9/30: 用时 2 天, 提前 2 天", () => {
    const t = doneOn(task("课程作业"), T);
    expect(texts(t).slice(0, 2)).toEqual(["今天完成 · 用时 2 天", "提前 2 天"]);
  });

  it("准备护照扫描件和地址证明 (archived): C = D → on time", () => {
    const t = task("准备护照扫描件和地址证明");
    expect(dueDelta(t)).toEqual({ kind: "onTime", days: 0 });
    expect(usedDays(t)).toBe(3);
    expect(texts(t, kps, "2026-09-26").slice(0, 2)).toEqual(["今天完成 · 用时 3 天", "当天完成"]);
  });

  it("orbit 软件著作权登记 (archived): 用时 17 天, no due", () => {
    const t = task("orbit 软件著作权登记");
    expect(usedDays(t)).toBe(17);
    expect(dueDelta(t)).toBeNull();
    expect(texts(t, kps, "2026-09-27").slice(0, 2)).toEqual([
      "昨天完成 · 用时 17 天",
      "9/10 开始 · 不设截止",
    ]);
    expect(texts(t).slice(0, 1)).toEqual(["9/26 完成 · 用时 17 天"]);
  });

  it("等别人天数: 注册美卡 6 (current_since 9/24 → today / done 9/30), 软著 8", () => {
    expect(waitingDays(task("注册美卡"), kps, T)).toBe(6);
    const done = kps.map((k) =>
      k.text.startsWith("等审批") ? { ...k, doneDate: T, isCurrent: false } : k,
    );
    expect(waitingDays(doneOn(task("注册美卡"), T), done, T)).toBe(6);
    // Marked done from the status menu with 「等审批」 still open (ui-spec §13.3): its 6 days still count.
    expect(waitingDays(doneOn(task("注册美卡"), T), kps, T)).toBe(6);
    expect(waitingDays(task("orbit 软件著作权登记"), kps, T)).toBe(8);
  });

  it("等别人 without current_since (the automatic current never stamps it): from 提交申请 9/24", () => {
    const fresh = kps.map((k) => (k.text.startsWith("等审批") ? { ...k, currentSince: null } : k));
    expect(waitingDays(task("注册美卡"), fresh, T)).toBe(6);
    // Marked done from the status menu with 「等审批」 still open: it still counts.
    expect(waitingDays(doneOn(task("注册美卡"), T), fresh, T)).toBe(6);
    // Only the first open key point was current: a later open wait does not count.
    const later = fresh.map((k) => (k.text === "激活卡" ? { ...k, kind: "wait" as const } : k));
    expect(waitingDays(doneOn(task("注册美卡"), T), later, T)).toBe(6);
  });

  it("平均用时 (11 + 17) / 2 = 14; 等别人 (6 + 8) / 28 = 一半", () => {
    const used = usedDays(doneOn(task("注册美卡"), T)) + usedDays(task("orbit 软件著作权登记"));
    expect(Math.round(used / 2)).toBe(14);
    expect((6 + 8) / used).toBe(0.5);
  });

  it("weekdays: 9/28 周一, 10/5 周一, 10/9 周五, 10/31 周六, 9/29 周二", () => {
    expect(
      ["2026-09-28", "2026-10-05", "2026-10-09", "2026-10-31", "2026-09-29"].map(formatMDW),
    ).toEqual(["9/28 周一", "10/5 周一", "10/9 周五", "10/31 周六", "9/29 周二"]);
  });
});

describe("timeBar · extra cases", () => {
  const base = task("课程作业");

  it("S = D = T → 今天 · 第 1 / 1 天 + 今天截止", () => {
    const b = timeBar({ ...base, startDate: T, dueDate: T }, [], T);
    expect(b.topLeft.text).toBe("今天 · 第 1 / 1 天");
    expect(b.topRight).toEqual({ text: "今天截止", tone: "du", strong: false });
    expect(b.fill).toBe(1);
  });

  it("T = D → 今天截止 instead of 还剩", () => {
    const b = timeBar(base, [], "2026-10-02");
    expect([b.topLeft.text, b.topRight?.text]).toEqual(["今天 · 第 4 / 4 天", "今天截止"]);
  });

  it("T = D + 1 → overdue 已过 1 天", () => {
    expect(displayStatus(base, "2026-10-03")).toBe("overdue");
    expect(timeBar(base, [], "2026-10-03").topRight?.text).toBe("已过 1 天");
  });

  it("C > D → 晚了 N 天", () => {
    const t = doneOn(base, "2026-10-05");
    expect(dueDelta(t)).toEqual({ kind: "late", days: 3 });
    const b = timeBar(t, [], "2026-10-05");
    expect(b.topRight).toEqual({ text: "晚了 3 天", tone: "du", strong: false });
  });

  it("C < S → 用时 1 天", () => {
    expect(usedDays(doneOn(base, "2026-09-20"))).toBe(1);
  });
});

describe("timeBar · the card's headline and date range (ui-spec §8.4)", () => {
  const base = task("课程作业"); // 9/29 → 10/2
  const head = (t: Task, today: string) => {
    const { text, tone } = timeBar(t, [], today).headline;
    return [text, tone];
  };

  it("days left / past / to go / elapsed, in the tone that matters", () => {
    expect(head(base, T)).toEqual(["还剩 2 天", "text"]);
    expect(head(base, "2026-10-02")).toEqual(["今天截止", "du"]);
    expect(head(base, "2026-10-04")).toEqual(["已过 2 天", "du"]);
    expect(head({ ...base, startDate: "2026-10-08", dueDate: "2026-10-16" }, T)).toEqual([
      "还有 8 天",
      "subtle",
    ]);
    expect(head({ ...base, dueDate: null }, T)).toEqual(["已进行 2 天", "text"]);
    expect(head(doneOn(base, "2026-10-01"), "2026-10-01")).toEqual(["提前 1 天", "st"]);
    expect(timeBar(base, [], T).headline.strong).toBe(true);
  });

  it("aside: the other sentence, muted; none without a due date or when overdue", () => {
    expect(timeBar(base, [], T).aside).toEqual({
      text: "今天 · 第 2 / 4 天",
      tone: "muted",
      strong: false,
    });
    expect(
      timeBar({ ...base, startDate: "2026-10-08", dueDate: "2026-10-16" }, [], T).aside?.text,
    ).toBe("10/8 开始 · 共 9 天");
    expect(timeBar({ ...base, dueDate: null }, [], T).aside).toBeNull();
    expect(timeBar(base, [], "2026-10-04").aside).toBeNull();
  });

  it("dueUrgent: due today or past, not done", () => {
    expect(dueUrgent(base, T)).toBe(false);
    expect(dueUrgent(base, "2026-10-02")).toBe(true);
    expect(dueUrgent(base, "2026-10-04")).toBe(true);
    expect(dueUrgent(doneOn(base, "2026-10-04"), "2026-10-04")).toBe(false);
    expect(dueUrgent({ ...base, dueDate: null }, "2026-10-04")).toBe(false);
  });

  it("ends: bare dates, null due without a due date", () => {
    expect(timeBar(base, [], T).ends).toEqual({ start: "9/29", due: "10/2" });
    expect(timeBar({ ...base, dueDate: null }, [], T).ends.due).toBeNull();
  });
});

describe("countParts · the headline's count, set large on the card", () => {
  it("splits around the last whole number", () => {
    expect(countParts("还剩 25 天")).toEqual(["还剩 ", "25", " 天"]);
    expect(countParts("Day 25")).toEqual(["Day ", "25", ""]);
    expect(countParts("8 days overdue")).toEqual(["", "8", " days overdue"]);
  });

  it("skips dates and times; none → null", () => {
    expect(countParts("9/28 完成 · 用时 11 天")).toEqual(["9/28 完成 · 用时 ", "11", " 天"]);
    expect(countParts("截止 9/28 周一")).toBeNull();
    expect(countParts("今天截止")).toBeNull();
    expect(countParts("Due today")).toBeNull();
  });
});

describe("displayStatus · ui-spec §0.5", () => {
  it("done > overdue > upcoming > stored", () => {
    expect(displayStatus(task("交报销单"), T)).toBe("overdue");
    expect(displayStatus(task("landing 文案"), T)).toBe("upcoming");
    expect(displayStatus(task("注册美卡"), T)).toBe("waiting");
    expect(displayStatus(task("课程作业"), T)).toBe("active");
    expect(displayStatus(doneOn(task("交报销单"), T), T)).toBe("done");
    // No due date never becomes overdue.
    expect(displayStatus(task("orbit 域名备案"), "2030-01-01")).toBe("waiting");
  });

  it("a no-due task without key points only draws the track", () => {
    const b = timeBar({ ...task("orbit 域名备案"), id: "lonely" }, kps, T);
    expect([b.fill, b.fillTone]).toEqual([0, "none"]);
  });
});

describe("detailTrack · ui-spec §10.2 / §20.1", () => {
  it("注册美卡: today tick 11/42, due dot, remind 10/30; a dated 等别人 step shows its hourglass", () => {
    const v = detailTrack(task("注册美卡"), kps, T);
    expect(v.todayAt).toBeCloseTo(11 / 42);
    expect(v.dueDot).toBe(true);
    expect(v.remindDate).toBe("2026-10-30");
    const kp = kps.find((k) => k.text === "等审批 · 10/1 查");
    expect(v.dots).toMatchObject([{ keyPointId: kp?.id, at: 12 / 42, marker: "wait", count: 1 }]);
  });

  it("each dated step wears its own marker: bell, overdue !, done ✓", () => {
    const kp = kps.find((k) => k.text === "10/2 检查一遍初稿") as KeyPoint;
    const t = task("交会议 PPT");
    const at =
      (diffDays(t.startDate, "2026-10-02") + 1) / (diffDays(t.startDate, t.dueDate as string) + 1);
    expect(detailTrack(t, kps, T).dots).toMatchObject([{ keyPointId: kp.id, at, marker: "check" }]);
    expect(detailTrack(t, kps, "2026-10-03").dots[0].marker).toBe("overdue");
    const done = kps.map((k) => (k.id === kp.id ? { ...k, doneDate: "2026-10-01" } : k));
    expect(detailTrack(t, done, "2026-10-03").dots[0].marker).toBe("done");
  });

  it("notes stay off the track; markers merge only when they cannot sit apart", () => {
    const t = task("交会议 PPT");
    const base = kps.find((k) => k.text === "10/2 检查一遍初稿") as KeyPoint;
    const extra = (id: string, kind: KeyPoint["kind"], date: string): KeyPoint => ({
      ...base,
      id,
      kind,
      date,
      text: id,
    });
    const rows = [
      ...kps.filter((k) => k.taskId !== t.id),
      base,
      extra("note", "note", "2026-10-01"),
      extra("do-same-day", "do", "2026-10-02"),
      extra("next-day", "do", "2026-10-03"),
    ];
    // Plenty of room: only the two on the same day share a spot (bell wins, tip lists both).
    const apart = detailTrack(t, rows, T, 0.01).dots;
    expect(apart).toHaveLength(2);
    expect(apart.find((d) => d.count === 2)).toMatchObject({ marker: "check" });
    expect(apart.find((d) => d.count === 2)?.tip).toContain("do-same-day");
    expect(apart.map((d) => d.tip).join()).not.toContain("note");
    // No room (a gap wider than a day): all three merge.
    expect(detailTrack(t, rows, T, 0.5).dots).toHaveLength(1);
  });

  it("dots are clamped; no tick outside [S, D]", () => {
    const t = task("交会议 PPT");
    const early = kps.map((k) =>
      k.text === "10/2 检查一遍初稿" ? { ...k, date: "2026-09-01" } : k,
    );
    expect(detailTrack(t, early, T).dots[0].at).toBe(0);
    expect(detailTrack(t, kps, "2026-10-04").todayAt).toBeNull();
  });

  it("steps after the due date stretch the track; an open one offers a new due date", () => {
    const t = task("交会议 PPT");
    const S = t.startDate;
    const D = t.dueDate as string;
    const base = kps.find((k) => k.text === "10/2 检查一遍初稿") as KeyPoint;
    const later: KeyPoint = { ...base, id: "later", kind: "check", date: addDays(D, 6) };
    const v = detailTrack(t, [...kps, later], T);
    const span = diffDays(S, later.date as string) + 1;
    expect(v.dueAt).toBeCloseTo((diffDays(S, D) + 1) / span);
    expect(v.dots.find((d) => d.keyPointId === "later")?.at).toBe(1);
    expect(v.extendTo).toBe(later.date);
    // Done step or done task: still stretched, no offer.
    const doneStep = detailTrack(t, [...kps, { ...later, doneDate: T }], T);
    expect([doneStep.dueAt, doneStep.extendTo]).toEqual([v.dueAt, null]);
    const doneTask = detailTrack({ ...t, status: "done", doneDate: T }, [...kps, later], T);
    expect(doneTask.extendTo).toBeNull();
    // Nothing after the due date: the due dot stays at the end.
    expect(detailTrack(t, kps, T)).toMatchObject({ dueAt: 1, extendTo: null });
  });

  it("no due date: an open-ended track whose scale grows with the days passed", () => {
    const t = task("orbit 域名备案");
    const v = detailTrack(t, kps, T);
    const N = diffDays(t.startDate, T) + 1;
    expect(v.dueDot).toBe(false);
    expect(v.remindDate).toBeNull();
    // Scale = smallest of 7/14/30/… days leaving 20% free past today and the latest dated step;
    // today sits at N / scale.
    const lastDated = Math.max(
      ...kps
        .filter((k) => k.taskId === t.id && k.kind !== "note" && k.date)
        .map((k) => diffDays(t.startDate, k.date as string) + 1),
      0,
    );
    const scale = [7, 14, 30, 60, 90, 180, 365].find(
      (h) => h >= Math.max(N, lastDated) * 1.25,
    ) as number;
    expect(v.todayAt).toBeCloseTo(N / scale);
    expect(v.bar.fill).toBeCloseTo(N / scale);
    expect(v.bar.fillTone).not.toBe("none");
  });

  it("a step marker on today stands for today: no tick through it", () => {
    const t = task("orbit 域名备案"); // no due date, waiting
    const step = kps.find((k) => k.taskId === t.id && k.kind !== "note") as KeyPoint;
    const onToday = { ...step, id: "today", date: T };
    const others = kps.filter((k) => k.taskId === t.id && k.date !== T);
    expect(detailTrack(t, others, T).todayAt).not.toBeNull();
    expect(detailTrack(t, [...others, onToday], T).todayAt).toBeNull();
    // With a due date too; a marker merely nearby (beyond half a marker) keeps the tick.
    const due = task("课程作业"); // 9/29 → 10/2, today 9/30
    const dueStep = { ...onToday, taskId: due.id };
    expect(detailTrack(due, [dueStep], T, 0.05).todayAt).toBeNull();
    expect(detailTrack(due, [{ ...dueStep, date: "2026-10-01" }], T, 0.05).todayAt).not.toBeNull();
  });

  it("no due date, not started: empty track, no tick", () => {
    const t = { ...task("orbit 域名备案"), startDate: "2026-10-20" };
    const v = detailTrack(t, kps, T);
    expect([v.bar.fill, v.bar.fillTone, v.todayAt]).toEqual([0, "none", null]);
  });
});

describe("timeBar · English copy (i18n timeBar.*, plurals)", () => {
  // test-setup.ts switches back to zh-Hans after every test.
  beforeEach(() => setLang("en"));

  it("running with a due date: Today · Day N of M, N days left / Due today", () => {
    expect(texts(task("课程作业"))).toEqual([
      "Today · Day 2 of 4",
      "2 days left",
      0.5,
      "Start 9/29",
      "Due 10/2",
    ]);
    const base = task("课程作业");
    expect(timeBar(base, [], "2026-10-01").topRight?.text).toBe("1 day left");
    expect(timeBar(base, [], "2026-10-02").topRight?.text).toBe("Due today");
  });

  it("upcoming, overdue, no due date", () => {
    expect(texts(task("landing 文案")).slice(0, 2)).toEqual(["Starts 10/8 · 9 days", "In 8 days"]);
    const soon = { ...task("landing 文案"), startDate: "2026-10-01", dueDate: "2026-10-01" };
    expect(texts(soon).slice(0, 2)).toEqual(["Starts 10/1 · 1 day", "In 1 day"]);
    expect(texts(task("交报销单")).slice(0, 2)).toEqual(["Due 9/28 Mon", "2 days overdue"]);
    expect(timeBar(task("课程作业"), [], "2026-10-03").topRight?.text).toBe("1 day overdue");
    expect(texts(task("orbit 域名备案")).slice(0, 2)).toEqual([
      "Day 19",
      "From 9/12 · No due date",
    ]);
  });

  it("done: when · Took N days + early / on time / late", () => {
    expect(texts(doneOn(task("注册美卡"), T)).slice(0, 2)).toEqual([
      "Done today · Took 11 days",
      "31 days early",
    ]);
    const base = task("课程作业");
    expect(texts(doneOn(base, "2026-10-01"), [], "2026-10-02").slice(0, 2)).toEqual([
      "Done yesterday · Took 3 days",
      "1 day early",
    ]);
    expect(texts(doneOn(base, "2026-10-02"), [], "2026-10-05").slice(0, 2)).toEqual([
      "Done 10/2 · Took 4 days",
      "On time",
    ]);
    expect(texts(doneOn(base, "2026-10-03"), [], "2026-10-03")[1]).toBe("1 day late");
    expect(texts(doneOn(base, "2026-09-20"), [], "2026-09-20")[0]).toBe("Done today · Took 1 day");
  });
});
