// Hover / focus tooltip: the words a compact control left out (ui-spec §8.1). Same bubble as the
// detail track's step tips (TaskDetail.module.css .dotTip): dark, springs up out of the trigger.
// It shows after a short rest (a passing pointer does not flash tips), hides at once on leave,
// press or scroll, and renders in a portal so a scroll area (the card's step list) never clips it.
// The bubble is decoration (aria-hidden): give the trigger its own accessible name.

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import styles from "./Tip.module.css";

/** Rest before the bubble shows, ms. */
export const TIP_DELAY_MS = 320;
/** Gap between the trigger and the bubble, and the minimum distance to the window edge, px. */
const GAP = 6;
const EDGE = 8;

type Place = { left: number; top: number; below: boolean; originX: number };

export type TipProps = {
  /** Bubble text; `\n` breaks lines. Empty = no tip. */
  text: string;
  children: ReactNode;
};

export function Tip({ text, children }: TipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPlace(null);
  }, []);
  const show = useCallback(() => {
    if (!text) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), TIP_DELAY_MS);
  }, [text]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("pointerdown", hide, true);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("pointerdown", hide, true);
    };
  }, [open, hide]);

  // Above the trigger, centred and kept inside the window; below when there is no room above.
  useLayoutEffect(() => {
    if (!open) return;
    const target = anchor.current?.firstElementChild;
    const tip = bubble.current;
    if (!target || !tip) return;
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const centre = r.left + r.width / 2;
    const left = Math.min(Math.max(centre - w / 2, EDGE), window.innerWidth - EDGE - w);
    const below = r.top - GAP - h < EDGE;
    const top = below ? r.bottom + GAP : r.top - GAP - h;
    setPlace({ left, top, below, originX: Math.min(Math.max(centre - left, 10), w - 10) });
  }, [open]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover / focus listener only (no box of its own); the trigger inside is the control
    <span
      ref={anchor}
      className={styles.anchor}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={bubble}
            className={cx(styles.tip, place && styles.placed, place?.below && styles.below)}
            style={
              place
                ? {
                    left: place.left,
                    top: place.top,
                    transformOrigin: `${place.originX}px ${place.below ? "0" : "100%"}`,
                  }
                : undefined
            }
            aria-hidden
            data-testid="tip"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
