import { describe, expect, it } from "vitest";
import {
  COMMIT_FRACTION,
  FLICK_PX_PER_MS,
  fingerSign,
  isNotch,
  looksLikeMomentum,
  OVERDRAG_PX,
  releaseSide,
  rubberBand,
  rubberSlope,
  type Sample,
  springAtRest,
  stepSpring,
  stillCoasting,
  unRubberBand,
  VELOCITY_WINDOW_MS,
  velocity,
  wheelPx,
} from "./pageSwipe";

/** Events 16 ms apart with these finger deltas. */
const samples = (dxs: number[], t0 = 0): Sample[] => dxs.map((dx, i) => ({ t: t0 + i * 16, dx }));

describe("reading the wheel", () => {
  it("line / page deltas become px", () => {
    expect(wheelPx(3, 0, 800)).toBe(3);
    expect(wheelPx(2, 1, 800)).toBe(32);
    expect(wheelPx(1, 2, 800)).toBe(800);
  });

  it("follows the fingers: natural scrolling (or unknown) inverts deltaX", () => {
    expect(fingerSign({ deltaMode: 0, deltaX: 5, deltaY: 0 })).toBe(-1);
    expect(
      fingerSign({ deltaMode: 0, deltaX: 5, deltaY: 0, webkitDirectionInvertedFromDevice: true }),
    ).toBe(-1);
    expect(
      fingerSign({ deltaMode: 0, deltaX: 5, deltaY: 0, webkitDirectionInvertedFromDevice: false }),
    ).toBe(1);
  });

  it("a sideways mouse-wheel notch: line mode or a big pixel delta", () => {
    expect(isNotch(1, 3)).toBe(true);
    expect(isNotch(0, 100)).toBe(true);
    expect(isNotch(0, 12)).toBe(false);
  });
});

describe("velocity", () => {
  it("travel over the recent window (px/ms)", () => {
    // 4 events of 8 px, 16 ms apart: 24 px after the first over 48 ms.
    expect(velocity(samples([8, 8, 8, 8]), 48)).toBeCloseTo(0.5);
  });

  it("is 0 once the last event is older than the window (the fingers rested)", () => {
    expect(velocity(samples([8, 8, 8, 8]), 48 + VELOCITY_WINDOW_MS + 1)).toBe(0);
  });
});

describe("looksLikeMomentum", () => {
  it("shrinking smoothly after a fast move: the fingers lifted", () => {
    expect(looksLikeMomentum(samples([4, 12, 20, 18, 16.2, 14.6, 13.1]))).toBe(true);
  });

  it("not while speeding up or holding speed", () => {
    expect(looksLikeMomentum(samples([4, 8, 12, 16, 20, 24]))).toBe(false);
    expect(looksLikeMomentum(samples([12, 12, 12, 12, 12, 12]))).toBe(false);
  });

  it("not after a slow drag, a sudden stop or a turn", () => {
    expect(looksLikeMomentum(samples([5, 4.5, 4, 3.5, 3, 2.5]))).toBe(false);
    expect(looksLikeMomentum(samples([20, 18, 16, 14, 2]))).toBe(false);
    expect(looksLikeMomentum(samples([20, 18, 16, -14, -12]))).toBe(false);
  });
});

describe("stillCoasting (after a momentum release)", () => {
  it("momentum keeps shrinking the same way; its tiny tail and zero deltas still count", () => {
    expect(stillCoasting(20, 18.5)).toBe(true);
    expect(stillCoasting(20, 20.4)).toBe(true);
    expect(stillCoasting(3, 1.5)).toBe(true);
    expect(stillCoasting(3, 0)).toBe(true);
  });

  it("a delta that grows or turns is the fingers: the pages follow again", () => {
    expect(stillCoasting(10, 14)).toBe(false);
    expect(stillCoasting(10, -6)).toBe(false);
  });
});

