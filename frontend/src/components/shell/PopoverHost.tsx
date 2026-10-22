// Anchored popovers (ui-spec §15.2): placed 6px beside the anchor, flipped when there is no
// room, kept inside the viewport; outside click and Esc close them. Content comes from tasks/DatePickerPopover and detail/NewTaskPopover.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import NewTaskPopover from "@/components/detail/NewTaskPopover";
import DatePickerPopover from "@/components/tasks/DatePickerPopover";
import { closeOpenSwipeRow } from "@/components/ui/SwipeRow";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import type { AnchorRect, Popover } from "@/types/domain";
import styles from "./PopoverHost.module.css";

export const POPOVER_GAP = 6;
export const VIEWPORT_MARGIN = 8;

/** Bounds a popover must stay inside: the viewport ({width, height}) or the paper's rect. */
export type PopoverBounds = { width: number; height: number; left?: number; top?: number };

/** Position for a popover of `size` next to `anchor`: right side first, left if it does not fit;
 *  pushed up / sideways to stay `margin` inside `bounds`. */
export function placePopover(
  anchor: AnchorRect,
  size: { width: number; height: number },
  bounds: PopoverBounds,
  gap: number = POPOVER_GAP,
  margin: number = VIEWPORT_MARGIN,
): { top: number; left: number; side: "right" | "left" } {
  const minX = (bounds.left ?? 0) + margin;
  const minY = (bounds.top ?? 0) + margin;
  const maxX = (bounds.left ?? 0) + bounds.width - margin;
  const maxY = (bounds.top ?? 0) + bounds.height - margin;
  let side: "right" | "left" = "right";
  let left = anchor.left + anchor.width + gap;
  if (left + size.width > maxX) {
    const flipped = anchor.left - gap - size.width;
    if (flipped >= minX) {
      side = "left";
      left = flipped;
    } else {
      left = Math.max(minX, maxX - size.width);
    }
  }
  let top = anchor.top;
  if (top + size.height > maxY) top = maxY - size.height;
  top = Math.max(minY, top);
  return { top, left, side };
}

/** Room kept between a popover and the paper edge, so its shadow is not clipped (§12.1). */
export const PAPER_MARGIN = 12;

/** The paper's rect (popovers live inside its overflow:hidden), or the viewport without one. */
function popoverBounds(): { bounds: PopoverBounds; margin: number } {
  const paper = document.querySelector<HTMLElement>("[data-paper]");
  const r = paper?.getBoundingClientRect();
  if (r && r.width > 0 && r.height > 0)
    return {
      bounds: { left: r.left, top: r.top, width: r.width, height: r.height },
      margin: PAPER_MARGIN,
    };
  return {
    bounds: { width: window.innerWidth, height: window.innerHeight },
    margin: VIEWPORT_MARGIN,
  };
}

function content(popover: Popover) {
  switch (popover.kind) {
    case "datePicker":
      return <DatePickerPopover purpose={popover.purpose} targetId={popover.targetId} />;
    case "newTask":
      return <NewTaskPopover fromInboxId={popover.fromInboxId} title={popover.title} />;
  }
}

export function PopoverHost() {
  const popover = useUiStore((s) => s.popover);
  const close = useUiStore((s) => s.closePopover);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEscLayer(popover !== null, close, ESC_PRIORITY.popover);
  // A row left swiped open closes: its Esc layer outranks the popover's.
  useEffect(() => {
    if (popover) closeOpenSwipeRow();
  }, [popover]);

  // Placed once measured, and again whenever the content changes size (a new task gaining key
  // points must not grow past the paper: §11.1 / §15.2).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!popover || !el) {
      setPos(null);
      return;
    }
    const place = () => {
      const rect = el.getBoundingClientRect();
      const { bounds, margin } = popoverBounds();
      const p = placePopover(
        popover.anchor,
        { width: rect.width, height: rect.height },
        bounds,
        POPOVER_GAP,
        margin,
      );
      setPos((old) =>
        old && old.top === p.top && old.left === p.left ? old : { top: p.top, left: p.left },
      );
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [popover]);

  useLayoutEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) close();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [popover, close]);

  if (!popover) return null;
  return (
    <div
      ref={ref}
      className={pos ? styles.anchor : `${styles.anchor} ${styles.measuring}`}
      style={pos ?? { top: 0, left: 0 }}
      data-testid="popover-anchor"
    >
      {content(popover)}
    </div>
  );
}
