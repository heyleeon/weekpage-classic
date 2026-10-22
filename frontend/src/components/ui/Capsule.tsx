// Glass capsule with segments (ui-spec §1.3): toolbar page switch, archive filter, settings
// choices (weeks, first row, theme, language). Selected segment = white inner pill (--capsule-on).

import type { ReactNode } from "react";
import styles from "./Capsule.module.css";
import { cx } from "./cx";

export type CapsuleProps = {
  children: ReactNode;
  /** Accessible name of the group, e.g. 「页面」. */
  label: string;
  /** md = toolbar (35), sm = settings / compact (30). */
  size?: "md" | "sm";
  className?: string;
};

export function Capsule({ children, label, size = "md", className }: CapsuleProps) {
  return (
    <fieldset
      aria-label={label}
      className={cx(styles.capsule, size === "sm" && styles.sm, className)}
    >
      {children}
    </fieldset>
  );
}

export type CapsuleSegmentProps = {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Shortcut hint after the label, e.g. 「⌘1」 (10px --text-faint). */
  hint?: string;
  /** Count after the label, e.g. 「全部 12」 (12px --text-muted). */
  count?: number;
  /** Round 29×29 button (‹ / ›). */
  round?: boolean;
  disabled?: boolean;
  /** Accessible name when the content is an icon. */
  ariaLabel?: string;
  className?: string;
};

export function CapsuleSegment({
  children,
  selected = false,
  onClick,
  hint,
  count,
  round = false,
  disabled = false,
  ariaLabel,
  className,
}: CapsuleSegmentProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cx(styles.segment, selected && styles.selected, round && styles.round, className)}
    >
      {children}
      {count !== undefined && <span className={styles.count}>{count}</span>}
      {hint && <span className={styles.hint}>{hint}</span>}
    </button>
  );
}
