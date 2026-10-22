// The time headline with its day count set large (ui-spec §8.4, §10.2): 「还剩 25 天」 → words
// small in the tone's quieter shade, 「25」 big in its full colour. A sentence without a count
// (「今天截止」) is set bold whole. Same piece on the card and in the detail, one size up there.

import { countParts } from "@/lib/taskMath";
import type { TextTone, TimeBarLabel } from "@/types/domain";
import { cx } from "./cx";
import styles from "./DayCount.module.css";

const TONE: Record<TextTone, string> = {
  text: styles.text,
  muted: styles.muted,
  subtle: styles.muted,
  st: styles.st,
  du: styles.du,
  rm: styles.rm,
};

export type DayCountProps = {
  label: TimeBarLabel;
  size?: "card" | "detail";
};

export function DayCount({ label, size = "card" }: DayCountProps) {
  const parts = countParts(label.text);
  return (
    <span
      className={cx(styles.headline, styles[size], TONE[label.tone], !parts && styles.whole)}
      data-testid="time-headline"
    >
      {parts ? (
        <>
          {parts[0]}
          <span className={styles.count}>{parts[1]}</span>
          {parts[2]}
        </>
      ) : (
        label.text
      )}
    </span>
  );
}
