import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { Snapshot, Todo } from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import { reminderSummary, todoLists, todoTag } from "./todos";

const demo = fixture as Snapshot;
const TODAY = "2026-09-30";
const todo = (title: string): Todo => {
  const t = demo.todos.find((x) => x.title === title);
  if (!t) throw new Error(`no todo ${title}`);
  return t;
};

describe("todoLists (ui-spec §5)", () => {
  const { open, doneToday, archived } = todoLists(demo, TODAY);

  it("open = 4 undone todos in sort order (future reminders included)", () => {
    expect(open.map((t) => t.title)).toEqual([
      "回复房东关于续租的邮件",
      "修复 orbit 托盘图标闪烁 bug",
      "问会计：LLC 每年报什么税",
      "研究 Tauri 全局快捷键",
    ]);
  });

  it("done today = 1; done before today = archived (7)", () => {
    expect(doneToday.map((t) => t.title)).toEqual(["买展会用的名片"]);
    expect(archived).toHaveLength(7);
    expect(archived[0].title).toBe("给房东转账 10 月房租");
    expect(archived.at(-1)?.title).toBe("续签健身卡");
  });

  it("the next day, today's done todos move to archived", () => {
    const next = todoLists(demo, "2026-10-01");
    expect(next.doneToday).toEqual([]);
    expect(next.archived).toHaveLength(8);
  });

  it("done today is ordered by completion time", () => {
    const snap: Snapshot = {
      ...demo,
      todos: [
        { ...todo("买展会用的名片"), id: "a", doneAt: 300 },
        { ...todo("买展会用的名片"), id: "b", doneAt: 100 },
      ],
    };
    expect(todoLists(snap, TODAY).doneToday.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("todoTag · ui-spec §5.4", () => {
  it("seed rows: 今天 18:00 / — / 10/9 / —", () => {
    expect(todoTag(todo("回复房东关于续租的邮件"), TODAY)).toEqual({
      text: "今天 18:00",
      tone: "rm",
    });
    // Added yesterday, no reminder: no 「昨天顺延」 tag since 2026-10-02.
    expect(todoTag(todo("修复 orbit 托盘图标闪烁 bug"), TODAY)).toBeNull();
    expect(todoTag(todo("问会计：LLC 每年报什么税"), TODAY)).toEqual({ text: "10/9", tone: "rm" });
    expect(todoTag(todo("研究 Tauri 全局快捷键"), TODAY)).toBeNull();
  });

  it("all four reminder priorities; an old to-do without a reminder has none", () => {
    const base: Todo = { ...todo("研究 Tauri 全局快捷键") };
    const tag = (patch: Partial<Todo>) => todoTag({ ...base, ...patch }, TODAY);
    expect(tag({ remindDate: "2026-09-28", remindTime: "09:00" })).toEqual({
      text: "9/28 09:00",
      tone: "du",
    });
    expect(tag({ remindDate: TODAY })).toEqual({ text: "今天", tone: "rm" });
    expect(tag({ remindDate: "2026-10-01", remindTime: "08:30" })).toEqual({
      text: "明天 08:30",
      tone: "rm",
    });
    expect(tag({ remindDate: "2026-10-09", remindTime: "18:00" })?.text).toBe("10/9 18:00");
    expect(tag({ createdDate: "2026-09-29" })).toBeNull();
    expect(tag({ createdDate: "2026-09-20" })).toBeNull();
  });

  it("done todos have no tag", () => {
    expect(todoTag(todo("续费 orbit 域名"), TODAY)).toBeNull();
  });
});

describe("reminderSummary · ui-spec §12", () => {
  it.each<[string | null, string | null, "todoReminder" | "inboxSchedule", string]>([
    ["2026-10-09", null, "todoReminder", "10/9 周五 提醒"],
    ["2026-10-09", "18:00", "todoReminder", "10/9 周五 18:00 提醒"],
    [TODAY, "18:00", "todoReminder", "今天 18:00 提醒"],
    ["2026-10-01", null, "todoReminder", "明天 提醒"],
    [null, null, "todoReminder", "选一天"],
    ["2026-10-05", null, "inboxSchedule", "10/5 周一 · 进待办 + 日历"],
    ["2026-10-05", "09:00", "inboxSchedule", "10/5 周一 09:00 · 进待办 + 日历"],
    [null, null, "inboxSchedule", "选一天"],
  ])("%s %s %s → %s", (date, time, purpose, expected) => {
    expect(reminderSummary(date, time, TODAY, purpose)).toBe(expected);
  });
});

describe("todoTag / reminderSummary · English copy", () => {
  // test-setup.ts switches back to zh-Hans after every test.
  beforeEach(() => setLang("en"));

  it("tags: Today / Tomorrow / M/D", () => {
    const base: Todo = { ...todo("研究 Tauri 全局快捷键") };
    const tag = (patch: Partial<Todo>) => todoTag({ ...base, ...patch }, TODAY)?.text;
    expect(tag({ remindDate: TODAY, remindTime: "18:00" })).toBe("Today 18:00");
    expect(tag({ remindDate: "2026-10-01" })).toBe("Tomorrow");
    expect(tag({ remindDate: "2026-10-09" })).toBe("10/9");
  });

  it.each<[string | null, string | null, "todoReminder" | "inboxSchedule", string]>([
    ["2026-10-09", "18:00", "todoReminder", "Remind 10/9 Fri 18:00"],
    [TODAY, null, "todoReminder", "Remind today"],
    ["2026-10-01", "08:30", "todoReminder", "Remind tomorrow 08:30"],
    ["2026-10-05", null, "inboxSchedule", "10/5 Mon · To\u2011dos + calendar"],
    [null, null, "inboxSchedule", "Pick a day"],
  ])("%s %s %s → %s", (date, time, purpose, expected) => {
    expect(reminderSummary(date, time, TODAY, purpose)).toBe(expected);
  });
});
