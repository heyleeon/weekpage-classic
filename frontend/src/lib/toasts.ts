// Toast specs shared across units.

// Texts: i18n `toasts.inbox.*`, read in the language active when the toast is shown / merged.

import { t } from "@/i18n";
import type { ToastSpec, ToastState } from "@/types/domain";
import { formatMD } from "./dates";

export type InboxTriageKind = "todo" | "scheduled" | "task" | "deleted";

const INBOX_MERGE_KEY = "inbox";

/** Category counted in the merged text: 「进待办」「变任务」「删掉」. */
function category(kind: InboxTriageKind): "todo" | "task" | "deleted" {
  return kind === "scheduled" ? "todo" : kind;
}

function mergedText(meta: Record<string, number>): string {
  const todo = meta.todo ?? 0;
  const task = meta.task ?? 0;
  const deleted = meta.deleted ?? 0;
  const parts = [
    todo > 0 ? t("toasts.inbox.partTodo", { count: todo }) : null,
    task > 0 ? t("toasts.inbox.partTask", { count: task }) : null,
    deleted > 0 ? t("toasts.inbox.partDeleted", { count: deleted }) : null,
  ].filter((p): p is string => p !== null);
  return t("toasts.inbox.merged", {
    count: todo + task + deleted,
    parts: parts.join(t("toasts.inbox.partSeparator")),
  });
}

/**
 * Toast after one inbox triage action (ui-spec §6.4). Single: 「已进待办」「已进待办 · 10/5 提醒」
 * 「已变成任务」「已删掉」. Consecutive triage toasts merge into
 * 「收件箱整理完 N 条：a 条进待办 · b 条变任务 · c 条删掉」 (zero categories omitted) and one undo
 * reverts all of them. Used by every inbox triage action.
 */
export function inboxTriageToast(kind: InboxTriageKind, date?: string): ToastSpec {
  const text =
    kind === "todo"
      ? t("toasts.inbox.todo")
      : kind === "scheduled"
        ? date
          ? t("toasts.inbox.scheduled", { date: formatMD(date) })
          : t("toasts.inbox.todo")
        : kind === "task"
          ? t("toasts.inbox.task")
          : t("toasts.inbox.deleted");
  return {
    text,
    mergeKey: INBOX_MERGE_KEY,
    meta: { [category(kind)]: 1 },
    merge: (prev: ToastState, next: ToastSpec) => {
      const meta: Record<string, number> = { ...prev.meta };
      for (const [k, v] of Object.entries(next.meta ?? {})) meta[k] = (meta[k] ?? 0) + v;
      return { text: mergedText(meta), meta };
    },
  };
}
