// Layout animation for the board (ui-spec §7.1 / §8.7): when a card grows, shrinks or leaves,
// the cards below slide to their new place over 200ms instead of jumping (FLIP). Positions are
// layout offsets (offsetTop ignores transforms), checked after every grid render and whenever a
// card resizes (ResizeObserver runs after layout, before paint, so the jump is never drawn).
// Skipped while a drag runs and just after it ends (dnd-kit moves the cards itself), while a
// card collapses on archive, and when the grid width changed (window resize).

import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { useUiStore } from "@/hooks/useUiStore";

/** Matches --duration-card. */
export const CARD_MOVE_MS = 200;
/** After a drop dnd-kit settles the cards itself. */
const AFTER_DRAG_MS = 300;

type Pos = { col: string | null; top: number };

function currentOffsetY(el: HTMLElement): number {
  if (typeof DOMMatrixReadOnly === "undefined") return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    return new DOMMatrixReadOnly(t).m42;
  } catch {
    return 0;
  }
}

export function useCardFlip(gridRef: RefObject<HTMLElement | null>): void {
  const positions = useRef(new Map<string, Pos>());
  const width = useRef<number | null>(null);
  const quietUntil = useRef(0);
  const anims = useRef(new Map<string, Animation>());
  const check = useRef<() => void>(() => undefined);

  check.current = () => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-task-id]"));
    const w = grid.clientWidth;
    const quiet =
      performance.now() < quietUntil.current ||
      useUiStore.getState().dragging ||
      width.current !== w ||
      cards.some((el) => el.dataset.collapsing === "true");
    width.current = w;
    const next = new Map<string, Pos>();
    for (const el of cards) {
      const id = el.dataset.taskId;
      if (!id) continue;
      const pos: Pos = { col: el.parentElement?.dataset.column ?? null, top: el.offsetTop };
      next.set(id, pos);
      const prev = positions.current.get(id);
      if (quiet || !prev || prev.col !== pos.col || prev.top === pos.top) continue;
      if (typeof el.animate !== "function") continue;
      const running = anims.current.get(id);
      const from = prev.top - pos.top + (running ? currentOffsetY(el) : 0);
      running?.cancel();
      if (Math.abs(from) < 0.5) continue;
      const anim = el.animate(
        [{ transform: `translateY(${from}px)` }, { transform: "translateY(0)" }],
        { duration: CARD_MOVE_MS, easing: "ease-out" },
      );
      anims.current.set(id, anim);
      anim.onfinish = () => anims.current.delete(id);
      anim.oncancel = () => {
        if (anims.current.get(id) === anim) anims.current.delete(id);
      };
    }
    positions.current = next;
  };

  // A drag (and its drop) moves the cards with dnd-kit's own transforms.
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        if (s.dragging === prev.dragging) return;
        if (s.dragging) {
          for (const a of anims.current.values()) a.cancel();
          quietUntil.current = Number.POSITIVE_INFINITY;
        } else {
          quietUntil.current = performance.now() + AFTER_DRAG_MS;
        }
      }),
    [],
  );

  // After every render of the grid (cards added / removed / reordered / resized by data).
  useLayoutEffect(() => {
    check.current();
  });

  // Local card state (the inline 「+ 关键点」 row) resizes a card without a grid render.
  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const grid = gridRef.current;
    if (!grid) return;
    if (!observer.current) observer.current = new ResizeObserver(() => check.current());
    const ro = observer.current;
    const cards = new Set<Element>(grid.querySelectorAll("[data-task-id]"));
    for (const el of observed.current) if (!cards.has(el)) ro.unobserve(el);
    for (const el of cards) if (!observed.current.has(el)) ro.observe(el);
    observed.current = cards;
  });
  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
      observed.current = new Set();
    },
    [],
  );
}
