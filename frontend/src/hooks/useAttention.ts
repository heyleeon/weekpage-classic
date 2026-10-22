// "You still need this": a press on a not-ready primary button (Create, OK…) points at what is
// missing instead of doing nothing. The field shakes once, wears a red ring that fades, and
// takes the focus (unless it already holds it). Pair it with `notReady` on the button: it looks dimmed but stays clickable.

import { type RefObject, useCallback } from "react";
import styles from "./attention.module.css";

/** Class for a primary button whose action still needs something (dimmed, still clickable). */
export const notReady = styles.notReady;

/** Returns `flag()` for the element behind `ref`. */
export function useAttention(ref: RefObject<HTMLElement | null>) {
  return useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove(styles.attention);
    // Restart the animation when it is flagged again while still running.
    void el.offsetWidth;
    el.classList.add(styles.attention);
    el.addEventListener("animationend", () => el.classList.remove(styles.attention), {
      once: true,
    });
    // A box around the focused input (a step composer) keeps the caret where it is.
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: false });
  }, [ref]);
}
