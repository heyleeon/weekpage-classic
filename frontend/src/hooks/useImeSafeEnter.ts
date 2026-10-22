// Enter that never fires while an IME is composing (ui-spec §17; WebKit sends keyCode 229 and
// a late keydown right after compositionend — 30 ms grace window).

import { type KeyboardEvent, useCallback, useRef } from "react";

export const IME_GRACE_MS = 30;

type KeyLike = { key: string; keyCode?: number; nativeEvent?: { isComposing?: boolean } };

/** True when this keydown belongs to an IME composition and must not count as Enter / Esc. */
export function isImeKey(e: KeyLike, lastCompositionEnd: number, now: number): boolean {
  return (
    e.nativeEvent?.isComposing === true ||
    e.keyCode === 229 ||
    now - lastCompositionEnd < IME_GRACE_MS
  );
}

export type ImeSafeEnterOptions = {
  /** Shift+Enter is ignored (no newline, no submit) unless this is true. */
  allowShift?: boolean;
};

/**
 * Spread the returned handlers on an <input> / <textarea>:
 * `const ime = useImeSafeEnter(save); <input {...ime} />`.
 */
export function useImeSafeEnter<T extends HTMLElement = HTMLInputElement>(
  onEnter: (e: KeyboardEvent<T>) => void,
  opts: ImeSafeEnterOptions = {},
) {
  const composing = useRef(false);
  const endedAt = useRef(Number.NEGATIVE_INFINITY);
  const { allowShift = false } = opts;

  const onCompositionStart = useCallback(() => {
    composing.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    composing.current = false;
    endedAt.current = performance.now();
  }, []);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<T>) => {
      if (e.key !== "Enter") return;
      if (composing.current || isImeKey(e, endedAt.current, performance.now())) return;
      if (e.shiftKey && !allowShift) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      onEnter(e);
    },
    [onEnter, allowShift],
  );

  return { onKeyDown, onCompositionStart, onCompositionEnd };
}
