// Item drag on the calendar grid (ui-spec §2.7): one DndContext for the whole grid. dnd-kit lifts
// the item (pointer, 4px, no long press), moves the overlay and handles Esc; where it would land is
// computed here from the live DOM (cell under the pointer inside the clipped viewport, insertion
// index from the other items' midpoints), so it stays right while the rows slide.
//
// While an item is held: the pointer within 16px of a day list's top / bottom scrolls that list;
// within EDGE_PX of the grid's top / bottom (or beyond) for PAGE_DELAY_MS pages one week that way,
// then every PAGE_REPEAT_MS (list scrolling wins over paging at the bottom edge).
// Drop: same day → commitDayOrder; another day → commitMove (refused moves go back with a toast).

import {
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  PointerSensor,
  type ScreenReaderInstructions,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import type { CalItem } from "@/types/domain";
import { commitDayOrder, commitMove, moveRejection } from "./calendarActions";
import { shiftWeek } from "./calendarNav";
import { insertIndexAt, isSameOrder } from "./dayOrder";
import { canScroll, setGrabCursor } from "./useWeekScroll";

/** Pointer travel that lifts an item (ui-spec §2.7, revised: no 300ms long press). */
export const DRAG_ACTIVATION = { distance: 4 } as const;
/** Paging zone at the grid's top / bottom edge while an item is held. */
export const EDGE_PX = 24;
export const PAGE_DELAY_MS = 400;
export const PAGE_REPEAT_MS = 600;
/** In-cell auto-scroll zone and speed (px per frame). */
const LIST_EDGE_PX = 16;
const LIST_SPEED_PX = 6;

/** Where the held item would land: `index` among the day's items without the dragged one. */
export type DropTarget = { date: string; index: number; valid: boolean };
export type CalDrag = { item: CalItem; height: number; target: DropTarget | null };

type Point = { x: number; y: number };

function pointOf(e: Event | null): Point | null {
  if (e && "clientX" in e && "clientY" in e) {
    return { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY };
  }
  return null;
}

function inside(r: DOMRect, p: Point): boolean {
  return p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;
}

/** The day list scroller of a cell (parent of [data-day-items]). */
function listOf(cell: HTMLElement): HTMLElement | null {
  return cell.querySelector<HTMLElement>("[data-day-items]")?.parentElement ?? null;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.date === b.date && a.index === b.index && a.valid === b.valid;
}

export type CalDragApi = {
  drag: CalDrag | null;
  sensors: ReturnType<typeof useSensors>;
  accessibility: {
    announcements: Announcements;
    screenReaderInstructions: ScreenReaderInstructions;
  };
  onDragStart(e: DragStartEvent): void;
  onDragMove(e: DragMoveEvent): void;
  onDragEnd(e: DragEndEvent): void;
  onDragCancel(): void;
  /** The drop lands where the placeholder is (no animation back to the origin). */
  accepted: boolean;
};

export function useCalDrag(
  byDate: Map<string, CalItem[]>,
  viewportRef: RefObject<HTMLDivElement | null>,
): CalDragApi {
  const { t } = useTranslation();
  const setDragging = useUiStore((s) => s.setDragging);
  const selectCalItem = useUiStore((s) => s.selectCalItem);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: DRAG_ACTIVATION }));
  const [drag, setDragState] = useState<CalDrag | null>(null);
  // Mirror for handlers / the frame loop (dnd-kit may call a handler from an earlier render).
  const dragRef = useRef<CalDrag | null>(null);
  const byDateRef = useRef(byDate);
  byDateRef.current = byDate;
  const origin = useRef<Point | null>(null);
  const pointer = useRef<Point | null>(null);
  /** Midpoints of the other items per day, in list-content coordinates (measured once). */
  const mids = useRef(new Map<string, number[]>());
  const validity = useRef(new Map<string, boolean>());
  const edge = useRef<{ dir: -1 | 1; at: number } | null>(null);
  const raf = useRef(0);

  const setDrag = useCallback((next: CalDrag | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const accessibility = useMemo(
    () => ({
      announcements: {
        onDragStart: () => t("calendar.drag.pickedUp"),
        onDragOver: () => undefined,
        onDragEnd: () => t("calendar.drag.dropped"),
        onDragCancel: () => t("calendar.drag.cancelled"),
      } satisfies Announcements,
      screenReaderInstructions: { draggable: t("calendar.drag.instructions") },
    }),
    [t],
  );

  /** The day cell under `p`, only inside the viewport's clip (hidden buffer rows never count). */
  const cellAt = useCallback(
    (p: Point): HTMLElement | null => {
      const vp = viewportRef.current;
      if (!vp || !inside(vp.getBoundingClientRect(), p)) return null;
      for (const cell of vp.querySelectorAll<HTMLElement>("[data-date]")) {
        if (inside(cell.getBoundingClientRect(), p)) return cell;
      }
      return null;
    },
    [viewportRef],
  );

  const targetIn = useCallback((cell: HTMLElement, y: number, d: CalDrag): DropTarget | null => {
    const date = cell.dataset.date;
    const list = listOf(cell);
    if (!date || !list) return null;
    const lr = list.getBoundingClientRect();
    let m = mids.current.get(date);
    if (!m) {
      m = [];
      for (const n of list.querySelectorAll<HTMLElement>("[data-day-items] > [data-key]")) {
        if (n.dataset.key === d.item.key) continue;
        const r = n.getBoundingClientRect();
        m.push(r.top + r.height / 2 - lr.top + list.scrollTop);
      }
      mids.current.set(date, m);
    }
    let valid = validity.current.get(date);
    if (valid === undefined) {
      valid = date === d.item.date || moveRejection(d.item, date) === null;
      validity.current.set(date, valid);
    }
    return { date, index: insertIndexAt(m, y - lr.top + list.scrollTop), valid };
  }, []);

  /** Recomputes the drop target from the last pointer position. */
  const update = useCallback(() => {
    const d = dragRef.current;
    const p = pointer.current;
    if (!d || !p) return;
    const cell = cellAt(p);
    const target = cell ? targetIn(cell, p.y, d) : null;
    if (!sameTarget(target, d.target)) setDrag({ ...d, target });
  }, [cellAt, setDrag, targetIn]);

  /** Time-based work while an item is held: list auto-scroll, edge paging, rows sliding. */
  const frame = useCallback(() => {
    const p = pointer.current;
    const vp = viewportRef.current;
    if (!dragRef.current) return;
    if (p && vp) {
      const now = performance.now();
      const vr = vp.getBoundingClientRect();
      let scrolling = 0;
      const cell = cellAt(p);
      const list = cell ? listOf(cell) : null;
      if (list) {
        const lr = list.getBoundingClientRect();
        if (p.y < lr.top + LIST_EDGE_PX && canScroll(list, -1)) scrolling = -1;
        else if (p.y > lr.bottom - LIST_EDGE_PX && canScroll(list, 1)) scrolling = 1;
        if (scrolling !== 0) list.scrollTop += scrolling * LIST_SPEED_PX;
      }
      const overX = p.x >= vr.left && p.x <= vr.right;
      const zone = !overX ? 0 : p.y < vr.top + EDGE_PX ? -1 : p.y > vr.bottom - EDGE_PX ? 1 : 0;
      if (zone === 0 || scrolling === zone) edge.current = null;
      else if (edge.current?.dir !== zone) edge.current = { dir: zone, at: now + PAGE_DELAY_MS };
      else if (now >= edge.current.at) {
        edge.current.at = now + PAGE_REPEAT_MS;
        shiftWeek(zone);
      }
      update();
    }
    raf.current = requestAnimationFrame(frame);
  }, [cellAt, update, viewportRef]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    mids.current.clear();
    validity.current.clear();
    edge.current = null;
    origin.current = null;
    pointer.current = null;
    setGrabCursor(false);
    setDrag(null);
    setDragging(false);
  }, [setDrag, setDragging]);

  // Unmounted mid-drag (⌘2 switches page): release the blur guard and the cursor too.
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (!dragRef.current) return;
      dragRef.current = null;
      setGrabCursor(false);
      useUiStore.getState().setDragging(false);
    },
    [],
  );

  // Esc during a drag: dnd-kit cancels on its own; this layer keeps Esc from going further.
  useEscLayer(drag !== null, () => undefined, ESC_PRIORITY.drag);

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const item = (e.active.data.current as { item?: CalItem } | undefined)?.item;
      if (!item) return;
      const height = Math.max(18, e.active.rect.current.initial?.height ?? 18);
      const index = (byDateRef.current.get(item.date) ?? []).findIndex((i) => i.key === item.key);
      origin.current = pointOf(e.activatorEvent);
      pointer.current = origin.current;
      setDrag({ item, height, target: { date: item.date, index, valid: true } });
      selectCalItem(null);
      setDragging(true);
      setGrabCursor(true);
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(frame);
    },
    [frame, selectCalItem, setDrag, setDragging],
  );

  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const o = origin.current;
      if (!o) return;
      pointer.current = { x: o.x + e.delta.x, y: o.y + e.delta.y };
      update();
    },
    [update],
  );

  const onDragEnd = useCallback(() => {
    const d = dragRef.current;
    stop();
    const target = d?.target;
    if (!d || !target) return;
    const items = byDateRef.current.get(target.date) ?? [];
    if (target.date === d.item.date) {
      if (!isSameOrder(items, d.item.key, target.index)) {
        commitDayOrder(target.date, items, d.item.key, target.index);
      }
      return;
    }
    // Refused moves (start after due…) toast why; the overlay animates back.
    commitMove(d.item, target.date, items, target.index);
  }, [stop]);

  const target = drag?.target ?? null;
  const accepted =
    drag !== null &&
    target?.valid === true &&
    (target.date !== drag.item.date ||
      !isSameOrder(byDate.get(target.date) ?? [], drag.item.key, target.index));

  return {
    drag,
    sensors,
    accessibility,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel: stop,
    accepted,
  };
}
