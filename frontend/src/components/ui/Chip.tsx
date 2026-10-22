// Small tag (h 20, radius 6, 11px): todo reminder tags, archive type labels, timeline type labels.

import type { ReactNode } from "react";
import type { Tone } from "@/types/domain";
import styles from "./Chip.module.css";
import { cx } from "./cx";

export type ChipProps = {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  /** Makes the chip a button (e.g. click a reminder tag to edit it). */
  onClick?: () => void;
  title?: string;
  className?: string;
};

export function Chip({ tone = "neutral", icon, children, onClick, title, className }: ChipProps) {
  const cls = cx(styles.chip, styles[tone], className);
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} title={title}>
        {icon}
        {children}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {icon}
      {children}
    </span>
  );
}
