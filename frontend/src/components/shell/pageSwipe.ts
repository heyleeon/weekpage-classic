// Page swipe mechanics (pure, no DOM): how a two-finger swipe is read, when the fingers have let
// go, when a release counts as "go", and the spring that carries the pages home. Tuned after the
// macOS three-finger Spaces swipe: the pages move further than the fingers, a short flick is
// enough, and the motion after the fingers lift continues at their speed.
//
// Model: the page being left (`base`) sits at `offset` px (> 0 = moved right) and the other page
// (`peer`) one span (stage width + PAGE_GAP) beside it, on its own side of the layout: the
// calendar left of tasks, like the toolbar's page switch. The two pages always move together, by
// translation only, and never wrap around.

/** Space between the two pages while they slide. */
export const PAGE_GAP = 40;
/** Page px per px of finger scroll (the trackpad is much narrower than the page). */
export const GAIN = 1.6;
/** A release past this share of a span goes to the other page whatever the speed. */
export const COMMIT_FRACTION = 0.25;
/** Release speed (page px/ms) that goes on (or back) whatever the distance. */
export const FLICK_PX_PER_MS = 0.3;
/** A flick forward needs at least this much travel (page px; a twitch is not a flick). */
export const FLICK_MIN_PX = 24;
/** Speed is measured over the last this-many ms of wheel events; older ones mean "still". */
export const VELOCITY_WINDOW_MS = 48;
/** The momentum after the fingers lift: this many shrinking events in a row… */
export const MOMENTUM_EVENTS = 4;
/** …after the gesture once moved at least this fast (finger px per event). */
export const MOMENTUM_MIN_PEAK_PX = 6;
/** Fingers that stop sending events this long have stopped (or lifted without momentum). */
export const PAUSE_RELEASE_MS = 60;
/** Momentum events come every frame: after a gap this long (event time) it is the fingers. */
export const COAST_GAP_MS = 40;
/** Past a whole page the drag gives way (a rubber band) and never goes further than this. */
export const OVERDRAG_PX = 56;
/** Without animation (reduced motion, no layout) this much finger travel switches at once. */
export const INSTANT_SWITCH_PX = 48;
/** A pixel-mode wheel event at least this large is a mouse-wheel notch (a sideways wheel). */
export const NOTCH_PX = 50;

/** ζ ≈ 0.96: the spring itself never overshoots; 90% of a page in ≈ 0.17 s, settled by
 *  ≈ 0.38 s. The only bounce is coming back from a drag past the page (OVERDRAG_PX). */
export const SPRING = { stiffness: 480, damping: 42 } as const;
/** The spring stops (snaps to the target) this close and this slow. */
export const REST_PX = 1;
export const REST_PX_PER_S = 40;
/** Release speed handed to the spring is capped (px/s). */
export const MAX_SPRING_PX_PER_S = 6000;

export type Sample = { t: number; dx: number };

export type WheelLike = {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  webkitDirectionInvertedFromDevice?: boolean;
};

/** Wheel delta in px (line / page mode converted; `page` = the stage's size on that axis). */
export function wheelPx(delta: number, deltaMode: number, page: number): number {
  if (deltaMode === 1) return delta * 16;
  if (deltaMode === 2) return delta * page;
  return delta;
}

/** +1 when deltaX already points the way the fingers moved, −1 when it is inverted (natural
 *  scrolling, the macOS default, or a browser that does not say: same rule as SwipeRow). */
export function fingerSign(e: WheelLike): 1 | -1 {
  return e.webkitDirectionInvertedFromDevice === false ? 1 : -1;
}

/** A discrete sideways notch (line / page mode, or a large pixel delta). */
export function isNotch(deltaMode: number, px: number): boolean {
  return deltaMode !== 0 || Math.abs(px) >= NOTCH_PX;
}

/** Finger speed (px/ms, signed) over the VELOCITY_WINDOW_MS before `now`; 0 when the last event
 *  is older than that. */
export function velocity(samples: readonly Sample[], now: number): number {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > VELOCITY_WINDOW_MS) return 0;
  const recent = samples.filter((s) => last.t - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const dt = last.t - recent[0].t;
  if (dt <= 0) return 0;
  // The first sample's travel happened before the window opened.
  const travel = recent.slice(1).reduce((sum, s) => sum + s.dx, 0);
  return travel / dt;
}

/**
 * Whether the fingers have lifted: the browser keeps sending the system's momentum as wheel events
 * that shrink smoothly, all one way. MOMENTUM_EVENTS shrinking events in a row after a fast enough
 * gesture are taken as that, so the spring takes over at the lift-off speed instead of after the
 * whole momentum has trickled in. A wrong guess (fingers slowing down) is caught by stillCoasting.
 */
