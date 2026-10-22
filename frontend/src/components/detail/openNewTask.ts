// mod+N (ui-spec §11.6, §17): opens 「新建任务」 anchored below the TaskHeader 「+ 新任务」 button,
// right-aligned; without that button (archive page, or not rendered) the popover is centred.

import { useHotkey } from "@/hooks/useHotkeys";
import { useUiStore } from "@/hooks/useUiStore";
import { t } from "@/i18n";
import type { AnchorRect } from "@/types/domain";

/** Width of the new-task popover (ui-spec §11.2). */
export const NEW_TASK_WIDTH = 340;
/** Rough popover height, used only to centre it when there is no button. */
const NEW_TASK_EST_H = 640;
/** Same gap PopoverHost adds between anchor and popover. */
const GAP = 6;

/** The 「+ 新任务」 button of the task header: its data-new-task-button marker, else its
 *  label in the active language. A page parked off-screen (inert) does not count. */
export function findNewTaskButton(root: ParentNode = document): HTMLElement | null {
  const shown = (el: HTMLElement) => !el.closest("[inert]");
  const marked = Array.from(root.querySelectorAll<HTMLElement>("[data-new-task-button]"));
  const hit = marked.find(shown);
  if (hit) return hit;
  const label = t("tasks.header.newTask").replace(/\s+/g, "").toLowerCase();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("button"))) {
    if (el.closest("[role=dialog]") || !shown(el)) continue;
    if ((el.textContent ?? "").replace(/\s+/g, "").toLowerCase().includes(label)) return el;
  }
  return null;
}

/**
 * Anchor rect for the popover. PopoverHost puts a popover `GAP` px to the right of its anchor, so
 * a zero-width anchor ending `GAP + width` before the button's right edge lands the popover
 * below the button, right-aligned with it.
 */
export function newTaskAnchor(button: HTMLElement | null): AnchorRect {
  if (button) {
    const r = button.getBoundingClientRect();
    return { top: r.bottom + GAP, left: r.right - NEW_TASK_WIDTH - GAP, width: 0, height: 0 };
  }
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  const h = typeof window === "undefined" ? 860 : window.innerHeight;
  return {
    top: Math.max(0, (h - NEW_TASK_EST_H) / 2),
    left: (w - NEW_TASK_WIDTH) / 2 - GAP,
    width: 0,
    height: 0,
  };
}

/** Opens 「新建任务」 (no inbox item, empty title). */
export function openNewTask(): void {
  const ui = useUiStore.getState();
  if (ui.page === "calendar") return;
  ui.openPopover({ kind: "newTask", title: "", anchor: newTaskAnchor(findNewTaskButton()) });
}

/** mod+N on the task / archive pages (mounted by the toolbar archive button). */
export function useNewTaskHotkey(): void {
  const page = useUiStore((s) => s.page);
  const overlay = useUiStore((s) => s.overlay);
  useHotkey(
    "mod+n",
    () => {
      openNewTask();
      return true;
    },
    { enabled: page !== "calendar" && overlay === null },
  );
}
