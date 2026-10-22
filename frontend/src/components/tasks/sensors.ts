// Pointer sensors for the drag surfaces (ui-spec §5.6 todo rows, §7.2 task cards, §10.14 detail
// key points).
//
// Todo rows and key points: drag starts after moving > 4 px up or down, like a calendar item (no
// hold: a press that rests and then goes sideways is a slow swipe, not a drag). Cards: ≥ 5 px. On
// rows that swipe (SwipeRow) > 6 px sideways first is a swipe, so the drag gives up. None starts
// on buttons, checkboxes, inputs, tags or a scrollbar.

import { type PointerActivationConstraint, PointerSensor } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

export const TODO_DRAG_DISTANCE = 4;
/** Same as SWIPE_LOCK: sideways first is a swipe. */
export const TODO_SWIPE_LOCK = 6;
export const CARD_DRAG_DISTANCE = 5;
/** Key points start like calendar items and to-do rows (2026-10-02, was 6 px). */
export const STEP_DRAG_DISTANCE = 4;
/** Same as SWIPE_LOCK: sideways first is a swipe. */
export const STEP_SWIPE_LOCK = 6;

/** Elements that never start a drag (their own click wins). */
const NO_DRAG = "button, input, textarea, a, [data-no-drag], [role='menu']";

function onScrollbar(e: PointerEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style || (style.overflowY !== "auto" && style.overflowY !== "scroll")) return false;
  return e.offsetX > el.clientWidth;
}

export function canStartDrag(e: PointerEvent): boolean {
  if (!e.isPrimary || e.button !== 0) return false;
  const t = e.target;
  if (t instanceof Element && t.closest(NO_DRAG)) return false;
  return !onScrollbar(e);
}

type Activator = (typeof PointerSensor.activators)[number];

const activator: Activator = {
  eventName: "onPointerDown",
  handler: ({ nativeEvent }: ReactPointerEvent, { onActivation }) => {
    if (!canStartDrag(nativeEvent)) return false;
    onActivation?.({ event: nativeEvent });
    return true;
  },
};

/** > 4 px up or down. dnd-kit checks the tolerance before the distance on every move, so > 6 px
 *  sideways first cancels: the row swipes instead. */
export const TODO_CONSTRAINT: PointerActivationConstraint = {
  distance: { y: TODO_DRAG_DISTANCE },
  tolerance: { x: TODO_SWIPE_LOCK },
};

export class TodoRowSensor extends PointerSensor {
  static override activators = [activator];
}

export class CardSensor extends PointerSensor {
  static override activators = [activator];
}

/** > 4 px up or down; sideways movement past the lock first cancels (it is a swipe). */
export const STEP_CONSTRAINT: PointerActivationConstraint = {
  distance: { y: STEP_DRAG_DISTANCE },
  tolerance: { x: STEP_SWIPE_LOCK },
};

export class StepSensor extends PointerSensor {
  static override activators = [activator];
}
