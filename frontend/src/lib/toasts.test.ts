import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ToastSpec, ToastState } from "@/types/domain";
import { inboxTriageToast } from "./toasts";

function state(spec: ToastSpec): ToastState {
  return {
    text: spec.text,
    mergeKey: spec.mergeKey,
    meta: spec.meta ?? {},
    opIds: ["op"],
    until: 0,
    undone: false,
  };
}

function mergeAll(specs: ToastSpec[]): ToastState {
  let s = state(specs[0]);
  for (const next of specs.slice(1)) {
    const merged = next.merge?.(s, next);
    if (!merged) throw new Error("not mergeable");
    s = { ...s, ...merged };
  }
  return s;
}

describe("inboxTriageToast", () => {
  it("single-action texts", () => {
    expect(inboxTriageToast("todo").text).toBe("已进待办");
    expect(inboxTriageToast("scheduled", "2026-10-05").text).toBe("已进待办 · 10/5 提醒");
    expect(inboxTriageToast("task").text).toBe("已变成任务");
    expect(inboxTriageToast("deleted").text).toBe("已删掉");
    expect(inboxTriageToast("task").mergeKey).toBe("inbox");
  });

  it("three in a row merge", () => {
    const s = mergeAll([
      inboxTriageToast("scheduled", "2026-10-05"),
      inboxTriageToast("task"),
      inboxTriageToast("task"),
    ]);
    expect(s.text).toBe("收件箱整理完 3 条：1 条进待办 · 2 条变任务");
    expect(s.meta).toEqual({ todo: 1, task: 2 });
  });

  it("omits zero categories and counts deletes", () => {
    expect(mergeAll([inboxTriageToast("deleted"), inboxTriageToast("deleted")]).text).toBe(
      "收件箱整理完 2 条：2 条删掉",
    );
    expect(
      mergeAll([inboxTriageToast("todo"), inboxTriageToast("deleted"), inboxTriageToast("task")])
        .text,
    ).toBe("收件箱整理完 3 条：1 条进待办 · 1 条变任务 · 1 条删掉");
  });

  it("English texts and plurals", () => {
    setLang("en");
    expect(inboxTriageToast("todo").text).toBe("Added to To-dos");
    expect(inboxTriageToast("scheduled", "2026-10-05").text).toBe(
      "Added to To-dos · reminder 10/5",
    );
    expect(inboxTriageToast("task").text).toBe("Turned into a task");
    expect(inboxTriageToast("deleted").text).toBe("Deleted");
    expect(
      mergeAll([
        inboxTriageToast("scheduled", "2026-10-05"),
        inboxTriageToast("task"),
        inboxTriageToast("task"),
      ]).text,
    ).toBe("Sorted 3 inbox items: 1 to To-dos · 2 became tasks");
    expect(
      mergeAll([inboxTriageToast("todo"), inboxTriageToast("deleted"), inboxTriageToast("task")])
        .text,
    ).toBe("Sorted 3 inbox items: 1 to To-dos · 1 became a task · 1 deleted");
  });
});
