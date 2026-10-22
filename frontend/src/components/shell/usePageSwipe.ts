// Calendar ↔ tasks page motion (ui-spec §1.3「左右滑动换页」; math in ./pageSwipe.ts).
//
// - The two pages live side by side like macOS Spaces, the calendar on the left and tasks on the
//   right (the toolbar's page switch reads the same way). Both stay mounted (the one not shown is
//   parked off-screen on its side, clipped and inert), so a swipe never mounts anything and a page
//   comes back as it was left. The other page is mounted shortly after the first snapshot, as a
//   transition; the archive page is mounted only while it is shown.
// - Two-finger sideways swipe on the page area: the pages follow the fingers (GAIN). On the
//   calendar, fingers moving left bring tasks in from the right; on tasks, fingers moving right
//   bring the calendar in from the left. The other way there is nothing: the page gives way a
//   little (rubberBand) and springs back; the pages never wrap around. The release hands them to a
//   spring at the release speed: a flick or more than COMMIT_FRACTION of the way goes over, else
//   back. The page switches (title, toolbar) the moment the release decides.
// - Release = the fingers lift. Nothing happens while they are down, however long they rest.
//   Wheel events cannot show the lift (WebKit keeps the zero-delta phase events from the page);
//   on macOS Rust reports it (lib/trackpad.ts). Without that report (Windows, the browser
//   preview) the lift is guessed: the system's momentum starts (looksLikeMomentum) or the fingers
//   stop for PAUSE_RELEASE_MS. The rest of the momentum is swallowed, so it never swipes a row or
//   the page that came in; fingers on the trackpad again (or, guessing, a delta that is not
//   momentum after all) take the pages back from the spring where they are.
// - Clicking 日历 / 任务, mod+1 / mod+2, the today pill: the same spring, tasks always coming in
//   from the right of the calendar. The archive page never slides.
// - The gesture is the page's only when it starts on plain page space: a swipe row
//   ([data-swipe-row]), a text field or anything that scrolls sideways keeps it; a gesture that
//   locks vertical (SWIPE_LOCK, same rule as SwipeRow) goes on to the calendar / lists. Never with
//   an overlay, popover or drag on top.
// - Reduced motion, no layout, or the first moments after the snapshot (boot / hydrate): no
//   animation, a swipe of INSTANT_SWITCH_PX switches at once (on the lift, when it is reported).
//
// Positions are written straight into the slots' inline transforms once per frame; React renders
// nothing while the pages move. While they move, a shield over the stage takes clicks and the
// wheel ([data-moving]). The live page at rest has no transform at all, so fixed drag overlays and
// backdrop filters inside it behave as before.

import {
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { closeOpenSwipeRow, SWIPE_IDLE_MS, SWIPE_LOCK } from "@/components/ui/SwipeRow";
import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { onTrackpadChange, trackpadTouching } from "@/lib/trackpad";
import type { Page } from "@/types/domain";
import {
  COAST_GAP_MS,
  fingerSign,
  GAIN,
  INSTANT_SWITCH_PX,
  isNotch,
  looksLikeMomentum,
  MAX_SPRING_PX_PER_S,
  PAGE_GAP,
  PAUSE_RELEASE_MS,
  releaseSide,
  rubberBand,
  rubberSlope,
  type Sample,
  springAtRest,
  stepSpring,
  stillCoasting,
  unRubberBand,
  velocity,
  wheelPx,
} from "./pageSwipe";

/** Page switches in the first moments after the snapshot arrived (boot / hydrate) do not slide. */
const SETTLE_MS = 300;
/** The page not shown is mounted this long after the first snapshot. */
const WARM_MS = 600;
/** A frame longer than this is integrated as this long (a stall must not fling the pages). */
const MAX_FRAME_MS = 64;
/** No animation frame for this long (WebKit pauses them for hidden windows): finish at once. */
const WATCHDOG_MS = 400;
/** Gesture starts here belong to someone else. */
const NOT_OURS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-swipe-row]';
/** Slot order in the DOM never changes (a moved node would lose its scroll positions). */
const ORDER: readonly Page[] = ["calendar", "tasks", "archive"];