describe("releaseSide", () => {
  const span = 1000;

  it("past COMMIT_FRACTION goes to the other page on that side", () => {
    expect(releaseSide(-span * COMMIT_FRACTION - 1, 0, span)).toBe(-1);
    expect(releaseSide(span * COMMIT_FRACTION + 1, 0, span)).toBe(1);
    expect(releaseSide(span * COMMIT_FRACTION - 1, 0, span)).toBe(0);
  });

  it("a flick goes on from a short distance; a flick back always returns", () => {
    expect(releaseSide(-40, -FLICK_PX_PER_MS, span)).toBe(-1);
    expect(releaseSide(-8, -FLICK_PX_PER_MS * 2, span)).toBe(0); // a twitch
    expect(releaseSide(-600, FLICK_PX_PER_MS, span)).toBe(0);
  });

  it("nothing to decide at rest", () => {
    expect(releaseSide(0, 2, span)).toBe(0);
    expect(releaseSide(-500, 0, 0)).toBe(0);
  });
});

describe("rubberBand", () => {
  it("1:1 towards the other page, up to a whole page; past it gives way, never more than OVERDRAG_PX", () => {
    // Calendar → tasks: tasks is on the right (side −1), the pages move left.
    expect(rubberBand(-700, -1, 1000)).toBe(-700);
    expect(rubberBand(-1010, -1, 1000)).toBeCloseTo(-1005.4, 0);
    expect(rubberBand(-1200, -1, 1000)).toBeLessThan(-1030);
    expect(rubberBand(-5000, -1, 1000)).toBeGreaterThan(-1000 - OVERDRAG_PX);
  });

  it("towards the empty side (nothing left of the calendar, nothing right of tasks) it only gives way", () => {
    expect(rubberBand(10, -1, 1000)).toBeCloseTo(5.4, 0);
    expect(rubberBand(5000, -1, 1000)).toBeLessThan(OVERDRAG_PX);
    expect(rubberBand(-5000, 1, 1000)).toBeGreaterThan(-OVERDRAG_PX);
    expect(rubberBand(700, 1, 1000)).toBe(700);
  });

  it("taking the pages back past an end goes on from where they are (no jump to the middle)", () => {
    for (const shown of [5, 30, 55, -1030, -1050]) {
      const pull = unRubberBand(shown, -1, 1000);
      expect(rubberBand(pull, -1, 1000)).toBeCloseTo(shown, 6);
    }
    expect(unRubberBand(-700, -1, 1000)).toBe(-700);
    // Even pushed past the limit (a spring overshoot) it stays finite.
    expect(Number.isFinite(unRubberBand(80, -1, 1000))).toBe(true);
  });

  it("past an end the pages move slower than the pull, and slower the further out", () => {
    expect(rubberSlope(-500, -1, 1000)).toBe(1);
    expect(rubberSlope(1, -1, 1000)).toBeCloseTo(0.55, 1);
    expect(rubberSlope(400, -1, 1000)).toBeLessThan(0.05);
    // The slope is the derivative of rubberBand.
    const d = (rubberBand(201, -1, 1000) - rubberBand(199, -1, 1000)) / 2;
    expect(rubberSlope(200, -1, 1000)).toBeCloseTo(d, 4);
  });
});

describe("spring", () => {
  const settle = (x0: number, v0: number, target: number) => {
    let x = x0;
    let v = v0;
    let ms = 0;
    let peak = 0;
    while (!springAtRest(x, v, target) && ms < 3000) {
      ({ x, v } = stepSpring(x, v, target, 16));
      ms += 16;
      peak = Math.max(peak, (x - x0) / (target - x0));
    }
    return { ms, peak };
  };

  it("lands a page from rest in well under half a second, with no visible bounce", () => {
    const { ms, peak } = settle(0, 0, -1300);
    expect(ms).toBeLessThan(500);
    expect(peak).toBeLessThan(1.005);
  });

  it("carries a fling without overshooting by more than a few px", () => {
    const { ms, peak } = settle(-300, -6000, -1300);
    expect(ms).toBeLessThan(500);
    expect((peak - 1) * 1000).toBeLessThan(5);
  });

  it("starts at the speed it is given (no jump in velocity)", () => {
    const { v } = stepSpring(-300, -2000, -1300, 1);
    expect(v).toBeLessThan(-1990);
  });
});
