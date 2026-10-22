// A row that slides sideways (ui-spec §10.14): drag it with the pointer or swipe two fingers on a
// trackpad. A swipe to the left opens a red 「删除」 button under the right edge; a swipe to the
// right past the threshold runs `right` (tick / untick) and springs back. One gesture works one
// side: back from 删除 (open or still under the fingers) it stops at rest, and 完成 takes a gesture
// of its own (and the other way round). One row is open at a time: a swipe on another row, a click outside or Esc closes it. The click that ends a swipe
// never reaches the row (the next press clears that); a click on an open row only closes it.
// Keyboard: Delete / Backspace with focus in the row (not in a text field) opens 「删除」 and
// focuses it (Enter / Space deletes, Esc closes); callers put SWIPE_DELETE_KEYS on the row's
// controls so screen readers announce it. An overlay or popover opening closes the open row
// (closeOpenSwipeRow), so its Esc never lands on a row behind the scrim. `hint` peeks once: the
// surface slides a little left, back, right, back, so the actions underneath show without words.
// A row with an action is marked data-swipe-row: a two-finger swipe that starts on it is the
// row's, never the page switch's (components/shell/usePageSwipe.ts).
//
// `overlay` (the detail timeline): the row stays put and the actions slide in over its ends
// instead, so a row whose left part is a shared spine (date column, marker, rail) does not drag it
// away or get cut at the list's edge. The action layers are always clipped to the uncovered strip
// (plus a little under the surface while sliding), never the whole row: a full-width coloured
// layer under the surface leaks through the anti-aliased rounded clip as a coloured hairline at
// the row's far corners.
//
// At rest the row paints like a plain row: the root does not clip and the surface is see-through
// (callers tint it with --swipe-tint). Only while a side shows (data-swiped) does the root clip
// and the surface take its opaque --swipe-surface: WebKit paints a composited row (a reordered
// <li>) black when an opaque surface sits under the root's rounded overflow clip.

import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import {
  type FocusEvent,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { onTrackpadChange, trackpadTouching } from "@/lib/trackpad";
import { cx } from "./cx";
import styles from "./SwipeRow.module.css";

export type SwipeAction = {
  label: string;
  icon: ReactNode;
  /** "st" = green (tick), "muted" = grey (untick). */
  tone: "st" | "muted";
  run: () => void;
};

export type SwipeRowProps = {
  children: ReactNode;
  className?: string;
  /** The sliding surface: opaque `--swipe-surface` while swiped; tint it with `--swipe-tint`. */
  surfaceClassName?: string;
  /** Card rows: narrower button, shorter threshold. */
  compact?: boolean;
  /** The row stays put and the actions slide in over its ends (detail timeline). */
  overlay?: boolean;
  /** Shown under the left edge while swiping right; runs on release past the threshold. */
  right?: SwipeAction | null;
  /** Shown under the right edge by a swipe left (or Delete / Backspace); the button runs it. */
  onDelete?: (() => void) | null;
  /** The delete button's text and accessible name. */
  deleteLabel: string;
  /** Peek once at the actions (left, then right) shortly after this turns true. */
  hint?: boolean;
  /** The row starts to slide (swipe, or Delete / Backspace): close what floats from the row. */
  onSwipeStart?: () => void;
  /** Focus entered (true) or left (false) the row, 「删除」 included. */
  onFocusChange?: (within: boolean) => void;
};

/** Pointer / wheel travel before a gesture picks an axis (same as the step reorder sensor). */
export const SWIPE_LOCK = 6;
/** `aria-keyshortcuts` for the focusable controls of a row with `onDelete`. */
export const SWIPE_DELETE_KEYS = "Delete Backspace";
/** A trackpad swipe ends after this long without wheel events. */
export const SWIPE_IDLE_MS = 120;
/** The hint peek: wait PEEK_DELAY_MS, then slide PEEK_PX each way, one leg every PEEK_STEP_MS. */
export const PEEK_DELAY_MS = 450;
export const PEEK_PX = 32;
export const PEEK_STEP_MS = 275;
/** At most this long after a swipe the row swallows the click that ended it. */
const SUPPRESS_MS = 300;
/** Matches --duration-card: the layers stay while the surface springs back. */
const SETTLE_MS = 200;

/** While sliding, an action layer reaches this far under the surface: no seam at the edge while
 *  the two animate (transform vs clip-path), and still far from the row's other end. */
const LAYER_OVERLAP = 12;

/** The action layer's clip: the strip `w` px wide at its side of the row. Overlay strips get the
 *  row's corner radius (`--swipe-overlay-radius`) on all four corners, like a button. */
function layerClip(side: "right" | "left", w: number, overlay: boolean): string {
  const width = Math.max(0, overlay ? w : w + LAYER_OVERLAP);
  const round = overlay ? " round var(--swipe-overlay-radius, 0px)" : "";
  return side === "right"
    ? `inset(0 calc(100% - ${width}px) 0 0${round})`
    : `inset(0 0 0 calc(100% - ${width}px)${round})`;
}

/** `stretch`: how much further than the threshold / the open button the row can be pulled (a
 *  rubber band, so an action strip never grows much past its label). */
const SIZES = {
  normal: { reveal: 88, commit: 72, stretch: 20 },
  compact: { reveal: 64, commit: 52, stretch: 14 },
};
/** Overlay strips cover the row's own content past the date column and marker: barely stretch. */
const OVERLAY_STRETCH = 6;

/** Inputs that take no text: Delete / Backspace on them is free for the row. */
const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
]);

