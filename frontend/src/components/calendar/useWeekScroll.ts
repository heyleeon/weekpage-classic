// Week scrolling of the calendar grid: the rows slide by whole weeks (math in ./weekScroll.ts).
//
// - Every anchor change that this hook did not make itself (keys, 「回到今天」, a wheel notch, the
//   window being shown, paging while dragging an item) slides the rows from where they were
//   (--duration-card, ease-out; instant with reduced motion or before the first snapshot has
//   settled; a timer finishes it if animation frames stall).
// - Trackpad / pixel wheel: the rows follow the gesture and snap to the nearest week
//   WHEEL_IDLE_MS after it goes idle. Wheel notches page exactly one week each. A gesture that
//   starts over a day list that can still scroll that way scrolls the list instead (decided once
//   per gesture). Horizontal-dominant events are ignored.
// - Grab: a press on empty calendar space that moves ≥ 4px vertically grabs the rows; release
//   snaps to the nearest week, a flick carries one more. The click / double-click that ends a grab
//   is swallowed (no 「新日程」 input).
//
// The offset is painted straight into the track's transform (no React render per frame); when it
// folds into a week the anchor moves through useUiStore and the layout effect paints the new rows
// and the new offset together.

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "@/hooks/useUiStore";
import { addDays, diffDays } from "@/lib/dates";
import { shiftWeek } from "./calendarNav";
import {
  easeOut,
  flickDirection,
  foldOffset,
  GRAB_SLOP_PX,
  isHorizontalWheel,
  isWheelNotch,
  NUDGE_MAX_EVENTS,
  NUDGE_MIN_PX,
  parseDurationMs,
  type Sample,
  snapTarget,
  WHEEL_IDLE_MS,
  wheelPixels,
} from "./weekScroll";

/** Token that times the slide (200ms; 0 under prefers-reduced-motion, styles.css). */
const SLIDE_TOKEN = "--duration-card";
/** Anchor changes in the first moments after the snapshot arrived (boot / hydrate) do not slide. */
const SETTLE_MS = 300;
/** A click / double-click this soon after a grab ended belongs to the grab. */
const GRAB_CLICK_MS = 500;
/** Presses here never grab the rows. */
const NO_GRAB =
  '[data-kind], [data-cal-input], [data-placeholder], button, a, input, textarea, select, [contenteditable="true"]';

/** Set on <html> while rows or an item are held: CalendarPage.module.css shows `grabbing`. */
export function setGrabCursor(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.calCursor = "grabbing";
  else delete root.dataset.calCursor;
}

function slideMs(): number {
  if (typeof window === "undefined") return 0;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
  return parseDurationMs(getComputedStyle(document.documentElement).getPropertyValue(SLIDE_TOKEN));
}

/** The scroller of the day list under `target` (the element ScrollFade scrolls), if any. */
export function dayListAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const items = target.closest("[data-date]")?.querySelector<HTMLElement>("[data-day-items]");
  const scroller = items?.parentElement ?? null;
  return scroller?.contains(target) ? scroller : null;
}

