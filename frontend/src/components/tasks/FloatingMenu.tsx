// A Menu floating at a viewport point (todo right-click menu, card status menu). Closes on an
// outside mousedown or Esc (anchored-popover level of the Esc chain).

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import styles from "./FloatingMenu.module.css";

export type FloatingMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  label: string;
  onClose: () => void;
  /** Focus the first item (menu opened from the keyboard). */
  autoFocus?: boolean;
};

const MARGIN = 8;

export function FloatingMenu({ x, y, items, label, onClose, autoFocus }: FloatingMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEscLayer(true, onClose, ESC_PRIORITY.popover);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - MARGIN - r.width)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - MARGIN - r.height)),
    });
  }, [x, y]);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  const wrapped = items.map((item) => ({
    ...item,
    onSelect: () => {
      onClose();
      item.onSelect();
    },
  }));

  return createPortal(
    <div ref={ref} className={styles.floating} style={pos} data-no-drag="true">
      <Menu items={wrapped} label={label} autoFocus={autoFocus} />
    </div>,
    document.body,
  );
}
