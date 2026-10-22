import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ArchiveEntry, Snapshot } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import {
  archiveBadgeCount,
  archiveEntries,
  archiveEntriesAt,
  archiveMeta,
  groupArchive,
  monthStats,
  searchArchive,
} from "./archive";
import { parseLocal, setClockOffset } from "./clock";
import { waitingDays } from "./taskMath";

const demo = fixture as Snapshot;
const TODAY = "2026-09-30";
const SUMMARY = "比预期快，Capital One 一周内就批了；下次直接用 ITIN 申请";

/** The demo snapshot with 注册美卡 + 课程作业 done on 9/30 and archived. */
function afterDemo(): Snapshot {
  const snap = structuredClone(demo);
  const at = (hhmm: string) => parseLocal(`${TODAY}T${hhmm}`) as number;
  const task = (title: string) => {
    const t = snap.tasks.find((x) => x.title === title);
    if (!t) throw new Error(title);
    return t;
  };
  const kp = (text: string) => {
    const k = snap.keyPoints.find((x) => x.text === text);
    if (!k) throw new Error(text);
    return k;
  };
  const todo = snap.todos.find((t) => t.title === "回复房东关于续租的邮件");
  if (todo) Object.assign(todo, { doneDate: TODAY, doneAt: at("10:01") });
  Object.assign(task("课程作业"), { status: "done", doneDate: TODAY, doneAt: at("10:02") });
  Object.assign(kp("等审批 · 10/1 查"), {
    text: "等审批 6 天 · 今天批准",
    doneDate: TODAY,
    isCurrent: false,
  });
  Object.assign(kp("激活卡"), { text: "激活卡、绑定 Apple Pay", doneDate: TODAY });
  Object.assign(task("注册美卡"), { status: "done", doneDate: TODAY, doneAt: at("10:03") });
  Object.assign(task("注册美卡"), {
    archivedDate: TODAY,
    archivedAt: at("10:04"),
    summary: SUMMARY,
  });
  Object.assign(task("课程作业"), { archivedDate: TODAY, archivedAt: at("10:05") });
  return snap;
}

const counts = (entries: ArchiveEntry[]) => ({
  all: entries.length,
  todos: entries.filter((e) => e.kind === "todo").length,
  tasks: entries.filter((e) => e.kind === "task").length,
});
const titles = (entries: ArchiveEntry[]) => entries.map((e) => e.title);

afterEach(() => setClockOffset(0));

describe("archive · before the demo", () => {
  const entries = archiveEntriesAt(demo, TODAY);

  it("全部 10 · 待办 7 · 任务 3; 归档 10", () => {
    expect(counts(entries)).toEqual({ all: 10, todos: 7, tasks: 3 });
    expect(archiveBadgeCount(demo, TODAY)).toBe(10);
    const stats = monthStats(demo, TODAY);
    expect([stats.todos, stats.tasks]).toEqual([7, 3]);
  });

  it("archiveEntries(snap) uses the app clock's today", () => {
    setClockOffset((parseLocal(`${TODAY}T10:00`) as number) - Date.now());
    expect(counts(archiveEntries(demo))).toEqual({ all: 10, todos: 7, tasks: 3 });
  });

  it("groups: 昨天 (3 todos) · 上周 (3) · 更早 · 9 月上旬 4 条 (collapsed)", () => {
    const groups = groupArchive(entries, TODAY);
    expect(groups.map((g) => [g.label, g.collapsed, titles(g.entries)])).toEqual([
      [
        "昨天 · 9/29 周二",
        false,
        ["给房东转账 10 月房租", "订国庆回京的车票", "寄回 9 月的报销发票"],
      ],
      [
        "上周 · 9/21 – 9/27",
        false,
        ["续费 orbit 域名", "准备护照扫描件和地址证明", "orbit 软件著作权登记"],
      ],
      [
        "更早 · 9 月上旬 4 条",
        true,
        ["寄回快递退货", "给手机换电池", "整理 8 月账单", "续签健身卡"],
      ],
    ]);
  });

  it("meta per row (ui-spec §14.5)", () => {
    const meta = Object.fromEntries(entries.map((e) => [e.title, archiveMeta(e)]));
    expect(meta).toEqual({
      寄回快递退货: "9/8 完成",
      给手机换电池: "9/6 完成",
      续签健身卡: "9/3 完成",
      "寄回 9 月的报销发票": "9/29 完成",
      订国庆回京的车票: "9/29 完成",
      "给房东转账 10 月房租": "9/29 完成",
      "续费 orbit 域名": "9/27 完成 · 逾期 1 天",
      准备护照扫描件和地址证明: "9/24 → 9/26 · 按时",
      "orbit 软件著作权登记": "9/10 → 9/26 · 用时 17 天 · 5 个关键点",
      "整理 8 月账单": "9/1 → 9/4 · 提前 1 天",
    });
  });

  it("软著 等别人 = 8 days, from the kept current_since (9/12 → 9/20)", () => {
    const e = entries.find((x) => x.title === "orbit 软件著作权登记");
    if (e?.kind !== "task") throw new Error("seed");
    expect(waitingDays(e.task, e.keyPoints, TODAY)).toBe(8);
  });
});

