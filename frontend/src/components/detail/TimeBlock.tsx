// Detail time block (ui-spec §10.1–§10.2, §10.5): start / due chips with a range calendar,
// 「不设截止」, the day count (same piece as the card, one size up) with the other sentence quiet
// on the right, the track (fill, today tick, key point dots, due dot) and the remind toggle.

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { InfinityIcon } from "@phosphor-icons/react/dist/csr/Infinity";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { DayCount } from "@/components/ui/DayCount";
import { KeyPointMarker } from "@/components/ui/KeyPointMarker";
import { MiniCalendar } from "@/components/ui/MiniCalendar";
import { useDataStore } from "@/hooks/useDataStore";
import { api } from "@/lib/api";
import { formatMD, formatMDW } from "@/lib/dates";
import { detailTrack, dueUrgent } from "@/lib/taskMath";
import type { KeyPoint, Task, TimeBarLabel } from "@/types/domain";
import { Floating, floatingCard } from "./Floating";
import { focusEnd, pickDay, type RangeEnd, type RangeState, setNoDue } from "./rangePick";
import styles from "./TaskDetail.module.css";

/** CSS class for a derived label tone. */
export function toneClass(label: TimeBarLabel): string {
  return cx(styles[`tone_${label.tone}`], label.strong && styles.strong);
}

const MARKER_SIZE = 15;

type Props = { task: Task; kps: KeyPoint[]; today: string; readOnly: boolean };