/** Close callback of the row that is open (or sliding) now. */
let openRow: (() => void) | null = null;

/** Closes the open row, if any: an overlay or popover is opening over it. */
export function closeOpenSwipeRow(): void {
  openRow?.();
}

/** Controls that can hold focus, in document order. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** `d` px of pull past a limit → how far the row goes: about half at first, never past `max`. */
function rubber(d: number, max: number): number {
  return max * (1 - 1 / ((0.55 * d) / max + 1));
}

/** 1:1 up to the threshold (right) / the open button (left), then a rubber band; a side without
 *  an action barely moves. */
function resist(
  o: number,
  reveal: number,
  commit: number,
  stretch: number,
  right: boolean,
  left: boolean,
): number {
  if (o > 0) {
    if (!right) return Math.min(o * 0.15, 10);
    return o <= commit ? o : commit + rubber(o - commit, stretch);
  }
  if (o < 0) {
    if (!left) return Math.max(o * 0.15, -10);
    return o >= -reveal ? o : -reveal - rubber(-reveal - o, stretch);
  }
  return 0;
}

/**
 * One gesture works one side: the side it first moved to (left from an open row). Coming back it
 * stops at rest, so a swipe that showed 删除 never runs 完成 on the way back, and the other side
 * takes a gesture of its own. Returns the travel (row px from `base`) kept on that side.
 */
function oneSide(travel: number, base: number, dir: -1 | 1): number {
  return dir < 0 ? Math.min(travel, -base) : Math.max(travel, -base);
}