describe("archive · after the demo", () => {
  const snap = afterDemo();
  const entries = archiveEntriesAt(snap, TODAY);

  it("全部 12 · 待办 7 · 任务 5 (today's done todo is not archived yet)", () => {
    expect(counts(entries)).toEqual({ all: 12, todos: 7, tasks: 5 });
    expect(archiveBadgeCount(snap, TODAY)).toBe(12);
  });

  it("groups: 今天 · 9/30 周三 / 昨天 · 9/29 周二 / 上周 · 9/21 – 9/27 / 更早 · 9 月上旬 4 条", () => {
    const groups = groupArchive(entries, TODAY);
    expect(groups.map((g) => g.label)).toEqual([
      "今天 · 9/30 周三",
      "昨天 · 9/29 周二",
      "上周 · 9/21 – 9/27",
      "更早 · 9 月上旬 4 条",
    ]);
    expect(groups.map((g) => g.collapsed)).toEqual([false, false, false, true]);
    expect(titles(groups[0].entries)).toEqual(["注册美卡", "课程作业"]);
  });

  it("meta of the two new rows", () => {
    const meta = (title: string) => {
      const e = entries.find((x) => x.title === title);
      return e ? archiveMeta(e) : null;
    };
    expect(meta("注册美卡")).toBe("9/20 → 9/30 · 用时 11 天 · 提前 31 天");
    expect(meta("课程作业")).toBe("9/29 → 9/30 · 提前 2 天");
  });

  it("注册美卡 timeline keeps its 6 nodes in order (5 key points + 1 note)", () => {
    const e = entries.find((x) => x.title === "注册美卡");
    if (e?.kind !== "task") throw new Error("seed");
    expect(e.keyPoints.map((k) => [k.kind, k.text])).toEqual([
      ["do", "查资料选卡"],
      ["do", "准备材料"],
      ["do", "提交申请"],
      ["note", "邮件：申请已收到，7–10 个工作日内答复"],
      ["wait", "等审批 6 天 · 今天批准"],
      ["do", "激活卡、绑定 Apple Pay"],
    ]);
    expect(e.unfinished).toBe(false);
  });

  it("这个月做完了 7 / 5 and the three insights", () => {
    expect(monthStats(snap, TODAY)).toEqual({
      todos: 7,
      tasks: 5,
      insights: [
        "任务 5 件里 3 件提前完成",
        "有关键点的任务平均用时 14 天，其中等别人占一半",
        // Derived from the seed title; the mock-up's 「续费域名」 was hand-shortened.
        "逾期的只有 1 件（续费 orbit…）",
      ],
    });
  });

  it("search: title / key point / note / summary, case-insensitive; empty → all", () => {
    expect(titles(searchArchive(entries, "美卡"))).toEqual(["注册美卡"]);
    expect(titles(searchArchive(entries, "itin"))).toEqual(["注册美卡"]);
    expect(titles(searchArchive(entries, "Apple pay"))).toEqual(["注册美卡"]);
    expect(titles(searchArchive(entries, "工作日"))).toEqual(["注册美卡"]);
    expect(titles(searchArchive(entries, "ORBIT"))).toEqual([
      "续费 orbit 域名",
      "orbit 软件著作权登记",
    ]);
    expect(titles(searchArchive(entries, "受理"))).toEqual(["orbit 软件著作权登记"]);
    expect(searchArchive(entries, "  ")).toHaveLength(12);
    expect(searchArchive(entries, "不存在的词")).toEqual([]);
  });
});

