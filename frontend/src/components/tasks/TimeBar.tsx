// Card time bar (ui-spec §8.4): one line — the headline with its day count set large (「还剩
// 25 天」) on the left, always in the same place so a glance down a column finds it; the bare
// date range (「9/24 – 10/31」, ∞ without a due date) small on the right — then the track across
// the full width. Both full sentences (「今天 · 第 2 / 4 天」「还剩 2 天」) are the tip and the
// accessible name. Texts, ends and fill come from lib/taskMath timeBar().

import { InfinityIcon } from "@phosphor-icons/react/dist/csr/Infinity";
import { cx } from "@/components/ui/cx";
import { DayCount } from "@/components/ui/DayCount";
import { Tip } from "@/components/ui/Tip";
import type { TimeBarView } from "@/types/domain";
import styles from "./TimeBar.module.css";

/** What the bar says in words: 「今天 · 第 2 / 4 天\n还剩 2 天」. */
export function timeBarWords(view: TimeBarView): string {
  return [view.topLeft.text, view.topRight?.text].filter(Boolean).join("\n");
}

export function TimeBar({ view }: { view: TimeBarView }) {
  const words = timeBarWords(view);
  const open = view.ends.due === null;
  return (
    <Tip text={words}>
      <div className={styles.block} role="img" aria-label={words.replace(/\n/g, " · ")}>
        <div className={styles.head}>
          <DayCount label={view.headline} />
          <span className={styles.range}>
            {view.ends.start}
            <span className={styles.dash}>–</span>
            {open ? <InfinityIcon size={12} className={styles.infinity} /> : view.ends.due}
          </span>
        </div>
        <div className={cx(styles.track, open && styles.trackOpen)}>
          {view.fillTone !== "none" && view.fill > 0 && (
            <div
              className={cx(styles.fill, styles[`fill_${view.fillTone}`])}
              style={{ width: `${Math.min(100, Math.max(0, view.fill * 100))}%` }}
              data-testid="time-fill"
            />
          )}
        </div>
      </div>
    </Tip>
  );
}
