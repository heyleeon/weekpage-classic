import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { KeyPoint, Snapshot, Task } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import {
  calendarLabel,
  cardRowDate,
  classifyKeyPoint,
  extractDate,
  findDateTokens,
  keyPointCounts,
  markerOf,
  overdueByKp,
  overdueDays,
} from "./keyPoint";

const demo = fixture as Snapshot;
const TODAY = "2026-09-30";

const taskByTitle = (title: string): Task => {
  const t = demo.tasks.find((x) => x.title === title);
  if (!t) throw new Error(`no task ${title}`);
  return t;
};
const kpsOf = (title: string): KeyPoint[] =>
  demo.keyPoints.filter((k) => k.taskId === taskByTitle(title).id);
const kpByText = (text: string): KeyPoint => {
  const k = demo.keyPoints.find((x) => x.text === text);
  if (!k) throw new Error(`no key point ${text}`);
  return k;
};

// Cases for ui-spec §19.1 (today = 2026-09-30). classifyKeyPoint reads D1 / D2 only (relative
// dates such as 「明天」 are read while typing, lib/stepInput.ts), so #10 has no date here.
const TABLE: [number, string, "do" | "wait" | "check", string | null][] = [
  [1, "等审批 · 10/1 查", "wait", "2026-10-01"],
  [2, "等管局 · 10/9 查", "wait", "2026-10-09"],
  [3, "等审查意见 · 12/15 查", "wait", "2026-12-15"],
  [4, "等导师回推荐信 · 10/20 查", "wait", "2026-10-20"],
  [5, "等助教回复选题", "wait", null],
  [6, "等 LLC 注册", "wait", null],
  [7, "10/1 查一遍参考文献格式", "check", "2026-10-01"],
  [8, "10/2 检查一遍初稿", "check", "2026-10-02"],
  [9, "10/7 让 Tom 看一遍", "check", "2026-10-07"],
  [10, "去查审批结果（明天）", "check", null],
  [11, "确认收货地址", "check", null],
  [12, "看一下合同第 3 条", "check", null],
  [13, "查资料选卡", "do", null],
  [14, "查清两所学校的申请要求 · 10/10", "do", "2026-10-10"],
  [15, "找同事过一遍", "do", null],
  [16, "管局通过 · 拿备案号", "do", null],
  [17, "提交网申 · 11/15", "do", "2026-11-15"],
  [18, "写英文文案", "do", null],
  [19, "等比例缩放 logo", "do", null],
  [20, "等于是重新提交一次", "do", null],
  [21, "催一下，等对方回复", "do", null],
  [22, "1/5 交年报", "do", "2027-01-05"],
  [23, "9/20 补材料", "do", "2026-09-20"],
  [24, "3/31 续签", "do", "2027-03-31"],
  [25, "做完 3/4 页 PPT", "do", null],
  [26, "2/30 交材料", "do", null],
  [27, "10月8日 看一遍终稿", "check", "2026-10-08"],
  [28, "10/1 15:00 打电话给银行", "do", "2026-10-01"],
  [29, "10/3 提交，10/8 复查", "check", "2026-10-03"],
  [30, "看一下 Stripe Atlas 和闲鱼服务商的区别", "check", null],
  [31, "v1/2 发布", "do", null],
  [32, "　等银行回电　", "wait", null],
];

describe("classifyKeyPoint · ui-spec §19.1", () => {
  it.each(TABLE)("#%i 「%s」→ %s %s", (_n, text, kind, date) => {
    expect(classifyKeyPoint(text, TODAY)).toEqual({ kind, date });
  });

  it("more boundaries", () => {
    expect(classifyKeyPoint("到时候查", TODAY).kind).toBe("check");
    expect(classifyKeyPoint("查进度", TODAY).kind).toBe("check");
    expect(classifyKeyPoint("查有没有回信", TODAY).kind).toBe("check");
    expect(classifyKeyPoint("10/9: 等回复", TODAY)).toEqual({ kind: "wait", date: "2026-10-09" });
    expect(classifyKeyPoint("等级考试报名", TODAY).kind).toBe("do");
    expect(classifyKeyPoint("１０／９ 查", TODAY)).toEqual({ kind: "check", date: "2026-10-09" });
  });
});

