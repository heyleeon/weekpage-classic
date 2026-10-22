// Small helpers shared by the tasks page components (anchors, optimistic sort keys, highlight).

import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { POPOVER_GAP } from "@/components/shell/PopoverHost";
import { useUiStore } from "@/hooks/useUiStore";
import type { AnchorRect, HighlightReason } from "@/types/domain";

/** The date picker sits this far right of the left column (ui-spec §12). */
export const LEFT_PICKER_OFFSET = 12;

/** Fade-out after a highlight ends (ui-spec §6.4: ≈3 s, then 400 ms fade). */
export const HIGHLIGHT_FADE_MS = 400;

/** Plain viewport rect of an element. */
export function rectOf(el: Element): AnchorRect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Anchor for popovers opened from the left column (date picker, 「变成任务」): PopoverHost puts
 * the panel `POPOVER_GAP` right of the anchor, so the anchor is stretched to end
 * `LEFT_PICKER_OFFSET − POPOVER_GAP` past the column's right edge; its top = the trigger row.
 */
export function leftColumnAnchor(row: Element): AnchorRect {
  const r = row.getBoundingClientRect();
  const column = row.closest("[data-left-column]");
  const right = column ? column.getBoundingClientRect().right : r.right;
  return {
    top: r.top,
    left: r.left,
    width: Math.max(0, right + LEFT_PICKER_OFFSET - POPOVER_GAP - r.left),
    height: r.height,
  };
}

/**
 * A sort key that orders right after `prev` (or first when null) and before `next` for the
 * optimistic `patchLocal` before a move command; the real key comes back with the refresh.
 */
export function provisionalKey(prev: string | null, next: string | null): string {
  if (prev !== null) return `${prev}\u0001`;
  return next !== null && next > "" ? "" : "\u0001";
}

/** Highlight reason for `id` while it lasts (`fading` during the last 400 ms fade-out). */
export function useHighlightFor(id: string): { reason: HighlightReason; fading: boolean } | null {
  const highlight = useUiStore((s) => (s.highlight?.id === id ? s.highlight : null));
  const [, tick] = useState(0);
  const now = Date.now();
  const until = highlight?.until ?? 0;

  useEffect(() => {
    if (!highlight) return;
    const left = highlight.until - Date.now();
    if (left <= -HIGHLIGHT_FADE_MS) return;
    const wait = left > 0 ? left : left + HIGHLIGHT_FADE_MS;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.max(0, wait) + 10);
    return () => window.clearTimeout(t);
  });

  if (!highlight || now >= until + HIGHLIGHT_FADE_MS) return null;
  return { reason: highlight.reason, fading: now >= until };
}

/** True when the event started inside something that has its own click behaviour. */
export function isInteractiveTarget(target: EventTarget | null, root: Element): boolean {
  if (!(target instanceof Element)) return false;
  // Events from portals (menus) bubble through React but are outside the DOM subtree.
  if (!root.contains(target)) return true;
  const hit = target.closest("button, input, textarea, a, [role='menu'], [data-no-open]");
  return hit !== null && root.contains(hit) && hit !== root;
}

/** dnd-kit screen-reader texts in the UI language (its built-in ones are English only). */
export function useDragA11y(surface: "todo" | "card" | "step"): {
  announcements: Announcements;
  screenReaderInstructions: ScreenReaderInstructions;
} {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      announcements: {
        onDragStart: () => t("tasks.drag.pickedUp"),
        onDragOver: () => undefined,
        onDragEnd: () => t("tasks.drag.dropped"),
        onDragCancel: () => t("tasks.drag.cancelled"),
      },
      screenReaderInstructions: {
        draggable: t(`tasks.drag.${surface}Instructions`),
      },
    }),
    [t, surface],
  );
}