/** Whether a key press here edits text (Delete / Backspace belong to the field then). */
function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(t.type);
  return (
    t.isContentEditable || t.closest('[contenteditable=""], [contenteditable="true"]') !== null
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function SwipeRow({
  children,
  className,
  surfaceClassName,
  compact = false,
  overlay = false,
  right = null,
  onDelete = null,
  deleteLabel,
  hint = false,
  onSwipeStart,
  onFocusChange,
}: SwipeRowProps) {
  const size = SIZES[compact ? "compact" : "normal"];
  const { reveal, commit } = size;
  const stretch = overlay ? OVERLAY_STRETCH : size.stretch;
  const rootRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const [offset, setOffsetState] = useState(0);
  const [side, setSide] = useState<"right" | "left" | null>(null);
  const [moving, setMoving] = useState(false);
  const [open, setOpenState] = useState(false);
  const [peeking, setPeeking] = useState(false);
  // The right action as it was at release: run() may flip the row (done ↔ not done) at once, and
  // the layer must not switch from 完成 to 取消完成 while the surface springs back over it.
  const [released, setReleased] = useState<SwipeAction | null>(null);
  const offsetRef = useRef(0);
  const openRef = useRef(false);
  const suppressUntil = useRef(0);
  const peekTimer = useRef(0);
  // The keyboard path focuses 删除 once it renders and gives focus back when the row closes.
  const focusDelete = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Latest props for the native listeners.
  const latest = useRef({ right, onDelete, onSwipeStart });
  latest.current = { right, onDelete, onSwipeStart };
  const enabled = right !== null || onDelete !== null;

  const setOffset = useCallback((o: number) => {
    offsetRef.current = o;
    setOffsetState(o);
    if (o > 0) setSide("right");
    else if (o < 0) setSide("left");
  }, []);

  const setOpen = useCallback((o: boolean) => {
    openRef.current = o;
    setOpenState(o);
  }, []);

  /** Spring back to rest; the layers go once the surface is home. */
  const close = useCallback(() => {
    const back = returnFocus.current;
    returnFocus.current = null;
    const del = deleteRef.current;
    if (del && document.activeElement === del) {
      // Focus goes back where the keyboard path took it from. That control may be gone or hidden
      // by now (a button shown only while the row has focus): then the row's first control that
      // takes focus gets it, so focus never drops to the page when 删除 unmounts.
      back?.focus({ preventScroll: true });
      for (const el of rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []) {
        if (document.activeElement !== del) break;
        if (el !== del) el.focus({ preventScroll: true });
      }
    }
    setMoving(false);
    setOpen(false);
    setOffset(0);
    window.setTimeout(() => {
      if (offsetRef.current !== 0) return;
      setSide(null);
      setReleased(null);
    }, SETTLE_MS);
  }, [setOffset, setOpen]);

  /** A press, swipe or key during the hint peek ends it at once. */
  const stopPeek = useCallback(() => {
    if (!peekTimer.current) return;
    window.clearTimeout(peekTimer.current);
    peekTimer.current = 0;
    setPeeking(false);
    close();
  }, [close]);

  // Starting a swipe here closes the row that is open elsewhere (and what floats from this one).
  const claim = useCallback(() => {
    stopPeek();
    if (openRow && openRow !== close) openRow();
    openRow = close;
    latest.current.onSwipeStart?.();
  }, [close, stopPeek]);

  useEffect(
    () => () => {
      if (openRow === close) openRow = null;
    },
    [close],
  );

  // The hint peek: left (删除 shows), back, right (the tick shows), back; a side without an action
  // is skipped. Never under reduced motion.
  useEffect(() => {
    if (!hint) return;
    const { right: r, onDelete: del } = latest.current;
    if ((!r && !del) || prefersReducedMotion()) return;
    const legs = [...(del ? [-PEEK_PX, 0] : []), ...(r ? [PEEK_PX, 0] : [])];
    let i = 0;
    const step = () => {
      if (i < legs.length) {
        setPeeking(true);
        setOffset(legs[i++]);
        peekTimer.current = window.setTimeout(step, PEEK_STEP_MS);
        return;
      }
      peekTimer.current = 0;
      setPeeking(false);
      if (offsetRef.current === 0) setSide(null);
    };
    peekTimer.current = window.setTimeout(step, PEEK_DELAY_MS);
    // Turned off (or unmounted) before it finished: stop and spring back.
    return stopPeek;
  }, [hint, setOffset, stopPeek]);

  /** Release at `o`: tick past the threshold, open past half the button, else back to rest. */
  const settle = useCallback(
    (o: number) => {
      suppressUntil.current = performance.now() + SUPPRESS_MS;
      const { right: r, onDelete: del } = latest.current;
      if (r && o >= commit) {
        setReleased(r);
        close();
        r.run();
      } else if (del && o <= -reveal / 2) {
        setMoving(false);
        setOpen(true);
        setOffset(-reveal);
      } else {
        close();
      }
    },
    [close, commit, reveal, setOffset, setOpen],
  );

  const follow = useCallback(
    (raw: number) => {
      const { right: r, onDelete: del } = latest.current;
      setOffset(resist(raw, reveal, commit, stretch, r !== null, del !== null));
    },
    [commit, reveal, stretch, setOffset],
  );

  // Pointer drag: pick an axis after SWIPE_LOCK px; vertical is left to the list (scroll / reorder).
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A new press is a new click (e.g. on 删除 right after the swipe opened it).
    suppressUntil.current = 0;
    stopPeek();
    if (!enabled || e.button !== 0 || !e.isPrimary) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, [data-swipe-ignore]")) {
      return;
    }
    const root = e.currentTarget;
    const id = e.pointerId;
    let x0 = e.clientX;
    const y0 = e.clientY;
    const base = openRef.current ? -reveal : 0;
    let axis: "x" | "y" | null = null;
    let dir: -1 | 1 = -1;
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (axis === null) {
        if (Math.abs(dx) <= SWIPE_LOCK && Math.abs(dy) <= SWIPE_LOCK) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (axis === "y") {
          stop();
          return;
        }
        dir = base < 0 || dx < 0 ? -1 : 1;
        claim();
        setMoving(true);
        window.getSelection()?.removeAllRanges();
        try {
          root.setPointerCapture(id);
        } catch {
          // the pointer is already gone
        }
      }
      ev.preventDefault();
      // Held at rest, the pointer moves the start along: no travel piles up to undo.
      x0 = ev.clientX - oneSide(ev.clientX - x0, base, dir);
      follow(base + ev.clientX - x0);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      stop();
      if (axis === "x") settle(offsetRef.current);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      stop();
      if (axis === "x") settle(openRef.current ? -reveal : 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Two-finger trackpad swipe (horizontal wheel). Like the pointer, a gesture picks its axis once
  // it has travelled SWIPE_LOCK px either way; until then (and once it is y) the wheel is left to
  // the list, so a scroll that starts a little sideways still scrolls. An x gesture settles the
  // moment the fingers lift (macOS reports it, lib/trackpad.ts), never while they rest on the
  // trackpad, and the momentum after the lift is swallowed. Without that report it settles after
  // SWIPE_IDLE_MS of quiet (momentum included).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !enabled) return;
    type Gesture = {
      axis: "x" | "y" | null;
      last: number;
      /** Finger travel along x (px), signed like the row offset. */
      raw: number;
      /** Unsigned travel per axis before the lock. */
      ax: number;
      ay: number;
      base: number;
      /** The side this gesture works (oneSide). */
      dir: -1 | 1;
      /** Settled on the lift: the rest is momentum. */
      done: boolean;
    };
    let g: Gesture | null = null;
    let timer = 0;
    const held = () => trackpadTouching() === true;
    const end = () => {
      const cur = g;
      if (cur?.axis === "x" && !cur.done && held()) return; // resting fingers: wait for the lift
      g = null;
      if (cur?.axis === "x" && !cur.done) settle(offsetRef.current);
    };
    const offTrackpad = onTrackpadChange((down) => {
      if (down || g?.axis !== "x" || g.done) return;
      g.done = true;
      g.last = performance.now(); // the momentum that follows counts from the lift
      settle(offsetRef.current);
    });
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch-zoom
      if (e.target instanceof Element && e.target.closest("[data-swipe-ignore]")) return;
      const now = performance.now();
      const resting = g?.axis === "x" && !g.done && held();
      if (!g || (now - g.last > SWIPE_IDLE_MS && !resting) || (g.done && held())) {
        g = {
          axis: null,
          last: now,
          raw: 0,
          ax: 0,
          ay: 0,
          base: openRef.current ? -reveal : 0,
          dir: -1,
          done: false,
        };
      }
      g.last = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(end, SWIPE_IDLE_MS);
      if (g.done) {
        e.preventDefault();
        return;
      }
      if (g.axis === "y") return;
      const lines = e.deltaMode === 1;
      const dx = e.deltaX * (lines ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      const dy = e.deltaY * (lines ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
      // Follow the fingers: with natural scrolling (the macOS default) the delta is inverted.
      const inverted = (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean })
        .webkitDirectionInvertedFromDevice;
      g.raw += (inverted === false ? 1 : -1) * dx;
      if (g.axis === null) {
        g.ax += Math.abs(dx);
        g.ay += Math.abs(dy);
        if (g.ax <= SWIPE_LOCK && g.ay <= SWIPE_LOCK) return;
        g.axis = g.ax > g.ay ? "x" : "y";
        if (g.axis === "y") return;
        g.dir = g.base < 0 || g.raw < 0 ? -1 : 1;
        claim();
        setMoving(true);
      }
      e.preventDefault();
      g.raw = oneSide(g.raw, g.base, g.dir);
      follow(g.base + g.raw);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      offTrackpad();
      window.clearTimeout(timer);
    };
  }, [enabled, reveal, claim, follow, settle]);

  // Keyboard path to delete: Delete / Backspace anywhere in the row (not while typing) opens the
  // button and focuses it. Parts that are not the row (a popover inside it) opt out.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || !latest.current.onDelete) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    if (isTextEntry(e.target)) return;
    if (e.target instanceof Element && e.target.closest("[data-swipe-ignore]")) return;
    e.preventDefault();
    e.stopPropagation();
    claim();
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement ? active : null;
    focusDelete.current = true;
    setMoving(false);
    setOpen(true);
    setOffset(-reveal);
  };

  useEffect(() => {
    if (!open || !focusDelete.current) return;
    focusDelete.current = false;
    deleteRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Focus in the row, 删除 included (it sits outside the caller's markup).
  const onFocus = () => onFocusChange?.(true);
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && rootRef.current?.contains(next)) return;
    onFocusChange?.(false);
  };

  // Tabbing away from an open 删除 closes the row.
  const onDeleteBlur = (e: FocusEvent<HTMLButtonElement>) => {
    const next = e.relatedTarget;
    if (!(next instanceof Node) || rootRef.current?.contains(next)) return;
    if (openRef.current) close();
  };

  // An open row closes on a press anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  useEscLayer(open, close, ESC_PRIORITY.inlineInput);

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const onButton = e.target instanceof Element && e.target.closest("[data-swipe-delete]");
    if (performance.now() < suppressUntil.current || (openRef.current && !onButton)) {
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() >= suppressUntil.current) close();
    }
  };

  const shownRight = released ?? right;
  const armed = released !== null || offset >= commit;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: gesture surface; its keys (Delete / Backspace) come from the controls inside the row
    <div
      ref={rootRef}
      className={cx(
        styles.root,
        compact && styles.compact,
        moving && styles.moving,
        peeking && styles.peeking,
        className,
      )}
      data-swiped={side ? "true" : undefined}
      data-swipe-row={enabled || undefined}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
      onFocus={onFocusChange ? onFocus : undefined}
      onBlur={onFocusChange ? onBlur : undefined}
    >
      {side === "right" && shownRight && (
        <div
          className={cx(
            styles.layer,
            overlay && styles.overlayLayer,
            styles.rightLayer,
            styles[`tone_${shownRight.tone}`],
          )}
          style={{ clipPath: layerClip("right", Math.max(0, offset), overlay) }}
          data-armed={armed ? "true" : undefined}
          aria-hidden="true"
        >
          <span className={styles.rightLabel}>
            {shownRight.icon}
            {shownRight.label}
          </span>
        </div>
      )}
      {side === "left" && onDelete && (
        <div
          className={cx(styles.layer, overlay && styles.overlayLayer, styles.leftLayer)}
          style={{ clipPath: layerClip("left", Math.max(0, -offset), overlay) }}
        >
          <button
            ref={deleteRef}
            type="button"
            className={styles.deleteButton}
            style={{ width: reveal }}
            tabIndex={open ? 0 : -1}
            aria-label={deleteLabel}
            data-swipe-delete
            data-swipe-ignore
            onBlur={onDeleteBlur}
            onClick={() => {
              close();
              onDelete();
            }}
          >
            <TrashIcon size={compact ? 12 : 14} aria-hidden="true" />
            {deleteLabel}
          </button>
        </div>
      )}
      <div
        className={cx(styles.surface, surfaceClassName)}
        style={offset && !overlay ? { transform: `translateX(${offset}px)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