describe("findDateTokens / extractDate", () => {
  it("returns offsets in the original text, in order", () => {
    expect(findDateTokens("等审批 · 10/1 查", TODAY)).toEqual([
      { start: 6, end: 10, date: "2026-10-01" },
    ]);
    expect(findDateTokens("10/3 提交，10/8 复查", TODAY)).toEqual([
      { start: 0, end: 4, date: "2026-10-03" },
      { start: 8, end: 12, date: "2026-10-08" },
    ]);
    expect(findDateTokens("10月8日 和 10/9", TODAY).map((t) => t.date)).toEqual([
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  it("D2 accepts 号, rejects impossible dates and counts", () => {
    expect(extractDate("10月9号 交", TODAY)).toBe("2026-10-09");
    expect(extractDate("13/1 交", TODAY)).toBeNull();
    expect(extractDate("做完 3/4页", TODAY)).toBeNull();
    expect(extractDate("涨了 1/2倍", TODAY)).toBeNull();
    expect(extractDate("1/2/3", TODAY)).toBeNull();
    expect(extractDate("没有日期", TODAY)).toBeNull();
  });

  it("year: nearest occurrence, ties go forward", () => {
    // 2026-04-01 is 182 days back, 2027-04-01 is 183 days ahead.
    expect(extractDate("4/1", TODAY)).toBe("2026-04-01");
    expect(extractDate("12/31", "2027-06-30")).toBe("2026-12-31");
    // From 2026-12-31: 2027-01-02 vs 2026-01-02.
    expect(extractDate("1/2", "2026-12-31")).toBe("2027-01-02");
  });
});

describe("calendarLabel (ui-spec §2.5)", () => {
  it("check: task · text without the date", () => {
    expect(calendarLabel(kpByText("10/2 检查一遍初稿"), "交会议 PPT", TODAY)).toBe(
      "交会议 PPT · 检查一遍初稿",
    );
  });

  it("wait: task · 去查 + text without 等 / date / trailing 查", () => {
    expect(calendarLabel(kpByText("等审批 · 10/1 查"), "注册美卡", TODAY)).toBe(
      "注册美卡 · 去查审批",
    );
    expect(calendarLabel(kpByText("等管局 · 10/9 查"), "orbit 域名备案", TODAY)).toBe(
      "orbit 域名备案 · 去查管局",
    );
    expect(calendarLabel(kpByText("等审查意见 · 12/15 查"), "orbit 美国商标", TODAY)).toBe(
      "orbit 美国商标 · 去查审查意见",
    );
  });

  it("date in the middle, checkpoint text that is only a date", () => {
    const kp = { ...kpByText("10/2 检查一遍初稿"), text: "检查 10/2 初稿" };
    expect(calendarLabel(kp, "交会议 PPT", TODAY)).toBe("交会议 PPT · 检查 初稿");
    expect(calendarLabel({ ...kp, text: "10/2" }, "交会议 PPT", TODAY)).toBe("交会议 PPT");
    expect(calendarLabel({ ...kp, text: "让 Tom 看一遍 · 10/7" }, "官网", TODAY)).toBe(
      "官网 · 让 Tom 看一遍",
    );
  });

  it("a wait with nothing left after 等 / date / 查 keeps 「去查」 alone", () => {
    const kp = { ...kpByText("等审批 · 10/1 查"), text: "等 10/1 查" };
    expect(calendarLabel(kp, "注册美卡", TODAY)).toBe("注册美卡 · 去查");
  });

  it("English: the wait prefix follows the UI language; user text stays as typed", () => {
    setLang("en");
    expect(calendarLabel(kpByText("等审批 · 10/1 查"), "注册美卡", TODAY)).toBe(
      "注册美卡 · Check on 审批",
    );
    const wait = { ...kpByText("等审批 · 10/1 查"), text: "visa approval 10/1" };
    expect(calendarLabel(wait, "US card", TODAY)).toBe("US card · Check on visa approval");
    expect(calendarLabel({ ...wait, text: "10/1" }, "US card", TODAY)).toBe("US card · Check in");
    expect(calendarLabel(kpByText("10/2 检查一遍初稿"), "交会议 PPT", TODAY)).toBe(
      "交会议 PPT · 检查一遍初稿",
    );
  });
});

describe("overdueDays / overdueByKp / markerOf (ui-spec §9, §9.3)", () => {
  const meika = () => taskByTitle("注册美卡");
  const wait = () => kpByText("等审批 · 10/1 查");

  it("a dated open step is overdue from the day after its date", () => {
    expect(overdueDays(wait(), meika(), "2026-09-30")).toBe(0);
    expect(overdueDays(wait(), meika(), "2026-10-01")).toBe(0);
    expect(overdueDays(wait(), meika(), "2026-10-02")).toBe(1);
    expect(overdueDays(wait(), meika(), "2026-10-05")).toBe(4);
  });

  it("never: undated, done, a note, a done task, an archived task", () => {
    const late = "2026-10-05";
    expect(overdueDays(kpByText("激活卡"), meika(), late)).toBe(0);
    expect(overdueDays({ ...wait(), doneDate: "2026-10-01" }, meika(), late)).toBe(0);
    const note = kpsOf("注册美卡").find((k) => k.kind === "note") as KeyPoint;
    expect(overdueDays(note, meika(), late)).toBe(0);
    expect(overdueDays(wait(), { ...meika(), status: "done", doneDate: late }, late)).toBe(0);
    expect(
      overdueDays(wait(), { ...meika(), archivedAt: 1, archivedDate: "2026-10-04" }, late),
    ).toBe(0);
    // Any step type counts, 我来做 included.
    expect(overdueDays({ ...kpByText("激活卡"), date: "2026-10-01" }, meika(), late)).toBe(4);
  });

  it("overdueByKp keeps only this task's overdue steps", () => {
    const m = overdueByKp(meika(), demo.keyPoints, "2026-10-03");
    expect([...m]).toEqual([[wait().id, 2]]);
    expect(overdueByKp(meika(), demo.keyPoints, TODAY).size).toBe(0);
  });

  it("markers: done → overdue → by type; no 「current」 (stored isCurrent ignored)", () => {
    expect(markerOf(kpByText("查资料选卡"))).toBe("done");
    expect(markerOf(kpByText("查资料选卡"), true)).toBe("done");
    expect(markerOf(kpByText("做 10 页初稿"))).toBe("idle");
    expect(markerOf({ ...kpByText("做 10 页初稿"), isCurrent: true })).toBe("idle");
    expect(markerOf(wait())).toBe("wait");
    expect(markerOf(wait(), true)).toBe("overdue");
    expect(markerOf(kpByText("10/2 检查一遍初稿"))).toBe("check");
    expect(markerOf(kpByText("10/2 检查一遍初稿"), true)).toBe("overdue");
    expect(markerOf(kpByText("等 LLC 注册"))).toBe("wait");
    expect(markerOf(kpByText("激活卡"))).toBe("idle");
  });
});

describe("keyPointCounts", () => {
  it("does not count notes", () => {
    expect(keyPointCounts(kpsOf("注册美卡"))).toEqual({ total: 5, done: 3 });
    expect(keyPointCounts(kpsOf("orbit 域名备案"))).toEqual({ total: 7, done: 4 });
    expect(keyPointCounts(kpsOf("orbit 美国商标"))).toEqual({ total: 3, done: 1 });
    expect(keyPointCounts([])).toEqual({ total: 0, done: 0 });
  });
});

describe("cardRowDate (ui-spec §8.6)", () => {
  const wait = () => kpByText("等审批 · 10/1 查");

  it("a dated step shows its date unless its text already names that day or it is overdue", () => {
    expect(cardRowDate({ ...wait(), text: "等审批" }, false, TODAY)).toBe("2026-10-01");
    expect(cardRowDate(wait(), false, TODAY)).toBeNull();
    // The text names another day: the row still says the real one.
    expect(cardRowDate({ ...wait(), date: "2026-10-03" }, false, TODAY)).toBe("2026-10-03");
    expect(cardRowDate({ ...wait(), text: "等审批" }, true, TODAY)).toBeNull();
    expect(cardRowDate(kpByText("激活卡"), false, TODAY)).toBeNull();
  });

  it("a note always shows its date", () => {
    const note = demo.keyPoints.find((k) => k.kind === "note" && k.date !== null);
    if (!note) throw new Error("no dated note");
    expect(cardRowDate(note, false, TODAY)).toBe(note.date);
  });
});
