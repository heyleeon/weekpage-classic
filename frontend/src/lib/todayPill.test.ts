import { describe, expect, it } from "vitest";
import type { Snapshot } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import { todayPill } from "./todayPill";

const demo = fixture as Snapshot;
const TODAY = "2026-09-30";
const clone = (): Snapshot => structuredClone(demo);
const taskId = (title: string) => demo.tasks.find((t) => t.title === title)?.id;

describe("todayPill · ui-spec §3", () => {
  it("seed: 4 件待办 | 课程作业 还剩 2 天 | 注册美卡 明天 去查 | 收件箱 3 件", () => {
    expect(todayPill(demo, TODAY)).toEqual({
      overdue: null,
      todos: 4,
      due: { taskId: taskId("课程作业"), title: "课程作业", days: 2 },
      check: { taskId: taskId("注册美卡"), title: "注册美卡", more: 0 },
      inbox: 3,
      empty: false,
    });
  });

  it("overdue tasks never show (交报销单); due today → days 0", () => {
    const snap = clone();
    const t = snap.tasks.find((x) => x.title === "写 Q3 季度总结");
    if (t) t.dueDate = TODAY;
    expect(todayPill(snap, TODAY).due).toEqual({
      taskId: taskId("写 Q3 季度总结"),
      title: "写 Q3 季度总结",
      days: 0,
    });
  });

  it("several checks tomorrow → 等 N 项; done / archived ones are skipped", () => {
    const snap = clone();
    const kp = snap.keyPoints.find((k) => k.text === "10/2 检查一遍初稿");
    if (kp) kp.date = "2026-10-01";
    expect(todayPill(snap, TODAY).check).toEqual({
      taskId: taskId("注册美卡"),
      title: "注册美卡",
      more: 1,
    });
    if (kp) kp.doneDate = TODAY;
    expect(todayPill(snap, TODAY).check?.more).toBe(0);
    const card = snap.tasks.find((t) => t.title === "注册美卡");
    if (card) Object.assign(card, { archivedDate: TODAY, archivedAt: 1 });
    expect(todayPill(snap, TODAY).check).toBeNull();
  });

  it("overdue steps (§9.3): the earliest date first, counted across tasks", () => {
    // 10/3: 等审批 · 10/1 查 (注册美卡) and 10/2 检查一遍初稿 (交会议 PPT) are both past.
    expect(todayPill(demo, "2026-10-03").overdue).toEqual({
      taskId: taskId("注册美卡"),
      title: "注册美卡",
      count: 2,
    });
    expect(todayPill(demo, "2026-10-02").overdue).toEqual({
      taskId: taskId("注册美卡"),
      title: "注册美卡",
      count: 1,
    });
    const snap = clone();
    const wait = snap.keyPoints.find((k) => k.text === "等审批 · 10/1 查");
    if (wait) wait.doneDate = "2026-10-01";
    expect(todayPill(snap, "2026-10-03").overdue).toEqual({
      taskId: taskId("交会议 PPT"),
      title: "交会议 PPT",
      count: 1,
    });
    // A done task's steps are never overdue; nothing left → the part hides.
    const ppt = snap.tasks.find((t) => t.title === "交会议 PPT");
    if (ppt) Object.assign(ppt, { status: "done", doneDate: "2026-10-02" });
    expect(todayPill(snap, "2026-10-03").overdue).toBeNull();
  });

  it("parts hide at zero; everything hidden → empty", () => {
    const snap: Snapshot = { ...clone(), inbox: [], todos: [], tasks: [], keyPoints: [] };
    expect(todayPill(snap, TODAY)).toEqual({
      overdue: null,
      todos: 0,
      due: null,
      check: null,
      inbox: 0,
      empty: true,
    });
  });
});
