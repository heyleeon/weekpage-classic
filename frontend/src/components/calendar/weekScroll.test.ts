// Week scrolling math (pure): wheel reading, folding the slide into weeks, snap / flick, easing.

import { describe, expect, it } from "vitest";
import {
  easeOut,
  flickDirection,
  foldOffset,
  isHorizontalWheel,
  isWheelNotch,
  parseDurationMs,
  renderedWeeks,
  snapTarget,
  wheelPixels,
} from "./weekScroll";

const H = 200;

describe("weekScroll", () => {
  it("renderedWeeks: a buffer week before and after the visible ones", () => {
    expect(renderedWeeks("2026-09-28", 3)).toEqual([
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
    expect(renderedWeeks("2026-09-28", 2)).toHaveLength(4);
  });

  it("wheel reading: notch vs pixels, horizontal, line / page modes", () => {
    expect(isWheelNotch({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 0, deltaX: 0, deltaY: -50 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 0, deltaX: 0, deltaY: 12 })).toBe(false);
    expect(isWheelNotch({ deltaMode: 1, deltaX: 0, deltaY: 1 })).toBe(true);
    expect(isHorizontalWheel({ deltaMode: 0, deltaX: 30, deltaY: 10 })).toBe(true);
    expect(isHorizontalWheel({ deltaMode: 0, deltaX: 3, deltaY: 0 })).toBe(true);
    expect(isHorizontalWheel({ deltaMode: 0, deltaX: 3, deltaY: 10 })).toBe(false);
    expect(wheelPixels({ deltaMode: 1, deltaX: 0, deltaY: 3 }, 600)).toBe(48);
    expect(wheelPixels({ deltaMode: 2, deltaX: 0, deltaY: 1 }, 600)).toBe(600);
  });

  it("foldOffset keeps the remainder in (−h/2, h/2] and counts whole weeks", () => {
    expect(foldOffset(0, H)).toEqual({ offset: 0, weeks: 0 });
    expect(foldOffset(90, H)).toEqual({ offset: 90, weeks: 0 });
    expect(foldOffset(100, H)).toEqual({ offset: 100, weeks: 0 });
    expect(foldOffset(140, H)).toEqual({ offset: -60, weeks: -1 });
    expect(foldOffset(-100, H)).toEqual({ offset: 100, weeks: 1 });
    expect(foldOffset(-140, H)).toEqual({ offset: 60, weeks: 1 });
    expect(foldOffset(-650, H)).toEqual({ offset: -50, weeks: 3 });
    expect(foldOffset(50, 0)).toEqual({ offset: 0, weeks: 0 });
    expect(foldOffset(Number.NaN, H)).toEqual({ offset: 0, weeks: 0 });
  });

  it("snapTarget: nearest week, a flick adds one, never beyond one row", () => {
    expect(snapTarget(40, H, 0)).toBe(0);
    expect(snapTarget(-90, H, 0) === 0).toBe(true);
    expect(snapTarget(40, H, 1)).toBe(H);
    expect(snapTarget(-40, H, -1)).toBe(-H);
    expect(snapTarget(-40, H, 1)).toBe(H);
    expect(snapTarget(150, H, 1)).toBe(H);
    expect(snapTarget(10, 0, 1)).toBe(0);
  });

  it("flickDirection: speed over the last 100ms", () => {
    const fast = [
      { t: 0, y: 0 },
      { t: 20, y: 20 },
      { t: 40, y: 40 },
    ];
    expect(flickDirection(fast, 45)).toBe(1);
    expect(
      flickDirection(
        fast.map((s) => ({ ...s, y: -s.y })),
        45,
      ),
    ).toBe(-1);
    expect(flickDirection(fast, 400)).toBe(0); // held still before letting go
    expect(
      flickDirection(
        [
          { t: 0, y: 0 },
          { t: 80, y: 10 },
        ],
        90,
      ),
    ).toBe(0);
    expect(flickDirection([{ t: 0, y: 0 }], 5)).toBe(0);
  });

  it("parseDurationMs reads the motion tokens", () => {
    expect(parseDurationMs("200ms")).toBe(200);
    expect(parseDurationMs(" 0.25s")).toBe(250);
    expect(parseDurationMs("0ms")).toBe(0);
    expect(parseDurationMs("")).toBe(0);
  });

  it("easeOut matches CSS ease-out: 0 → 1, monotonic, fast start", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    let prev = 0;
    for (let p = 0.05; p < 1; p += 0.05) {
      const v = easeOut(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeOut(0.5)).toBeGreaterThan(0.6);
    expect(easeOut(0.5)).toBeCloseTo(0.684, 2);
  });
});
