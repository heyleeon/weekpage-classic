// Round icon-only button, e.g. the modal close button (28, --fill-2, × --text-3).

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./IconButton.module.css";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & {
  /** Accessible name (required: the button has no text). */
  label: string;
  icon: ReactNode;
  size?: number;
  variant?: "fill2" | "plain";
};

export function IconButton({
  label,
  icon,
  size = 28,
  variant = "fill2",
  className,
  style,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(styles.button, styles[variant], className)}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      {icon}
    </button>
  );
}
