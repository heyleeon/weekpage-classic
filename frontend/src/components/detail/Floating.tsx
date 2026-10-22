// A small panel that floats next to its trigger inside a modal (status menu, ⋯ menu, AddBar type /
// date pickers, start / due range calendar, timeline date edit). It is placed with fixed
// coordinates so scroll containers never clip it; outside click and Esc (popover priority) close
// it, and opening it closes a row left swiped open (SwipeRow). The shell's PopoverHost only knows
// its two popover kinds, so these stay local.

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cx } from "@/components/ui/cx";
import { closeOpenSwipeRow } from "@/components/ui/SwipeRow";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import styles from "./Floating.module.css";

export type FloatingProps = {
  open: boolean;
  onClose: () => void;
  /** The trigger; the panel is positioned against this wrapper. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  /** Open upwards (the AddBar sits at the bottom of the panel). */
  up?: boolean;
  className?: string;
};

const GAP = 6;

export function Floating({
  open,
  onClose,
  trigger,
  children,
  align = "left",
  up = false,
  className,
}: FloatingProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useEscLayer(open, onClose, ESC_PRIORITY.popover);
  // An open row's Esc layer would outrank this one.
  useEffect(() => {
    if (open) closeOpenSwipeRow();
  }, [open]);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const style: CSSProperties = {};
    if (align === "right") style.right = Math.max(GAP, vw - r.right);
    else style.left = Math.max(GAP, r.left);
    const h = panel.current?.offsetHeight ?? 0;
    const roomBelow = vh - r.bottom - GAP;
    const goUp = up ? r.top - GAP >= h || r.top > roomBelow : h > roomBelow && r.top > roomBelow;
    if (goUp) style.bottom = vh - r.top + GAP;
    else style.top = r.bottom + GAP;
    setPos(style);
  }, [align, up]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (ref.current?.contains(e.target) || panel.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", place);
    };
  }, [open, onClose, place]);

  return (
    <span ref={ref} className={cx(styles.wrap, className)}>
      {trigger}
      {open && (
        <span
          ref={panel}
          className={cx(styles.panel, pos === null && styles.measuring)}
          style={pos ?? { top: 0, left: 0 }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Class for a calendar card inside a floating panel. */
export const floatingCard = styles.card;
