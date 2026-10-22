// Vertical scroll area with top / bottom fade masks that appear only when there is more to see
// (ui-spec §8.6 key point list, §10 timeline, §2.9 crowded day cells).

import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cx } from "./cx";
import styles from "./ScrollFade.module.css";

export type ScrollFadeProps = {
  children: ReactNode;
  /** Fade colour = the surface behind: card (--fade-card), elevated (--fade-elevated), paper. */
  surface?: "card" | "elevated" | "paper";
  /** Fade height in px (default 16). */
  fadeSize?: number;
  maxHeight?: number | string;
  className?: string;
  /** "always" (default): the 3px bar is drawn whenever the content overflows (§8.6).
   *  "hover": hidden until the pointer is over the area (§2.3 day cells). */
  scrollbar?: "always" | "hover";
};

export const ScrollFade = forwardRef<HTMLDivElement, ScrollFadeProps>(function ScrollFade(
  { children, surface = "card", fadeSize = 16, maxHeight, className, scrollbar = "always" },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scroller.current as HTMLDivElement, []);
  const [top, setTop] = useState(false);
  const [bottom, setBottom] = useState(false);

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const overflow = el.scrollHeight - el.clientHeight > 1;
    setTop(overflow && el.scrollTop > 1);
    setBottom(overflow && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  useEffect(() => {
    update();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [update]);

  const style = { "--fade-size": `${fadeSize}px`, maxHeight } as CSSProperties;
  return (
    <div
      className={cx(
        styles.wrap,
        styles[surface],
        scrollbar === "hover" && styles.hoverBar,
        className,
      )}
      style={style}
    >
      <div ref={scroller} className={styles.scroller} onScroll={update}>
        {children}
      </div>
      <div className={cx(styles.fade, styles.top, top && styles.show)} aria-hidden="true" />
      <div className={cx(styles.fade, styles.bottom, bottom && styles.show)} aria-hidden="true" />
    </div>
  );
});
