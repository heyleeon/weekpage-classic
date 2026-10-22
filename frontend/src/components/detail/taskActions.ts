// Task lifecycle actions shared by the detail view, the archive confirmation and the archive page.

import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { shortestColumn } from "@/lib/board";
import { keyPointCounts } from "@/lib/keyPoint";
import type { KeyPoint, Mutation, Task } from "@/types/domain";

/** 「已归档「注册美卡」」 (ui-spec §13.5, §15.3). */
export function archivedToast(title: string): { text: string } {
  return { text: t("detail.toasts.archived", { title }) };
}

/**
 * The 「归档」 button (card or detail head): with key points → the confirmation (§13.1);
 * without → archive at once with an undo toast.
 */
export async function requestArchive(task: Task, kps: KeyPoint[]): Promise<void> {
  const ui = useUiStore.getState();
  if (keyPointCounts(kps.filter((k) => k.taskId === task.id)).total > 0) {
    ui.openOverlay({ kind: "archiveConfirm", taskId: task.id });
    return;
  }
  ui.closeOverlay();
  await useDataStore
    .getState()
    .mutate(() => api.archiveTask(task.id, null), { toast: archivedToast(task.title) });
}

/** Restore an archived task to the top of the shortest column, highlighted (§14.6). */
export async function restoreArchivedTask(taskId: string): Promise<Mutation | null> {
  const data = useDataStore.getState();
  const snap = data.snap;
  const column = snap ? shortestColumn(snap, useUiStore.getState().columnHeights) : 0;
  return data.mutate(() => api.restoreTask(taskId, column), {
    toast: { text: t("detail.toasts.restoredTask") },
    highlight: (m) => ({ id: m.id ?? taskId, reason: "restored" }),
  });
}

/** Restore an archived todo to the end of the open list (ui-spec §14.6). */
export async function restoreArchivedTodo(todoId: string): Promise<Mutation | null> {
  return useDataStore
    .getState()
    .mutate(() => api.restoreTodo(todoId), { toast: { text: t("detail.toasts.restoredTodo") } });
}
