// Anchored popover panel (ui-spec §15.2): same material as the modal, no scrim.
// PopoverHost positions it next to its anchor, flips it and closes it on outside click / Esc.

import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Popover.module.css";

export type PopoverProps = {
  children: ReactNode;
  /** Panel width in px (e.g. 280 for the date picker, 340 for 「变成任务」). */
  width?: number;
  /** Accessible name. */
  label: string;
  className?: string;
};

export function Popover({ children, width, label, className }: PopoverProps) {
  return (
    <div
      role="dialog"
      aria-label={label}
      className={cx(styles.popover, className)}
      style={{ width }}
    >
      {children}
    </div>
  );
}
