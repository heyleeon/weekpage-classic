// Preview line inside a step input (ui-spec §10.6, §8.7): 「↳ 12/2 周三 续签证书」, the step as it
// will be saved once the typed date is cut out. Same look as the calendar input's line (§2.6):
// faint arrow, the date in --ev-text, the words muted; only a date → 「还差内容」 in faint.

import { useTranslation } from "react-i18next";
import { formatMDW } from "@/lib/dates";
import { cx } from "./cx";
import styles from "./StepPreview.module.css";

export type StepPreviewProps = {
  date: string;
  /** Saved text ("" = only a date was typed). */
  text: string;
  className?: string;
};

export function StepPreview({ date, text, className }: StepPreviewProps) {
  const { t } = useTranslation();
  return (
    <span className={cx(styles.preview, className)} data-testid="step-preview">
      <span className={styles.arrow}>↳</span> <span className={styles.date}>{formatMDW(date)}</span>{" "}
      {text ? (
        <span className={styles.text}>{text}</span>
      ) : (
        <span className={styles.faint}>{t("ui.stepPreview.noText")}</span>
      )}
    </span>
  );
}