type PairPage = "calendar" | "tasks";
type Motion = {
  /** The page at `offset` and the one beside it; null at rest. */
  base: PairPage | null;
  peer: PairPage | null;
  offset: number;
  /** Side the peer sits on (+1 = left of the base, the base moved right). */
  side: -1 | 0 | 1;
  moving: boolean;
};
type Run = { v: number; last: number; raf: number; watchdog: number };
type Gesture = {
  /**
   * pending: no axis yet · track: the pages follow · coast: released by momentum, swallow it ·
   * paused: released by a pause, the fingers may go on · other: not ours
   */
  mode: "pending" | "track" | "coast" | "paused" | "other";
  ax: number;
  ay: number;
  /** Finger travel along x since tracking (re)started (px, + = right). */
  raw: number;
  /** Pull (rubberBand's input) when tracking (re)started. */
  start: number;
  events: number;
  notch: boolean;
  instant: boolean;
  samples: Sample[];
  /** Last finger delta (coast: is the next one still momentum?). */
  lastDx: number;
};

const isPair = (p: Page): p is PairPage => p === "calendar" || p === "tasks";
const other = (p: PairPage): PairPage => (p === "calendar" ? "tasks" : "calendar");
/** Spatial order of the page switch: tasks is right of the calendar (its peer side is −1). */
const sideOf = (peer: PairPage): -1 | 1 => (peer === "tasks" ? -1 : 1);

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** When the event happened (ms, performance.now() clock): event time, not handling time, so a
 *  busy frame does not look like a pause between wheel events. */
function eventTime(e: Event): number {
  const now = performance.now();
  const t = e.timeStamp;
  return t > 0 && t <= now + 1 && now - t < 1000 ? t : now;
}

/** The target or an ancestor below `stage` can still scroll sideways. */
function scrollsSideways(target: Element, stage: HTMLElement): boolean {
  for (let el: Element | null = target; el && el !== stage; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === "auto" || ox === "scroll") return true;
  }
  return false;
}

export type PageStage = {
  stageRef: RefObject<HTMLDivElement | null>;
  /** Mounted pages in DOM order: the live one, the parked pair page once warm. */
  pages: Page[];
  slotRef: (page: Page) => (el: HTMLDivElement | null) => void;
};

