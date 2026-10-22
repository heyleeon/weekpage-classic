// Archive confirmation (ui-spec §13): four numbers (used days / key points / waiting / vs due),
// the overdue-unfinished variant (§13.4), what happens after archiving, an optional one-line
// summary (auto focused, Enter = archive) and the undo toast.

import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { CalendarXIcon } from "@phosphor-icons/react/dist/csr/CalendarX";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeSlashIcon } from "@phosphor-icons/react/dist/csr/EyeSlash";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Modal } from "@/components/ui/Modal";
import { useDataStore } from "@/hooks/useDataStore";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { diffDays } from "@/lib/dates";
import { keyPointCounts } from "@/lib/keyPoint";
import { displayStatus, dueDelta, usedDays, waitingDays } from "@/lib/taskMath";
import type { KeyPoint, Task } from "@/types/domain";
import styles from "./ArchiveConfirm.module.css";
import { archivedToast } from "./taskActions";

export type ArchiveConfirmProps = { taskId: string };

export type StatTile = { value: string; label: string; tone: "text" | "st" | "du" };

/** The stat tiles of §13.3 (done) or §13.4 (archived while overdue and unfinished). */
export function archiveTiles(task: Task, kps: KeyPoint[], today: string): StatTile[] {
  const own = kps.filter((k) => k.taskId === task.id);
  const { total, done } = keyPointCounts(own);
  const days = (count: number) => t("detail.archiveConfirm.tile.days", { count });
  if (task.status !== "done") {
    const tiles: StatTile[] = [
      {
        value: days(diffDays(task.startDate, today) + 1),
        label: t("detail.archiveConfirm.tile.elapsed"),
        tone: "text",
      },
      {
        value: `${done} / ${total}`,
        label: t("detail.archiveConfirm.tile.keyPointsLabel"),
        tone: "text",
      },
    ];
    if (task.dueDate !== null && today > task.dueDate) {
      tiles.push({
        value: days(diffDays(task.dueDate, today)),
        label: t("detail.archiveConfirm.tile.pastDue"),
        tone: "du",
      });
    }
    return tiles;
  }
  const tiles: StatTile[] = [
    { value: days(usedDays(task)), label: t("detail.archiveConfirm.tile.used"), tone: "text" },
    {
      value: t("detail.archiveConfirm.tile.keyPoints", { count: total }),
      label: t("detail.archiveConfirm.tile.keyPointsLabel"),
      tone: "text",
    },
  ];
  const waiting = waitingDays(task, own, today);
  if (waiting > 0) {
    tiles.push({
      value: days(waiting),
      label: t("detail.archiveConfirm.tile.waiting"),
      tone: "text",
    });
  }
  const delta = dueDelta(task);
  if (delta) {
    const label = t("detail.archiveConfirm.tile.vsDue");
    tiles.push(
      delta.kind === "early"
        ? { value: t("detail.archiveConfirm.tile.early", { count: delta.days }), label, tone: "st" }
        : delta.kind === "onTime"
          ? { value: t("detail.archiveConfirm.tile.onTime"), label, tone: "st" }
          : {
              value: t("detail.archiveConfirm.tile.late", { count: delta.days }),
              label,
              tone: "du",
            },
    );
  }
  return tiles;
}

export default function ArchiveConfirm({ taskId }: ArchiveConfirmProps) {
  const { t } = useTranslation();
  const close = useUiStore((s) => s.closeOverlay);
  const snap = useDataStore((s) => s.snap);
  const mutate = useDataStore((s) => s.mutate);
  const today = useToday();
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const task = snap?.tasks.find((x) => x.id === taskId) ?? null;

  const archive = async () => {
    if (!task || busy) return;
    setBusy(true);
    const text = summary.trim();
    close();
    await mutate(() => api.archiveTask(task.id, text ? text : null), {
      toast: archivedToast(task.title),
    });
  };
  const enter = useImeSafeEnter(() => void archive());

  if (!snap || !task) return null;
  const unfinished = task.status !== "done";
  const tiles = archiveTiles(task, snap.keyPoints, today);
  const overdue = displayStatus(task, today) === "overdue";

  return (
    <Modal
      width="narrow"
      onClose={close}
      hideClose
      className={styles.panel}
      title={
        <span className={styles.titleRow}>
          <span className={styles.iconTile}>
            <ArchiveIcon size={16} />
          </span>
          <span className={styles.titleText}>
            <span className={styles.title}>
              {t("detail.archiveConfirm.title", { title: task.title })}
            </span>
            <span className={styles.subtitle}>
              {unfinished && overdue
                ? t("detail.archiveConfirm.subtitleUnfinished")
                : t("detail.archiveConfirm.subtitleDone")}
            </span>
          </span>
        </span>
      }
      footer={
        <span className={styles.foot}>
          <Button variant="text" onClick={close}>
            {t("detail.archiveConfirm.keep")}
          </Button>
          <Button
            variant="accent"
            icon={<ArchiveIcon size={14} />}
            disabled={busy}
            onClick={() => void archive()}
          >
            {t("detail.archiveConfirm.archive")}
          </Button>
        </span>
      }
    >
      <div className={styles.tiles} data-testid="archive-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className={styles.tile}>
            <span className={cx(styles.tileValue, styles[`tone_${tile.tone}`])}>{tile.value}</span>
            <span className={styles.tileLabel}>{tile.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.after}>
        <div className={styles.caption}>{t("detail.archiveConfirm.after")}</div>
        <ul className={styles.afterList}>
          <li>
            <EyeSlashIcon size={14} />
            {t("detail.archiveConfirm.afterHidden")}
          </li>
          <li>
            <ClockCounterClockwiseIcon size={14} />
            {t("detail.archiveConfirm.afterKept")}
          </li>
          <li>
            <CalendarXIcon size={14} />
            {t("detail.archiveConfirm.afterCalendar")}
          </li>
        </ul>
      </div>

      <label className={styles.summary}>
        <span className={styles.caption}>{t("detail.archiveConfirm.summaryLabel")}</span>
        <input
          ref={inputRef}
          className={styles.summaryInput}
          value={summary}
          maxLength={100}
          placeholder={t("detail.archiveConfirm.summaryPlaceholder")}
          onChange={(e) => setSummary(e.target.value)}
          {...enter}
        />
      </label>
    </Modal>
  );
}