export function looksLikeMomentum(samples: readonly Sample[]): boolean {
  if (samples.length < MOMENTUM_EVENTS + 1) return false;
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s.dx)), 0);
  if (peak < MOMENTUM_MIN_PEAK_PX) return false;
  const tail = samples.slice(-(MOMENTUM_EVENTS + 1));
  const sign = Math.sign(tail[0].dx);
  if (sign === 0) return false;
  for (let i = 1; i < tail.length; i++) {
    if (Math.sign(tail[i].dx) !== sign) return false;
    const r = Math.abs(tail[i].dx) / Math.abs(tail[i - 1].dx);
    // Shrinking, but not a sudden stop (that is the fingers, not momentum).
    if (!(r >= 0.5 && r < 1)) return false;
  }
  return true;
}

/** After a momentum release: the next delta is still momentum (same way, not growing). Tiny or
 *  zero deltas at the end of the momentum count as momentum. */
export function stillCoasting(prev: number, dx: number): boolean {
  if (Math.abs(dx) < 2) return true;
  if (Math.sign(dx) !== Math.sign(prev)) return false;
  return Math.abs(dx) <= Math.abs(prev) * 1.05 + 0.5;
}

/**
 * Where a release goes: the side the base moved away from (±1 = the other page) or 0 (back). `v`
 * in page px/ms. A flick decides by its direction; otherwise the distance does.
 */
export function releaseSide(offset: number, v: number, span: number): -1 | 0 | 1 {
  const side = offset > 0 ? 1 : offset < 0 ? -1 : 0;
  if (side === 0 || !(span > 0)) return 0;
  const along = v * side;
  if (along <= -FLICK_PX_PER_MS) return 0;
  if (along >= FLICK_PX_PER_MS && Math.abs(offset) >= FLICK_MIN_PX) return side;
  return Math.abs(offset) >= span * COMMIT_FRACTION ? side : 0;
}

/** Past an end the page moves this much per px of pull at first, less and less after. */
const BAND = 0.55;

/** How far `d` px of pull past an end goes: about half at first, never more than OVERDRAG_PX. */
function give(d: number): number {
  return OVERDRAG_PX * (1 - 1 / ((BAND * d) / OVERDRAG_PX + 1));
}

/** The pull that gives way `y` px (give's inverse). */
function pullFor(y: number): number {
  const r = Math.min(y / OVERDRAG_PX, 0.99);
  return (OVERDRAG_PX * r) / (BAND * (1 - r));
}

/** Page px per px of pull, `d` px past an end. */
function giveSlope(d: number): number {
  const q = (BAND * d) / OVERDRAG_PX + 1;
  return BAND / (q * q);
}

/**
 * The pages travel between 0 (the base in the middle) and `side × span` (the peer in the middle;
 * `side` −1 = the peer is right of the base). Past either end they give way: towards the empty
 * side there is no page to come (nothing is left of the calendar or right of tasks), past the
 * peer it is already in.
 */
export function rubberBand(offset: number, side: -1 | 1, span: number): number {
  if (!(span > 0)) return offset;
  const lo = Math.min(0, side * span);
  const hi = Math.max(0, side * span);
  if (offset < lo) return lo - give(lo - offset);
  if (offset > hi) return hi + give(offset - hi);
  return offset;
}

/**
 * The pull rubberBand shows at `shown` (its inverse). Fingers that take the pages back while they
 * spring home from past an end go on from where the pages are; feeding the shown offset back in as
 * pull would give way a second time and jump them towards the middle.
 */
export function unRubberBand(shown: number, side: -1 | 1, span: number): number {
  if (!(span > 0)) return shown;
  const lo = Math.min(0, side * span);
  const hi = Math.max(0, side * span);
  if (shown < lo) return lo - pullFor(lo - shown);
  if (shown > hi) return hi + pullFor(shown - hi);
  return shown;
}

/**
 * Page px per px of pull at `pull`: 1 between the ends, less and less past them. The release hands
 * the spring the pages' speed on screen (finger speed × this): past an end the fingers move far
 * faster than the pages, and their speed would fling the pages out before they come back.
 */
export function rubberSlope(pull: number, side: -1 | 1, span: number): number {
  if (!(span > 0)) return 1;
  const lo = Math.min(0, side * span);
  const hi = Math.max(0, side * span);
  if (pull < lo) return giveSlope(lo - pull);
  if (pull > hi) return giveSlope(pull - hi);
  return 1;
}

/** One frame of the damped spring (x px, v px/s) toward `target`, in 2 ms sub-steps. */
export function stepSpring(
  x: number,
  v: number,
  target: number,
  dtMs: number,
): { x: number; v: number } {
  const n = Math.max(1, Math.ceil(dtMs / 2));
  const h = dtMs / 1000 / n;
  let pos = x;
  let vel = v;
  for (let i = 0; i < n; i++) {
    const a = -SPRING.stiffness * (pos - target) - SPRING.damping * vel;
    vel += a * h;
    pos += vel * h;
  }
  return { x: pos, v: vel };
}

export function springAtRest(x: number, v: number, target: number): boolean {
  return Math.abs(x - target) < REST_PX && Math.abs(v) < REST_PX_PER_S;
}
