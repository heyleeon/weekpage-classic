// Week scrolling mechanics of the calendar grid (pure, no DOM): how a wheel event is read, how the
// sliding offset folds into whole weeks, where a release snaps to, and the slide easing.
//
// Model: the grid renders one buffer week above and one below the N visible rows. `offset` is how
// far (px) the rows are pushed DOWN from rest: > 0 shows part of the earlier buffer week, < 0 part
// of the later one. Whenever |offset| passes half a row the anchor moves one week and the offset
// jumps by a row the other way, so the buffers always cover what is visible.

import { addDays } from "@/lib/dates";

/** Mondays of the rendered rows: one buffer week before `anchor`, `weeks` visible, one after. */
export function renderedWeeks(anchor: string, weeks: number): string[] {
  return Array.from({ length: weeks + 2 }, (_, i) => addDays(anchor, (i - 1) * 7));
}

/** A gesture ends (and snaps) this long after its last wheel event. */
export const WHEEL_IDLE_MS = 120;
/** A pixel-mode wheel event at least this large is a mouse-wheel notch (Chromium / WebView2: 100). */
export const NOTCH_PX = 50;
/** DOM_DELTA_LINE → px, for the rare line-mode event that is followed continuously. */
export const LINE_PX = 16;
/** A press on empty space becomes a grab after this much vertical movement. */
export const GRAB_SLOP_PX = 4;
/** Release speed (px/ms) that carries one extra week in the flick's direction. */
export const FLICK_PX_PER_MS = 0.5;
/** Velocity is measured over the last this-many ms of pointer samples. */
export const FLICK_WINDOW_MS = 100;
/** A wheel gesture this short (events) that moved less than half a row still pages one week:
 *  WebKit reports a slow mouse-wheel notch as a single ~4px event. */
export const NUDGE_MAX_EVENTS = 3;
export const NUDGE_MIN_PX = 2;

export type WheelLike = { deltaMode: number; deltaX: number; deltaY: number };

/** Horizontal-dominant (or no vertical part): the calendar ignores it. */
export function isHorizontalWheel(e: WheelLike): boolean {
  return e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY);
}

/** A discrete mouse-wheel notch: line / page mode, or a large pixel delta. */
export function isWheelNotch(e: WheelLike): boolean {
  return e.deltaMode !== 0 || Math.abs(e.deltaY) >= NOTCH_PX;
}

/** Wheel delta in px (line / page mode converted). */
export function wheelPixels(e: WheelLike, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_PX;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  return e.deltaY;
}

/**
 * Folds `offset` into (−rowH/2, rowH/2]: `weeks` is how many weeks the anchor moves (negative =
 * earlier) and `offset` the remainder. rowH ≤ 0 (not laid out) → no movement.
 */
export function foldOffset(offset: number, rowH: number): { offset: number; weeks: number } {
  if (!(rowH > 0) || !Number.isFinite(offset)) return { offset: 0, weeks: 0 };
  const weeks = -Math.round(offset / rowH) || 0; // never −0
  let rest = offset + weeks * rowH;
  // Math.round(0.5) = 1 keeps exactly half a row on the earlier side; normalise to (−h/2, h/2].
  if (rest <= -rowH / 2) return { offset: rest + rowH, weeks: weeks + 1 };
  if (rest > rowH / 2) rest -= rowH;
  return { offset: rest, weeks };
}

/**
 * Where a release snaps: the nearest week, plus one more in the flick's direction (1 = rows move
 * down = an earlier week, −1 = a later week). Never further than one row from rest, which is
 * what the buffer weeks can show.
 */
export function snapTarget(offset: number, rowH: number, flick: -1 | 0 | 1): number {
  if (!(rowH > 0)) return 0;
  const nearest = Math.round(offset / rowH);
  const weeks = Math.max(-1, Math.min(1, nearest + flick));
  return weeks * rowH;
}

export type Sample = { t: number; y: number };

/** Flick direction from the last pointer samples (1 = moving down, −1 = up, 0 = not a flick). */
export function flickDirection(samples: Sample[], now: number): -1 | 0 | 1 {
  const recent = samples.filter((s) => now - s.t <= FLICK_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  const v = (last.y - first.y) / dt;
  if (Math.abs(v) < FLICK_PX_PER_MS) return 0;
  return v > 0 ? 1 : -1;
}

/** "120ms" / "0.2s" / "" → ms (unparseable or empty = 0, i.e. no animation). */
export function parseDurationMs(value: string): number {
  const v = value.trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
}

/** CSS `ease-out` = cubic-bezier(0, 0, 0.58, 1), progress p ∈ [0, 1] → eased value. */
export function easeOut(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  // x(s) = 3(1−s)s²·0.58 + s³ (x1 = 0), y(s) = 3(1−s)s² + s³ (y1 = 0, y2 = 1). Solve x(s) = p.
  // x(s) is monotonic on [0, 1]: bisection is plenty for a 200 ms slide.
  const x = (s: number) => 3 * (1 - s) * s * s * 0.58 + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (x(mid) < p) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * s * s + s * s * s;
}
