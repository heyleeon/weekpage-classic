// Pill buttons (V3: buttons are capsules). ink = primary 「确定」, accent = green 「变成任务」,
// fill2 = small grey button, glass = toolbar-style, text = plain text button 「取消」「不提醒」.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";
import { cx } from "./cx";

export type ButtonVariant = "ink" | "accent" | "text" | "fill2" | "glass";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Red text (e.g. 「退出 WeekPage」); meant for the text variant. */
  danger?: boolean;
  icon?: ReactNode;
  type?: "button" | "submit";
};

export function Button({
  variant = "ink",
  size = "md",
  danger = false,
  icon,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[size],
        styles[variant],
        danger && styles.danger,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