export function TimeBlock({ task, kps, today, readOnly }: Props) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setTrackW(el.clientWidth);
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Markers only merge when they would overlap on the track.
  const view = detailTrack(task, kps, today, trackW > 0 ? (MARKER_SIZE + 2) / trackW : 0);

  const stretched = view.dueAt !== null && view.dueAt < 1;

  // A step just added / moved past the due date (of an unfinished task) offers, once, to move
  // the due date there. Opening a task that already has such steps doesn't nag.
  const [nudge, setNudge] = useState<string | null>(null);
  const seenLate = useRef(view.lateCount);
  useEffect(() => {
    const prev = seenLate.current;
    seenLate.current = view.lateCount;
    if (view.extendTo === null) setNudge(null);
    else if (view.lateCount > prev) setNudge(view.extendTo);
  }, [view.extendTo, view.lateCount]);
  const { bar } = view;
  const noDue = task.dueDate === null;
  const [editing, setEditing] = useState<RangeState | null>(null);

  const setDates = (start: string, due: string | null) =>
    mutate(() => api.setTaskDates(task.id, start, due));

  const openRange = (which: RangeEnd) => {
    if (readOnly) return;
    const base: RangeState = {
      start: task.startDate,
      end: task.dueDate,
      picking: which,
      noDue,
      provisional: false,
      untouched: false,
    };
    // Clicking the empty due chip turns the due date back on.
    setEditing(focusEnd(noDue && which === "end" ? setNoDue(base, false) : base, which));
  };

  const onPick = (d: string) => {
    if (!editing) return;
    const next = pickDay(editing, d);
    // A new start that keeps the due date valid, or a finished range, is saved right away.
    const done = next.picking === null || (editing.picking === "start" && next.end !== null);
    const noDueNow = next.noDue;
    if (noDueNow) {
      void setDates(next.start, null);
      setEditing(null);
      return;
    }
    if (done && next.end !== null) {
      void setDates(next.start, next.end);
      setEditing(null);
      return;
    }
    setEditing(next);
  };

  const fillStyle = { width: `${Math.round(bar.fill * 1000) / 10}%` };

  return (
    <section className={styles.timeBlock} aria-label={t("detail.time.label")}>
      <div className={styles.row1}>
        <CalendarBlankIcon size={15} className={styles.caption} aria-hidden />
        <Floating
          open={editing !== null}
          onClose={() => setEditing(null)}
          align="left"
          trigger={
            <span className={styles.chips}>
              <button
                type="button"
                className={cx(styles.dateChip, editing?.picking === "start" && styles.chipOn)}
                disabled={readOnly}
                onClick={() => openRange("start")}
              >
                <span className={styles.chipLabel}>{t("detail.time.start")}</span>
                <span className={styles.chipValue}>{formatMD(task.startDate)}</span>
              </button>
              <span className={styles.dueWrap}>
                <button
                  type="button"
                  className={cx(
                    styles.dateChip,
                    noDue && styles.chipEmpty,
                    editing?.picking === "end" && styles.chipOn,
                  )}
                  disabled={readOnly}
                  aria-label={
                    task.dueDate
                      ? `${t("detail.time.due")} ${formatMDW(task.dueDate)}`
                      : `${t("detail.time.due")}: ${t("detail.time.noDue")}`
                  }
                  onClick={() => openRange("end")}
                >
                  <span className={styles.chipLabel}>{t("detail.time.due")}</span>
                  {task.dueDate ? (
                    <span
                      className={cx(styles.chipValue, dueUrgent(task, today) && styles.chipDue)}
                    >
                      {formatMDW(task.dueDate)}
                    </span>
                  ) : (
                    <InfinityIcon size={14} className={styles.chipInfinity} />
                  )}
                </button>
                {!readOnly && !noDue && (
                  <button
                    type="button"
                    className={styles.dueClear}
                    aria-label={t("detail.time.noDue")}
                    title={t("detail.time.noDue")}
                    onClick={() => void setDates(task.startDate, null)}
                  >
                    <XIcon size={9} />
                  </button>
                )}
              </span>
            </span>
          }
        >
          {editing && (
            <div className={floatingCard}>
              <MiniCalendar
                today={today}
                mode="range"
                range={{ start: editing.start, end: editing.end }}
                onPick={onPick}
                color="st"
                shape="cell"
                allowPast={editing.picking === "start"}
              />
            </div>
          )}
        </Floating>
        {nudge !== null && !readOnly && (
          <span className={styles.nudge} role="status">
            <button
              type="button"
              className={styles.nudgeYes}
              onClick={() => {
                setNudge(null);
                void setDates(task.startDate, nudge);
              }}
            >
              <ArrowRightIcon size={11} weight="bold" />
              {t("detail.time.extendDue", { date: formatMD(nudge) })}
            </button>
            <button
              type="button"
              className={styles.nudgeNo}
              aria-label={t("detail.time.keepDue")}
              title={t("detail.time.keepDue")}
              onClick={() => setNudge(null)}
            >
              <XIcon size={9} />
            </button>
          </span>
        )}
        <span className={styles.spacer} />
        {view.remindDate !== null && (
          <button
            type="button"
            className={cx(styles.bellButton, task.remindDayBefore && styles.bellOn)}
            disabled={readOnly}
            aria-pressed={task.remindDayBefore}
            aria-label={t("detail.time.remindOn", { date: formatMD(view.remindDate) })}
            title={t("detail.time.remindOn", { date: formatMD(view.remindDate) })}
            onClick={() => void mutate(() => api.setTaskRemind(task.id, !task.remindDayBefore))}
          >
            <BellIcon size={14} weight={task.remindDayBefore ? "fill" : "regular"} />
            {task.remindDayBefore && <span>{formatMD(view.remindDate)}</span>}
          </button>
        )}
      </div>

      <div className={styles.row2}>
        <DayCount label={bar.headline} size="detail" />
        {bar.aside && <span className={toneClass(bar.aside)}>{bar.aside.text}</span>}
      </div>

      <div
        ref={trackRef}
        className={cx(styles.track, noDue && styles.trackOpen, stretched && styles.trackStretched)}
        style={
          stretched ? ({ "--due-at": `${(view.dueAt ?? 1) * 100}%` } as CSSProperties) : undefined
        }
        data-testid="detail-track"
      >
        {stretched && (
          <span className={styles.trackTail} style={{ left: `${(view.dueAt ?? 1) * 100}%` }} />
        )}
        <span className={cx(styles.fill, styles[`fill_${bar.fillTone}`])} style={fillStyle} />
        {view.dots.map((d) => (
          <span
            key={d.keyPointId}
            className={styles.dotWrap}
            style={{ left: `${d.at * 100}%` }}
            data-edge={d.at < 0.2 ? "start" : d.at > 0.8 ? "end" : undefined}
            role="img"
            aria-label={d.tip.replace(/\n/g, "; ")}
          >
            <span className={styles.dotMark} aria-hidden>
              <KeyPointMarker kind={d.marker} size={MARKER_SIZE} />
            </span>
            {d.count > 1 && <span className={styles.dotCount}>{d.count}</span>}
            <span className={styles.dotTip} aria-hidden>
              {d.tip}
            </span>
          </span>
        ))}
        {view.todayAt !== null && (
          <span className={styles.todayTick} style={{ left: `${view.todayAt * 100}%` }} />
        )}
        {view.dueDot && (
          <span className={styles.dueDot} style={{ left: `${(view.dueAt ?? 1) * 100}%` }} />
        )}
      </div>

      {bar.bottom ? (
        <div className={styles.row3}>
          <span className={toneClass(bar.bottom.start)}>{bar.bottom.start.text}</span>
          {/* Stretched track: the due label sits under the due dot, not at the far end. */}
          <span
            className={cx(toneClass(bar.bottom.end), stretched && styles.dueLabelAt)}
            style={
              stretched
                ? ({ "--due-at": `${(view.dueAt ?? 1) * 100}%` } as CSSProperties)
                : undefined
            }
          >
            {bar.bottom.end.text}
          </span>
        </div>
      ) : (
        <div className={styles.row3}>
          <span className={styles.tone_muted}>
            {t("timeBar.start", { date: formatMD(task.startDate) })}
          </span>
        </div>
      )}
    </section>
  );
}