/** Whether `el` can still scroll in direction `dir` (1 = down, −1 = up). */
export function canScroll(el: HTMLElement, dir: number): boolean {
  if (dir > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  if (dir < 0) return el.scrollTop > 0;
  return false;
}

/** The press is on the scrollbar of the element it hit. */
function onScrollbar(t: Element, e: PointerEvent): boolean {
  if (!(t instanceof HTMLElement) || t.scrollHeight <= t.clientHeight) return false;
  const r = t.getBoundingClientRect();
  return e.clientX > r.left + t.clientLeft + t.clientWidth;
}

type Anim = {
  from: number;
  to: number;
  start: number;
  duration: number;
  raf: number;
  /** Finishes the slide if animation frames stall (WebKit pauses them for hidden windows). */
  timer: number;
};
type Gesture = { mode: "weeks" | "notch" | "list"; count: number; net: number; anchor: string };
type Press = {
  id: number;
  x: number;
  y: number;
  lastY: number;
  grabbing: boolean;
  samples: Sample[];
};

export type WeekScroll = {
  /** Wrapper of the rows + the 64px bottom gap: wheel and grab listen here. */
  gridRef: RefObject<HTMLDivElement | null>;
  /** Clip box of the visible rows. */
  viewportRef: RefObject<HTMLDivElement | null>;
  /** The N + 2 rows; its transform is the slide. */
  trackRef: RefObject<HTMLDivElement | null>;
};

/**
 * `anchor` / `weeks`: what is rendered (the track holds weeks + 2 rows starting a week before
 * `anchor`). `ready`: data is on screen (anchor changes before that never slide).
 */
export function useWeekScroll(anchor: string, weeks: number, ready: boolean): WeekScroll {
  const gridRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const anim = useRef<Anim | null>(null);
  /** The anchor this hook just asked for (a fold), so the layout effect does not slide it. */
  const expected = useRef<string | null>(null);
  const prev = useRef({ anchor, weeks });
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  const readyAt = useRef<number | null>(null);

  useEffect(() => {
    if (ready && readyAt.current === null) readyAt.current = performance.now();
  }, [ready]);

  const rowH = useCallback(() => {
    const vp = viewportRef.current;
    return vp ? vp.getBoundingClientRect().height / weeksRef.current : 0;
  }, []);

  /** Lift by one row (hides the upper buffer) + the offset, snapped to device pixels so text and
   *  the 1px lines stay crisp at rest. Before layout the CSS fallback (calc) applies. */
  const paint = useCallback(() => {
    const track = trackRef.current;
    const h = rowH();
    if (!track || !(h > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    const y = Math.round((offset.current - h) * dpr) / dpr;
    track.style.transform = `translate3d(0, ${y}px, 0)`;
  }, [rowH]);

  /**
   * Moves the rows to `v` (px). Following a gesture folds whole weeks into the anchor as they
   * pass half a row; a slide (`fold` false) stays within ±1 row, which the buffers cover, and only
   * folds when it lands, so the store's anchor is already the destination while the rows move
   * (rapid ↓↓ / key repeat add up, the title does not flicker).
   */
  const setOffset = useCallback(
    (v: number, fold = true) => {
      if (!fold) {
        offset.current = v;
        paint();
        return;
      }
      const h = rowH();
      const { offset: rest, weeks: shift } = foldOffset(v, h);
      offset.current = rest;
      if (shift === 0) {
        paint();
        return;
      }
      const ui = useUiStore.getState();
      const next = addDays(ui.calendarAnchor, shift * 7);
      expected.current = next;
      // The layout effect paints the new rows and the new offset in the same frame.
      ui.setCalendarAnchor(next);
    },
    [paint, rowH],
  );

  const cancelAnim = useCallback(() => {
    const a = anim.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    window.clearTimeout(a.timer);
    anim.current = null;
  }, []);

  const animateTo = useCallback(
    (target: number) => {
      cancelAnim();
      const duration = slideMs();
      if (duration <= 0) {
        setOffset(target);
        return;
      }
      const a: Anim = {
        from: offset.current,
        to: target,
        start: performance.now(),
        duration,
        raf: 0,
        timer: 0,
      };
      anim.current = a;
      const step = (now: number) => {
        if (anim.current !== a) return;
        const p = Math.min(1, Math.max(0, (now - a.start) / a.duration));
        if (p >= 1) {
          anim.current = null;
          window.clearTimeout(a.timer);
        }
        setOffset(a.from + (a.to - a.from) * easeOut(p), p >= 1);
        if (anim.current === a) a.raf = requestAnimationFrame(step);
      };
      a.raf = requestAnimationFrame(step);
      a.timer = window.setTimeout(() => {
        if (anim.current !== a) return;
        cancelAnimationFrame(a.raf);
        anim.current = null;
        setOffset(a.to);
      }, duration + 150);
    },
    [cancelAnim, setOffset],
  );

  /** Snap to the nearest week (+ one in the flick's direction). */
  const settle = useCallback(
    (flick: -1 | 0 | 1) => animateTo(snapTarget(offset.current, rowH(), flick)),
    [animateTo, rowH],
  );

  // Anchor / weeks changes: our own folds just paint; anything else slides in from where it was.
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = { anchor, weeks };
    if (before.weeks !== weeks) {
      cancelAnim();
      expected.current = null;
      offset.current = 0;
      paint();
      return;
    }
    if (before.anchor === anchor) {
      paint();
      return;
    }
    if (expected.current === anchor) {
      expected.current = null;
      paint();
      return;
    }
    expected.current = null;
    const h = rowH();
    const settled = readyAt.current !== null && performance.now() - readyAt.current > SETTLE_MS;
    cancelAnim();
    if (!settled || !(h > 0)) {
      offset.current = 0;
      paint();
      return;
    }
    // The old first row stays where it was, then everything slides home (at most one row away:
    // a longer jump shows the last row of the way, never a blank).
    const weeksLater = diffDays(before.anchor, anchor) / 7;
    offset.current = Math.max(-h, Math.min(h, offset.current + weeksLater * h));
    paint();
    animateTo(0);
  }, [anchor, weeks, animateTo, cancelAnim, paint, rowH]);

  // Never leave an animation frame running after unmount.
  useEffect(() => cancelAnim, [cancelAnim]);

  // The viewport clips; focus or find-in-page must never scroll it. A resize changes the row
  // height, so the lift is painted again.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const reset = () => {
      if (vp.scrollTop !== 0) vp.scrollTop = 0;
    };
    vp.addEventListener("scroll", reset);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => paint());
    ro?.observe(vp);
    return () => {
      vp.removeEventListener("scroll", reset);
      ro?.disconnect();
    };
  }, [paint]);

  // Wheel / trackpad.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let g: Gesture | null = null;
    let idle = 0;

    const end = () => {
      idle = 0;
      const cur = g;
      g = null;
      if (cur?.mode !== "weeks") return;
      let flick: -1 | 0 | 1 = 0;
      // A tiny gesture (a WebKit mouse notch is one ~4px event) that did not reach the next week
      // still pages one week in its direction.
      if (
        cur.count <= NUDGE_MAX_EVENTS &&
        Math.abs(cur.net) >= NUDGE_MIN_PX &&
        useUiStore.getState().calendarAnchor === cur.anchor &&
        snapTarget(offset.current, rowH(), 0) === 0
      ) {
        flick = cur.net > 0 ? 1 : -1;
      }
      settle(flick);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || isHorizontalWheel(e)) return; // pinch-zoom / sideways: not ours
      if (!g) {
        const dir = Math.sign(e.deltaY);
        const list = dayListAt(e.target);
        const mode = list && canScroll(list, dir) ? "list" : isWheelNotch(e) ? "notch" : "weeks";
        g = { mode, count: 0, net: 0, anchor: useUiStore.getState().calendarAnchor };
        // An open 「新日程」 input saves (blur) before its row can slide out of the DOM.
        const active = document.activeElement;
        if (
          mode !== "list" &&
          active instanceof HTMLElement &&
          active.closest("[data-cal-input]")
        ) {
          active.blur();
        }
      }
      window.clearTimeout(idle);
      idle = window.setTimeout(end, WHEEL_IDLE_MS);
      g.count++;
      if (g.mode === "list") return; // the day list scrolls natively
      e.preventDefault();
      if (g.mode === "notch") {
        if (isWheelNotch(e)) shiftWeek(Math.sign(e.deltaY));
        return;
      }
      cancelAnim();
      const px = wheelPixels(e, viewportRef.current?.clientHeight ?? 0);
      g.net -= px;
      setOffset(offset.current - px);
    };

    grid.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      grid.removeEventListener("wheel", onWheel);
      window.clearTimeout(idle);
    };
  }, [cancelAnim, rowH, setOffset, settle]);

  // Grab-drag on empty space.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let p: Press | null = null;
    let lastGrabEnd = Number.NEGATIVE_INFINITY;

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (p?.grabbing) {
        setGrabCursor(false);
        try {
          grid.releasePointerCapture(p.id);
        } catch {
          // already released
        }
      }
      p = null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary || p) return;
      if (useUiStore.getState().dragging) return;
      const t = e.target;
      if (!(t instanceof Element) || t.closest(NO_GRAB) || onScrollbar(t, e)) return;
      p = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lastY: e.clientY,
        grabbing: false,
        samples: [],
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

    const onMove = (e: PointerEvent) => {
      if (!p || e.pointerId !== p.id) return;
      if (!p.grabbing) {
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (Math.abs(dx) >= GRAB_SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
          stop(); // a sideways press is not a week grab
          return;
        }
        if (Math.abs(dy) < GRAB_SLOP_PX) return;
        if (useUiStore.getState().dragging) {
          stop();
          return;
        }
        p.grabbing = true;
        cancelAnim();
        try {
          grid.setPointerCapture(p.id);
        } catch {
          // synthetic / already gone: window listeners still follow it
        }
        setGrabCursor(true);
        window.getSelection()?.removeAllRanges();
      }
      e.preventDefault();
      setOffset(offset.current + (e.clientY - p.lastY));
      p.lastY = e.clientY;
      p.samples.push({ t: e.timeStamp, y: e.clientY });
      if (p.samples.length > 24) p.samples.shift();
    };

    const finish = (e: PointerEvent, flickable: boolean) => {
      if (!p || e.pointerId !== p.id) return;
      const grabbed = p.grabbing;
      const samples = p.samples;
      stop();
      if (!grabbed) return;
      lastGrabEnd = performance.now();
      settle(flickable ? flickDirection(samples, e.timeStamp) : 0);
    };
    const onUp = (e: PointerEvent) => finish(e, true);
    const onCancel = (e: PointerEvent) => finish(e, false);

    // The click / double-click that ends a grab is not a click on the calendar.
    const swallow = (e: Event) => {
      if (performance.now() - lastGrabEnd < GRAB_CLICK_MS) e.stopPropagation();
    };

    grid.addEventListener("pointerdown", onDown);
    grid.addEventListener("click", swallow, true);
    grid.addEventListener("dblclick", swallow, true);
    return () => {
      grid.removeEventListener("pointerdown", onDown);
      grid.removeEventListener("click", swallow, true);
      grid.removeEventListener("dblclick", swallow, true);
      stop();
    };
  }, [cancelAnim, setOffset, settle]);

  return { gridRef, viewportRef, trackRef };
}
