// One archive row (ui-spec §14.3, §14.5–§14.6). Task rows with key points or a summary expand
// into a block with the horizontal key point timeline, the summary quote and the actions.

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretUpIcon } from "@phosphor-icons/react/dist/csr/CaretUp";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { useUiStore } from "@/hooks/useUiStore";
import { archiveMeta } from "@/lib/archive";
import { formatMD } from "@/lib/dates";
import type { ArchiveEntry, KeyPoint } from "@/types/domain";
import { restoreArchivedTask, restoreArchivedTodo } from "../detail/taskActions";
import styles from "./ArchivePage.module.css";

/** Splits `text` around case-insensitive hits of `q`; hits are wrapped in <mark>. */
export function highlight(text: string, q: string): ReactNode {
  const needle = q.trim().toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let from = 0;
  let i = lower.indexOf(needle, from);
  while (i >= 0) {
    if (i > from) out.push(<Fragment key={`t${from}`}>{text.slice(from, i)}</Fragment>);
    out.push(
      <mark key={`m${i}`} className={styles.hit}>
        {text.slice(i, i + needle.length)}
      </mark>,
    );
    from = i + needle.length;
    i = lower.indexOf(needle, from);
  }
  if (out.length === 0) return text;
  if (from < text.length) out.push(<Fragment key={`t${from}`}>{text.slice(from)}</Fragment>);
  return out;
}

function nodeTone(kp: KeyPoint): string {
  if (kp.kind === "note") return kp.who === "me" ? styles.nodeMe : styles.nodeThem;
  return kp.doneDate !== null ? styles.nodeDone : styles.nodeOpen;
}

function KPTimeline({ kps, query }: { kps: KeyPoint[]; query: string }) {
  const { t } = useTranslation();
  const n = kps.length;
  return (
    <div className={styles.kpScroll}>
      <div
        className={styles.kpTimeline}
        style={{ gridTemplateColumns: `repeat(${n}, minmax(${n > 8 ? 88 : 0}px, 1fr))` }}
      >
        {n > 1 && (
          <div
            className={styles.kpLine}
            style={{ left: `${50 / n}%`, right: `${50 / n}%` }}
            aria-hidden
          />
        )}
        {kps.map((k) => {
          // The archive tells what happened: a ticked step shows its real day,
          // the detail timeline keeps the planned date first (§10.2).
          const d = k.kind !== "note" && k.doneDate ? k.doneDate : k.date;
          const text =
            k.kind === "note"
              ? t("archive.row.note", {
                  who: t(k.who === "me" ? "detail.who.me" : "detail.who.them"),
                  text: k.text,
                })
              : k.text;
          return (
            <div key={k.id} className={styles.kpNode} title={text}>
              <span className={cx(styles.node, nodeTone(k))} />
              <span className={styles.nodeDate}>{d ? formatMD(d) : ""}</span>
              <span className={styles.nodeText}>{highlight(text, query)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  entry: ArchiveEntry;
  query: string;
  expanded: boolean;
  onToggle: () => void;
};

export function ArchiveRow({ entry, query, expanded, onToggle }: Props) {
  const { t } = useTranslation();
  const openOverlay = useUiStore((s) => s.openOverlay);
  const isTask = entry.kind === "task";
  const summary = isTask ? entry.task.summary : null;
  const kps = isTask ? entry.keyPoints : [];
  const expandable = isTask && (kps.length > 0 || !!summary);
  const open = expandable && expanded;

  const restore = () => {
    if (entry.kind === "task") void restoreArchivedTask(entry.id);
    else void restoreArchivedTodo(entry.id);
  };

  const head = (
    <div className={styles.rowHead}>
      <button
        type="button"
        className={cx(styles.rowMain, !expandable && styles.rowStatic)}
        aria-expanded={expandable ? open : undefined}
        tabIndex={expandable ? 0 : -1}
        onClick={expandable ? onToggle : undefined}
      >
        <CheckCircleIcon size={16} className={styles.doneIcon} />
        <span className={cx(styles.typeChip, isTask ? styles.typeTask : styles.typeTodo)}>
          {t(isTask ? "archive.row.task" : "archive.row.todo")}
        </span>
        <span className={cx(styles.rowTitle, open && styles.rowTitleOpen)}>
          {highlight(entry.title, query)}
        </span>
        <span className={styles.meta}>{archiveMeta(entry)}</span>
        {open && <CaretUpIcon size={12} className={styles.rowCaret} />}
      </button>
      {!open && (
        <button type="button" className={styles.restore} onClick={restore}>
          <ArrowCounterClockwiseIcon size={12} />
          {t("archive.row.restore")}
        </button>
      )}
    </div>
  );

  if (!open || entry.kind !== "task") {
    return (
      <div className={styles.row} data-entry-id={entry.id}>
        {head}
      </div>
    );
  }

  return (
    <div className={styles.expanded} data-entry-id={entry.id}>
      {head}
      {kps.length > 0 && <KPTimeline kps={kps} query={query} />}
      {summary && (
        <div className={styles.quote}>
          <QuotesIcon size={14} weight="fill" className={styles.quoteIcon} />
          <span>{highlight(summary, query)}</span>
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={() => openOverlay({ kind: "taskDetail", taskId: entry.id, readOnly: true })}
        >
          <ClockCounterClockwiseIcon size={14} />
          {t("archive.row.viewAll")}
        </button>
        <button type="button" className={styles.action} onClick={restore}>
          <ArrowCounterClockwiseIcon size={14} />
          {t("archive.row.restoreToTasks")}
        </button>
      </div>
    </div>
  );
}
