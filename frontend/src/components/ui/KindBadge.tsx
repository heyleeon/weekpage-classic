// Key point type badge in inline inputs (ui-spec §8.7): 我来做 / 等别人 / 检查点 (+ 「· 10/1」).
// Clicking cycles do → wait → check → do (the owner sets the new kind).

import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { useTranslation } from "react-i18next";
import { t as tr } from "@/i18n";
import { formatMD } from "@/lib/dates";
import type { KeyPointStepKind } from "@/types/domain";
import { cx } from "./cx";
import styles from "./KindBadge.module.css";

/** 我来做 / 等别人 / 检查点 in the active language (i18n `tasks.kind.*`). */
export function kindLabel(kind: KeyPointStepKind): string {
  return tr(`tasks.kind.${kind}`);
}

/** Same names as a record (kept for existing callers); every read uses the active language. */
export const KIND_LABEL: Readonly<Record<KeyPointStepKind, string>> = {
  get do() {
    return kindLabel("do");
  },
  get wait() {
    return kindLabel("wait");
  },
  get check() {
    return kindLabel("check");
  },
};

/** Next kind in the click cycle. */
export function nextKind(kind: KeyPointStepKind): KeyPointStepKind {
  return kind === "do" ? "wait" : kind === "wait" ? "check" : "do";
}

export type KindBadgeProps = {
  kind: KeyPointStepKind;
  /** Recognised date, shown as 「· 10/1」. */
  date?: string | null;
  onClick?: () => void;
};

export function KindBadge({ kind, date, onClick }: KindBadgeProps) {
  const { t } = useTranslation();
  const icon =
    kind === "do" ? (
      <CircleIcon size={10} />
    ) : kind === "wait" ? (
      <HourglassIcon size={10} />
    ) : (
      <BellIcon size={10} weight="fill" />
    );
  const content = (
    <>
      {icon}
      {t(`tasks.kind.${kind}`)}
      {date ? ` · ${formatMD(date)}` : null}
    </>
  );
  const cls = cx(styles.badge, styles[kind]);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={t("tasks.kind.cycle")}>
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}
