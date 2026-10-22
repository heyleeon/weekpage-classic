// zh-Hans · toasts — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Shared toast texts (ui-spec §15.3). A toast stores its text when it is shown, so these are
// read at call time in the active language. Feature-specific toasts live in their own section.

const toasts = {
  /** Shown after an undo succeeded (hooks/useUiStore undoToast). */
  undone: "已撤销",
  undoFailed: "撤销没成功",
  /** Any write that failed (hooks/useDataStore mutate); the English details go to the log. */
  mutateFailed: "操作没成功，再试一次",
  /** Inbox triage (lib/toasts.ts inboxTriageToast, ui-spec §6.4). */
  inbox: {
    todo: "已进待办",
    /** date = 「10/5」 (formatMD). */
    scheduled: "已进待办 · {{date}} 提醒",
    task: "已变成任务",
    deleted: "已删掉",
    /** Consecutive triage toasts merged: count = total, parts = the parts below joined. */
    merged_one: "收件箱整理完 {{count}} 条：{{parts}}",
    merged_other: "收件箱整理完 {{count}} 条：{{parts}}",
    partTodo_one: "{{count}} 条进待办",
    partTodo_other: "{{count}} 条进待办",
    partTask_one: "{{count}} 条变任务",
    partTask_other: "{{count}} 条变任务",
    partDeleted_one: "{{count}} 条删掉",
    partDeleted_other: "{{count}} 条删掉",
    /** Joins the parts (spaces included). */
    partSeparator: " · ",
  },
};

export default toasts;