describe("archive · rules not covered by the seed", () => {
  const base = archiveEntriesAt(demo, TODAY);
  const sample = base.find((e) => e.kind === "todo");
  if (sample?.kind !== "todo") throw new Error("seed");
  const at = (date: string, n = 0): ArchiveEntry => ({
    ...sample,
    id: `${date}-${n}`,
    title: `${date}-${n}`,
    date,
    at: n,
  });

  it("本周 = Monday … the day before yesterday; earlier months, 中旬 / 下旬, other years", () => {
    const groups = groupArchive(
      [
        at("2026-10-05"),
        at("2026-10-06"),
        at("2026-09-28"),
        at("2026-09-15"),
        at("2026-08-25"),
        at("2025-12-31"),
      ],
      "2026-10-08",
    );
    expect(groups.map((g) => [g.label, g.collapsed])).toEqual([
      ["本周 · 10/5 – 10/6", false],
      ["上周 · 9/28 – 10/4", false],
      ["更早 · 9 月中旬 1 条", true],
      ["更早 · 8 月下旬 1 条", true],
      ["更早 · 2025 年 12 月下旬 1 条", true],
    ]);
  });

  it("Monday: yesterday (Sunday) is 昨天, not 上周", () => {
    const groups = groupArchive([at("2026-10-04"), at("2026-10-03")], "2026-10-05");
    expect(groups.map((g) => g.label)).toEqual(["昨天 · 10/4 周日", "上周 · 9/28 – 10/4"]);
  });

  it("task late / archived unfinished", () => {
    const e = base.find((x) => x.title === "整理 8 月账单");
    if (e?.kind !== "task") throw new Error("seed");
    expect(
      archiveMeta({ ...e, task: { ...e.task, doneDate: "2026-09-07" }, date: "2026-09-07" }),
    ).toBe("9/1 → 9/7 · 晚了 2 天");
    const unfinished = {
      ...e,
      task: { ...e.task, status: "active" as const, doneDate: null, doneAt: null },
      unfinished: true,
    };
    expect(archiveMeta(unfinished)).toBe("9/1 → 9/4 · 没做完");
  });

  it("insight wording: 0 overdue, ≥ 3 overdue, ratio as a percentage", () => {
    const snap = structuredClone(demo);
    const renew = snap.todos.find((t) => t.title === "续费 orbit 域名");
    if (renew) renew.remindDate = null;
    expect(monthStats(snap, TODAY).insights).toEqual([
      "任务 3 件里 1 件提前完成",
      // 软著 alone: 8 / 17 = 47% → 「一半」
      "有关键点的任务平均用时 17 天，其中等别人占一半",
      "这个月没有逾期",
    ]);
    for (const t of snap.todos) if (t.doneDate && t.doneDate < TODAY) t.remindDate = "2026-09-01";
    const soft = snap.keyPoints.find((k) => k.text === "等受理");
    if (soft) soft.currentSince = "2026-09-17";
    expect(monthStats(snap, TODAY).insights.slice(1)).toEqual([
      "有关键点的任务平均用时 17 天，其中等别人占18%",
      "逾期的有 7 件",
    ]);
  });

  it("an empty month: zero counts, no insights", () => {
    expect(monthStats(demo, "2026-11-15")).toEqual({ todos: 0, tasks: 0, insights: [] });
    expect(archiveBadgeCount(demo, "2026-11-15")).toBe(0);
  });
});

