// Key point rows of a card (ui-spec §8.6, §9): key points and notes (记一笔, since 2026-10-02) in
// timeline order; at most 7 rows visible (KP_ROWS_MAX), the rest scroll inside the card with
// fades; on mount the first overdue step (§9.3; else the first open one) is scrolled to the
// middle. Overdue rows: red 「!」 marker and the step's date in red at the end (「逾期 N 天」 is
// the row's tip). A note's date, and a dated step's (cardRowDate), sits at the row's end. Rows
// never start a card drag.
// A step changes only in the detail (features.cardStepActions off, 2026-10-06): a click anywhere
// on the row, marker included, opens the detail scrolled to it; no swipes, no Delete. With the
// switch on: marker click or a swipe to the right = tick / untick, a swipe to the left = delete
// button (§10.14), and notes (static marker, no right swipe) can be swiped away too.

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { KeyPointMarker } from "@/components/ui/KeyPointMarker";
import { ScrollFade } from "@/components/ui/ScrollFade";
import { SWIPE_DELETE_KEYS, SwipeRow } from "@/components/ui/SwipeRow";
import { Tip } from "@/components/ui/Tip";
import { useDataStore } from "@/hooks/useDataStore";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { KP_ROW_H, KP_ROWS_MAX } from "@/lib/board";
import { formatMD } from "@/lib/dates";
import { features } from "@/lib/features";
import { cardRowDate, markerOf } from "@/lib/keyPoint";
import type { KeyPoint } from "@/types/domain";
import styles from "./KeyPointList.module.css";

export type KeyPointListProps = {
  taskId: string;
  /** Key points and notes in timeline order. */
  entries: KeyPoint[];
  /** Overdue steps → days past their date (lib/keyPoint.ts overdueByKp). */
  overdue: Map<string, number>;
  /** Just added: flashes --ev-soft and is scrolled into view. */
  flashId?: string | null;
  /** Static copy (drag overlay). */
  inert?: boolean;
};

const VIEW_H = KP_ROW_H * KP_ROWS_MAX;

export function KeyPointList({ taskId, entries, overdue, flashId, inert }: KeyPointListProps) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const today = useToday();
  const scroller = useRef<HTMLDivElement>(null);
  const scrolls = entries.length > KP_ROWS_MAX;

  // Default position: first overdue (else first open) row in the middle (ui-spec §8.6).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount / when scrolling starts
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !scrolls) return;
    let i = entries.findIndex((k) => overdue.has(k.id));
    if (i < 0) i = entries.findIndex((k) => k.kind !== "note" && k.doneDate === null);
    if (i < 0) i = entries.length - 1;
    el.scrollTop = Math.max(0, i * KP_ROW_H - (VIEW_H - KP_ROW_H) / 2);
  }, [scrolls]);

  useLayoutEffect(() => {
    if (!flashId || !scroller.current) return;
    const row = scroller.current.querySelector<HTMLElement>(`[data-kp-id="${flashId}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [flashId]);

  /** Ticking / deleting right on the card (off: the detail is the only place to change a step). */
  const actions = !inert && features.cardStepActions;
  const rows = entries.map((kp) => {
    const note = kp.kind === "note";
    const late = overdue.get(kp.id) ?? 0;
    const done = kp.doneDate !== null;
    const rowDate = cardRowDate(kp, late > 0, today);
    /** 「逾期 2 天」: the tip of an overdue row, whose end shows its date in red. */
    const lateWords = late > 0 ? t("tasks.card.late", { count: late }) : "";
    const toggle = () => void mutate(() => api.setKeyPointDone(kp.id, !done));
    const remove = () =>
      void mutate(() => api.deleteKeyPoint(kp.id), {
        toast: {
          text: note
            ? t("detail.timeline.deletedNote")
            : t("detail.timeline.deleted", { text: kp.text }),
        },
      });
    return (
      <div key={kp.id} className={styles.item} data-kp-id={kp.id} data-no-drag>
        <SwipeRow
          compact
          className={styles.swipe}
          surfaceClassName={cx(styles.row, kp.id === flashId && styles.flash)}
          right={
            !actions || note
              ? null
              : {
                  label: t(done ? "tasks.card.swipeUndo" : "tasks.card.swipeDone"),
                  icon: done ? (
                    <ArrowCounterClockwiseIcon size={12} weight="bold" />
                  ) : (
                    <CheckIcon size={12} weight="bold" />
                  ),
                  tone: done ? "muted" : "st",
                  run: toggle,
                }
          }
          onDelete={actions ? remove : null}
          deleteLabel={t("tasks.card.delete")}
        >
          {note ? (
            <KeyPointMarker kind={kp.who === "me" ? "noteMe" : "noteThem"} />
          ) : (
            <KeyPointMarker
              kind={markerOf(kp, late > 0)}
              label={
                !actions
                  ? undefined
                  : done
                    ? t("tasks.card.untick", { text: kp.text })
                    : t("tasks.card.tick", { text: kp.text })
              }
              onClick={actions ? toggle : undefined}
              keyShortcuts={actions ? SWIPE_DELETE_KEYS : undefined}
            />
          )}
          <Tip text={lateWords}>
            <button
              type="button"
              className={cx(
                styles.text,
                done ? styles.textDone : styles.textOpen,
                !actions && !inert && styles.wholeRow,
              )}
              tabIndex={inert ? -1 : undefined}
              aria-label={late > 0 ? `${kp.text} · ${lateWords}` : undefined}
              aria-keyshortcuts={actions ? SWIPE_DELETE_KEYS : undefined}
              onClick={() => openOverlay({ kind: "taskDetail", taskId, focusKeyPointId: kp.id })}
            >
              {kp.text}
            </button>
          </Tip>
          {late > 0 && kp.date && <span className={styles.late}>{formatMD(kp.date)}</span>}
          {rowDate && <span className={styles.date}>{formatMD(rowDate)}</span>}
        </SwipeRow>
      </div>
    );
  });

  if (!scrolls) return <div className={styles.list}>{rows}</div>;
  return (
    <ScrollFade ref={scroller} surface="card" maxHeight={VIEW_H} className={styles.scroll}>
      <div className={styles.list}>{rows}</div>
    </ScrollFade>
  );
}