export function usePageSwipe(page: Page): PageStage {
  const stageRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<Page, HTMLDivElement>());
  /** The transform last written to each slot. */
  const written = useRef(new WeakMap<HTMLElement, string>());
  const slotRefs = useRef(new Map<Page, (el: HTMLDivElement | null) => void>());
  const [warm, setWarm] = useState<ReadonlySet<Page>>(() => new Set(isPair(page) ? [page] : []));
  const motion = useRef<Motion>({ base: null, peer: null, offset: 0, side: 0, moving: false });
  const run = useRef<Run | null>(null);
  const frame = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const readyAt = useRef<number | null>(null);
  const shown = useRef(page);

  const hasSnap = useDataStore((s) => s.snap !== null);
  useEffect(() => {
    if (!hasSnap) return;
    if (readyAt.current === null) readyAt.current = performance.now();
    const t = window.setTimeout(
      () => startTransition(() => setWarm(new Set<Page>(["calendar", "tasks"]))),
      WARM_MS,
    );
    return () => window.clearTimeout(t);
  }, [hasSnap]);

  const span = useCallback(() => (stageRef.current?.clientWidth ?? 0) + PAGE_GAP, []);

  const canAnimate = useCallback(
    () =>
      !reducedMotion() &&
      (stageRef.current?.clientWidth ?? 0) > 0 &&
      readyAt.current !== null &&
      performance.now() - readyAt.current > SETTLE_MS,
    [],
  );

  /**
   * Writes every slot's place: the moving pair, the live page (no transform), the parked rest.
   * Only what changed is written, so a frame never restyles a page that did not move.
   */
  const paint = useCallback(() => {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    const m = motion.current;
    const stage = stageRef.current;
    if (stage && m.moving !== (stage.dataset.moving !== undefined)) {
      if (m.moving) stage.dataset.moving = "true";
      else delete stage.dataset.moving;
    }
    const live = useUiStore.getState().page;
    const w = span();
    for (const [p, el] of slots.current) {
      let x: number | null;
      if (m.moving && p === m.base) x = m.offset;
      else if (m.moving && p === m.peer) x = m.offset - (m.side || -1) * w;
      else x = p === live ? null : p === "calendar" ? -w : w; // parked on its own side
      const t = x === null ? "" : `translate3d(${x}px, 0, 0)`;
      if (written.current.get(el) !== t) {
        el.style.transform = t;
        written.current.set(el, t);
      }
    }
  }, [span]);

  /** Following the fingers: one write per frame however many wheel events arrive. */
  const paintSoon = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => paint());
  }, [paint]);

  /** Focus inside a page that is being left goes (an open input saves on blur). */
  const releaseFocus = useCallback((p: Page | null) => {
    const el = p ? slots.current.get(p) : undefined;
    const active = document.activeElement;
    if (el && active instanceof HTMLElement && el.contains(active)) active.blur();
  }, []);

  const stopRun = useCallback(() => {
    const r = run.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    window.clearTimeout(r.watchdog);
    run.current = null;
  }, []);

  /** Where the spring heads: the live page in the middle. */
  const target = useCallback(() => {
    const m = motion.current;
    const live = useUiStore.getState().page;
    return m.peer !== null && live === m.peer ? (m.side || -1) * span() : 0;
  }, [span]);

  /**
   * Once the live page is the peer (a release that goes, mod+1 / mod+2), it becomes the base;
   * nothing moves on screen. The spring then always heads for offset 0, and a swipe while it runs
   * starts from the page now in the middle instead of pulling at the page left behind.
   */
  const rebase = useCallback(() => {
    const m = motion.current;
    if (m.base === null || m.peer === null || useUiStore.getState().page !== m.peer) return;
    const s = m.side || -1;
    motion.current = {
      base: m.peer,
      peer: m.base,
      offset: m.offset - s * span(),
      side: s === 1 ? -1 : 1,
      moving: m.moving,
    };
  }, [span]);

  /** Landed: the live page in place with no transform, the other parked. */
  const finish = useCallback(() => {
    stopRun();
    motion.current = { base: null, peer: null, offset: 0, side: 0, moving: false };
    paint();
  }, [paint, stopRun]);

  /** Spring toward target() (re-read every frame, so a page change mid-flight just re-aims). */
  const spring = useCallback(
    (v0: number) => {
      motion.current.moving = true;
      if (run.current) return;
      const r: Run = {
        v: Math.max(-MAX_SPRING_PX_PER_S, Math.min(MAX_SPRING_PX_PER_S, v0)),
        last: performance.now(),
        raf: 0,
        watchdog: 0,
      };
      run.current = r;
      const arm = () => {
        r.raf = requestAnimationFrame(step);
        window.clearTimeout(r.watchdog);
        r.watchdog = window.setTimeout(() => {
          if (run.current === r) finish();
        }, WATCHDOG_MS);
      };
      const step = (now: number) => {
        if (run.current !== r) return;
        const dt = Math.min(MAX_FRAME_MS, Math.max(0, now - r.last));
        r.last = now;
        const to = target();
        const m = motion.current;
        const next = stepSpring(m.offset, r.v, to, dt);
        m.offset = next.x;
        r.v = next.v;
        if (springAtRest(next.x, next.v, to)) {
          finish();
          return;
        }
        paint();
        arm();
      };
      paint();
      arm();
    },
    [finish, paint, target],
  );

  // Store page → stage. A release of ours lands here too (its spring is already running).
  useLayoutEffect(() => {
    const prev = shown.current;
    shown.current = page;
    if (isPair(page)) setWarm((w) => (w.has(page) ? w : new Set([...w, page])));
    if (prev === page) return;
    const m = motion.current;
    const g = gesture.current;
    if (g?.mode === "track") g.mode = "coast";
    if (m.moving && (page === m.base || page === m.peer)) {
      // A release, or mod+1 / mod+2 while the pages move: the spring re-aims.
      if (!canAnimate()) {
        finish();
        return;
      }
      releaseFocus(page === m.peer ? m.base : m.peer);
      rebase();
      spring(0);
      return;
    }
    stopRun();
    if (isPair(prev) && isPair(page) && canAnimate()) {
      releaseFocus(prev);
      motion.current = { base: prev, peer: page, offset: 0, side: sideOf(page), moving: true };
      rebase();
      spring(0);
      return;
    }
    motion.current = { base: null, peer: null, offset: 0, side: 0, moving: false };
    paint();
  }, [page, canAnimate, finish, paint, rebase, releaseFocus, spring, stopRun]);

  // A slot that just mounted (warm-up, archive) gets its place before the browser paints it.
  const pages = ORDER.filter((p) => p === page || (p !== "archive" && warm.has(p)));
  const pagesKey = pages.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pagesKey is the trigger, not an input
  useLayoutEffect(() => paint(), [paint, pagesKey]);

  useEffect(
    () => () => {
      stopRun();
      cancelAnimationFrame(frame.current);
    },
    [stopRun],
  );

  // Two-finger swipe (horizontal wheel). Capture phase: once the page owns a gesture, rows and the
  // calendar underneath never see it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let lastAt = Number.NEGATIVE_INFINITY;
    let idle = 0;
    let pause = 0;

    const begin = (e: WheelEvent): Gesture => {
      const ui = useUiStore.getState();
      const t = e.target;
      const ours =
        isPair(ui.page) &&
        !ui.overlay &&
        !ui.popover &&
        !ui.dragging &&
        t instanceof Element &&
        !t.closest(NOT_OURS) &&
        !scrollsSideways(t, stage);
      return {
        mode: ours ? "pending" : "other",
        ax: 0,
        ay: 0,
        raw: 0,
        start: 0,
        events: 0,
        notch: false,
        instant: false,
        samples: [],
        lastDx: 0,
      };
    };

    /** Follow from where the pages are now (a new lock, or taking them back from the spring). */
    const follow = (g: Gesture) => {
      stopRun();
      const m = motion.current;
      g.mode = "track";
      g.start = unRubberBand(m.offset, m.side || -1, span());
      g.raw = 0;
      g.samples = [];
      m.moving = true;
    };

    /** The pages' speed on screen (page px/ms): the fingers' × GAIN, less past an end. */
    const pageSpeed = (g: Gesture, fingers: number) =>
      GAIN * fingers * rubberSlope(g.start + GAIN * g.raw, motion.current.side || -1, span());

    /** The gesture locked sideways. */
    const lock = (g: Gesture) => {
      closeOpenSwipeRow();
      const live = useUiStore.getState().page;
      if (!canAnimate() || !isPair(live)) {
        g.mode = "track";
        g.instant = true;
        return;
      }
      const m = motion.current;
      if (!m.moving) {
        // Make sure the other page exists (normally warm already).
        setWarm((w) => (w.has(other(live)) ? w : new Set([...w, other(live)])));
        const peer = other(live);
        motion.current = { base: live, peer, offset: 0, side: sideOf(peer), moving: true };
      }
      const raw = g.raw;
      follow(g);
      g.raw = raw;
    };

    /** Let go (momentum started, the fingers paused, or a notch): decide and spring from here. */
    const release = (g: Gesture, vPage: number, mode: "coast" | "paused") => {
      g.mode = mode;
      window.clearTimeout(pause);
      const m = motion.current;
      if (m.base === null || m.peer === null) return;
      const to = releaseSide(m.offset, vPage, span());
      const dest = to !== 0 && to === m.side ? m.peer : m.base;
      const ui = useUiStore.getState();
      if (ui.page !== dest) {
        releaseFocus(dest === m.peer ? m.base : m.peer);
        ui.setPage(dest);
        rebase();
      }
      spring(vPage * 1000);
    };

    /** Fingers reported down: never let go, however long they rest. */
    const held = () => trackpadTouching() === true;

    /** Guessing the lift (no report): the fingers stopped. */
    const onPause = () => {
      const g = gesture.current;
      if (g?.mode !== "track" || g.instant || held()) return;
      const last = g.samples[g.samples.length - 1];
      release(g, last ? pageSpeed(g, velocity(g.samples, last.t)) : 0, "paused");
    };

    const onIdle = () => {
      if (held() && gesture.current?.mode === "track") return;
      onPause();
      gesture.current = null;
    };

    /** No animation: the other page at once, once the swipe has gone far enough. */
    const switchNow = (g: Gesture) => {
      g.mode = "coast";
      const live = useUiStore.getState().page;
      if (isPair(live)) useUiStore.getState().setPage(other(live));
    };

    /** No animation: the fingers went far enough towards the other page (left on the calendar,
     *  right on tasks). */
    const farEnough = (g: Gesture) => {
      const live = useUiStore.getState().page;
      const toward = isPair(live) ? sideOf(other(live)) : 0;
      return (g.notch || Math.abs(g.raw) >= INSTANT_SWITCH_PX) && Math.sign(g.raw) === toward;
    };

    // The reported lift: let go at the speed of the last moment (0 if the fingers had rested).
    const offTrackpad = onTrackpadChange((down) => {
      const g = gesture.current;
      if (down || g?.mode !== "track") return;
      if (!g.instant) release(g, pageSpeed(g, velocity(g.samples, performance.now())), "coast");
      else if (farEnough(g)) switchNow(g);
      else g.mode = "coast";
    });

    /**
     * After a release by the lift or by momentum: is this event the fingers again? With the lift
     * reported, only fingers reported down are: a busy frame makes WebKit merge momentum events into
     * one bigger, later one, which the guess below would take for the fingers. A mouse-wheel notch
     * reports nothing, so it is guessed: a gap, or a delta that grows or turns.
     */
    const fingersBack = (g: Gesture, gap: number, fdx: number) => {
      if (g.instant) return false;
      if (trackpadTouching() !== null && !g.notch) return held();
      return held() || gap > COAST_GAP_MS || !stillCoasting(g.lastDx, fdx);
    };

    const swallow = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      const now = eventTime(e);
      const gap = now - lastAt;
      lastAt = now;
      const dx = wheelPx(e.deltaX, e.deltaMode, stage.clientWidth);
      const dy = wheelPx(e.deltaY, e.deltaMode, stage.clientHeight);
      const fdx = fingerSign(e) * dx;

      let g = gesture.current;
      if (g && gap > SWIPE_IDLE_MS && !(held() && g.mode === "track")) g = null;
      window.clearTimeout(idle);
      idle = window.setTimeout(onIdle, SWIPE_IDLE_MS);

      // Let go already. After the lift / momentum the rest of the momentum is swallowed until the
      // fingers are back (fingersBack). After a pause no momentum follows, so any movement is the
      // fingers.
      // The fingers take the pages back from the spring or, once the pages have landed, start a
      // new gesture.
      if (g && (g.mode === "coast" || g.mode === "paused")) {
        const fingers = g.mode === "coast" ? fingersBack(g, gap, fdx) : Math.abs(fdx) >= 0.5;
        if (!fingers) {
          if (fdx) g.lastDx = fdx;
          swallow(e);
          return;
        }
        if (motion.current.moving) follow(g);
        else g = null;
      }
      if (!g) {
        g = begin(e);
        gesture.current = g;
      }
      if (g.mode === "other") return;

      g.raw += fdx;
      g.events++;
      g.lastDx = fdx;
      if (g.mode === "pending") {
        if (g.events === 1) g.notch = isNotch(e.deltaMode, dx);
        g.ax += Math.abs(dx);
        g.ay += Math.abs(dy);
        // While the pages move (the shield is up) a sideways event catches them at once.
        const quick = motion.current.moving && g.ax > g.ay;
        if (!quick && g.ax <= SWIPE_LOCK && g.ay <= SWIPE_LOCK) return;
        if (g.ax <= g.ay) {
          g.mode = "other"; // vertical: the calendar / the lists
          return;
        }
        lock(g);
      }
      swallow(e);
      g.samples.push({ t: now, dx: fdx });
      if (g.samples.length > 12) g.samples.shift();

      if (g.instant) {
        if (!held() && farEnough(g)) switchNow(g);
        return;
      }

      const m = motion.current;
      m.offset = rubberBand(g.start + GAIN * g.raw, m.side || -1, span());
      paintSoon();
      window.clearTimeout(pause);
      // A sideways mouse-wheel notch is a flick. With the fingers reported down, wait for the lift;
      // otherwise the system's momentum or a pause means they lifted.
      if (g.notch) release(g, pageSpeed(g, Math.sign(fdx) / GAIN), "coast");
      else if (held()) return;
      else if (looksLikeMomentum(g.samples)) {
        release(g, pageSpeed(g, velocity(g.samples, now)), "coast");
      } else pause = window.setTimeout(onPause, PAUSE_RELEASE_MS);
    };

    stage.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel, { capture: true });
      offTrackpad();
      window.clearTimeout(idle);
      window.clearTimeout(pause);
    };
  }, [canAnimate, paintSoon, rebase, releaseFocus, span, spring, stopRun]);

  const slotRef = useCallback((p: Page) => {
    let cb = slotRefs.current.get(p);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) slots.current.set(p, el);
        else slots.current.delete(p);
      };
      slotRefs.current.set(p, cb);
    }
    return cb;
  }, []);

  return { stageRef, pages, slotRef };
}