describe("archive · English (i18n)", () => {
  const before = archiveEntriesAt(demo, TODAY);
  const after = archiveEntriesAt(afterDemo(), TODAY);
  const sample = before.find((e) => e.kind === "todo");
  if (sample?.kind !== "todo") throw new Error("seed");
  const at = (date: string): ArchiveEntry => ({ ...sample, id: date, title: date, date });

  it("group heads: Today / Yesterday / This week / Last week / Earlier · Early September · 4 items", () => {
    setLang("en");
    expect(groupArchive(after, TODAY).map((g) => g.label)).toEqual([
      "Today · 9/30 Wed",
      "Yesterday · 9/29 Tue",
      "Last week · 9/21 – 9/27",
      "Earlier · Early September · 4 items",
    ]);
    expect(
      groupArchive(
        [at("2026-10-05"), at("2026-10-06"), at("2026-09-15"), at("2025-12-31")],
        "2026-10-08",
      ).map((g) => g.label),
    ).toEqual([
      "This week · 10/5 – 10/6",
      "Earlier · Mid-September · 1 item",
      "Earlier · Late December 2025 · 1 item",
    ]);
    expect(groupArchive([at("2026-10-05")], "2026-10-07").map((g) => g.label)).toEqual([
      "This week · 10/5",
    ]);
  });

  it("row meta with plurals", () => {
    setLang("en");
    const meta = Object.fromEntries(before.map((e) => [e.title, archiveMeta(e)]));
    expect(meta["续费 orbit 域名"]).toBe("Done 9/27 · 1 day overdue");
    expect(meta.准备护照扫描件和地址证明).toBe("9/24 → 9/26 · On time");
    expect(meta["orbit 软件著作权登记"]).toBe("9/10 → 9/26 · Took 17 days · 5 steps");
    expect(meta["整理 8 月账单"]).toBe("9/1 → 9/4 · 1 day early");
    const e = after.find((x) => x.title === "注册美卡");
    if (!e) throw new Error("seed");
    expect(archiveMeta(e)).toBe("9/20 → 9/30 · Took 11 days · 31 days early");
    const bill = before.find((x) => x.title === "整理 8 月账单");
    if (bill?.kind !== "task") throw new Error("seed");
    expect(archiveMeta({ ...bill, unfinished: true })).toBe("9/1 → 9/4 · Not finished");
    expect(
      archiveMeta({
        ...bill,
        task: { ...bill.task, doneDate: "2026-09-07" },
        date: "2026-09-07",
      }),
    ).toBe("9/1 → 9/7 · 2 days late");
  });

  it("month insights", () => {
    setLang("en");
    expect(monthStats(afterDemo(), TODAY).insights).toEqual([
      "3 of 5 tasks finished early",
      "Tasks with steps took 14 days on average, half of it waiting on others",
      "Only 1 overdue (续费 orbit…)",
    ]);
    const snap = structuredClone(demo);
    for (const t of snap.todos) if (t.doneDate && t.doneDate < TODAY) t.remindDate = "2026-09-01";
    const soft = snap.keyPoints.find((k) => k.text === "等受理");
    if (soft) soft.currentSince = "2026-09-17";
    expect(monthStats(snap, TODAY).insights).toEqual([
      "1 of 3 tasks finished early",
      "Tasks with steps took 17 days on average, 18% of it waiting on others",
      "7 items overdue",
    ]);
    const clean = structuredClone(demo);
    for (const t of clean.todos) t.remindDate = null;
    expect(monthStats(clean, TODAY).insights.at(-1)).toBe("Nothing overdue this month");
  });

  it("switching back to zh-Hans restores the ui-spec copy", () => {
    setLang("en");
    expect(groupArchive(before, TODAY)[0].label).toBe("Yesterday · 9/29 Tue");
    setLang("zh-Hans");
    expect(groupArchive(before, TODAY)[0].label).toBe("昨天 · 9/29 周二");
  });
});
