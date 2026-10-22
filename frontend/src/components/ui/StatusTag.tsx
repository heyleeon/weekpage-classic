// Task status pill (ui-spec §8.3). Clicking it opens the status menu (owner decides).

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CircleDashedIcon } from "@phosphor-icons/react/dist/csr/CircleDashed";
import { ExclamationMarkIcon } from "@phosphor-icons/react/dist/csr/ExclamationMark";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { t as tr } from "@/i18n";
import type { DisplayStatus } from "@/types/domain";
import { cx } from "./cx";
import styles from "./StatusTag.module.css";

/** 推进中 / 等待中 / 未开始 / 逾期 / 已完成 in the active language (i18n `tasks.status.*`). */
export function statusLabel(status: DisplayStatus): string {
  return tr(`tasks.status.${status}`);
}

/**
 * Same names as a record (kept for existing callers): every read resolves in the language active
 * at that moment. Prefer statusLabel() in new code.
 */
export const STATUS_LABEL: Readonly<Record<DisplayStatus, string>> = {
  get active() {
    return statusLabel("active");
  },
  get waiting() {
    return statusLabel("waiting");
  },
  get upcoming() {
    return statusLabel("upcoming");
  },
  get overdue() {
    return statusLabel("overdue");
  },
  get done() {
    return statusLabel("done");
  },
};

/**
 * The status mark (ui-spec §8.3) speaks the step markers' language: a ring in the status colour —
 * half filled while 推进中, the hourglass while 等待中, dashed before it starts — and a solid disc
 * once it is settled: red 「!」 for 逾期, green ✓ for 已完成. `card` = 20 (the card's title row),
 * `pill` = 14 (next to a name: the detail's status pill, status menus, the text tag).
 */
export function StatusMark({
  status,
  size = "card",
}: {
  status: DisplayStatus;
  size?: "card" | "pill";
}) {
  const k = size === "card" ? 1 : 0.7;
  const px = (n: number) => Math.round(n * k);
  const glyph: Record<DisplayStatus, ReactNode> = {
    active: <span className={styles.pie} />,
    waiting: <HourglassIcon size={px(11)} weight="bold" />,
    upcoming: <CircleDashedIcon size={px(24)} weight="bold" />,
    overdue: <ExclamationMarkIcon size={px(13)} weight="bold" />,
    done: <CheckIcon size={px(12)} weight="bold" />,
  };
  return (
    <span className={cx(styles.mark, styles[`mark_${size}`], styles[`m_${status}`])} aria-hidden>
      {glyph[status]}
    </span>
  );
}

export type StatusTagProps = {
  status: DisplayStatus;
  onClick?: () => void;
  className?: string;
  /** Icon only (task cards, §8.3): the 20 mark in a 26 hit area; the name is the accessible name
   *  / a tip. */
  iconOnly?: boolean;
};

export function StatusTag({ status, onClick, className, iconOnly = false }: StatusTagProps) {
  const { t } = useTranslation();
  const name = t(`tasks.status.${status}`);
  const cls = cx(styles.tag, styles[status], iconOnly && styles.iconOnly, className);
  const content = iconOnly ? (
    <StatusMark status={status} />
  ) : (
    <>
      <StatusMark status={status} size="pill" />
      {name}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      aria-haspopup="menu"
      aria-label={iconOnly ? name : undefined}
    >
      {content}
    </button>
  ) : iconOnly ? (
    <span className={cls} role="img" aria-label={name}>
      {content}
    </span>
  ) : (
    <span className={cls}>{content}</span>
  );
}
