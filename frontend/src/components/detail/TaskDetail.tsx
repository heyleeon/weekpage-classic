// Task detail overlay (ui-spec §10): editable title, status dropdown, archive / ⋯ / close, time
// block, key point timeline with notes, AddBar, history view, delete confirmation and the
// read-only archived variant. OverlayHost provides scrim and Esc; every change saves at once.

import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Menu } from "@/components/ui/Menu";
import { Modal } from "@/components/ui/Modal";
import { ScrollFade } from "@/components/ui/ScrollFade";
import { StatusMark } from "@/components/ui/StatusTag";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { keyPointCounts, overdueByKp } from "@/lib/keyPoint";
import { displayStatus } from "@/lib/taskMath";
import type { KeyPoint, Task, TaskStatus } from "@/types/domain";
import { AddBar } from "./AddBar";
import { Floating } from "./Floating";
import { HistoryView } from "./HistoryView";
import styles from "./TaskDetail.module.css";
import { TimeBlock } from "./TimeBlock";
import { hintRowId, Timeline, useSwipeHint } from "./Timeline";
import { requestArchive, restoreArchivedTask } from "./taskActions";

export type TaskDetailProps = {
  taskId: string;
  /** Scroll the timeline to this key point. */
  focusKeyPointId?: string;
  /** Opened from the archive page (「查看全部记录」). */
  readOnly: boolean;
};

const bySortKey = (a: KeyPoint, b: KeyPoint) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;

/** 「5 个 · 已完成 3」, or nothing with none (§10.9; notes are not key points, §10.6). */
export function kpHeadText(kps: KeyPoint[]): string {
  const { total, done } = keyPointCounts(kps);
  return total === 0 ? "" : t("detail.keyPoints.count", { count: total, done });
}

function EditableTitle({ task, readOnly }: { task: Task; readOnly: boolean }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.title);
  const cancel = () => {
    setValue(task.title);
    setEditing(false);
  };
  useEscLayer(editing, cancel, ESC_PRIORITY.inlineInput);
  const save = () => {
    const title = value.trim();
    setEditing(false);
    if (title && title !== task.title) void mutate(() => api.renameTask(task.id, title));
    else setValue(task.title);
  };
  const enter = useImeSafeEnter(save);
  if (readOnly) return <span className={styles.titleText}>{task.title}</span>;
  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: clicking the title opens the editor
        autoFocus
        className={styles.titleInput}
        value={value}
        maxLength={200}
        aria-label={t("detail.head.titleLabel")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        {...enter}
      />
    );
  }
  return (
    <button
      type="button"
      className={styles.titleButton}
      onClick={() => {
        setValue(task.title);
        setEditing(true);
      }}
    >
      {task.title}
    </button>
  );
}

function StatusDropdown({ task, today }: { task: Task; today: string }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [open, setOpen] = useState(false);
  const shown = displayStatus(task, today);
  const choose = (s: TaskStatus) => {
    setOpen(false);
    if (s !== task.status) void mutate(() => api.setTaskStatus(task.id, s));
  };
  return (
    <Floating
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      trigger={
        <button
          type="button"
          className={cx(styles.statusPill, styles[`status_${shown}`])}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <StatusMark status={shown} size="pill" />
          {t(`detail.status.${shown}`)}
          <CaretDownIcon size={10} />
        </button>
      }
    >
      <Menu
        label={t("detail.head.statusMenu")}
        autoFocus
        items={(["active", "waiting", "done"] as const).map((s) => ({
          key: s,
          label: (
            <span className={styles.menuLabel}>
              {t(`detail.status.${s}`)}
              {task.status === s && <CheckIcon size={12} className={styles.menuCheck} />}
            </span>
          ),
          icon: <StatusMark status={s} size="pill" />,
          checked: task.status === s,
          onSelect: () => choose(s),
        }))}
      />
    </Floating>
  );
}

function MoreMenu({ onHistory, onDelete }: { onHistory: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Floating
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      trigger={
        <button
          type="button"
          className={styles.moreButton}
          aria-label={t("detail.head.more")}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
        >
          <DotsThreeIcon size={16} weight="bold" />
        </button>
      }
    >
      <Menu
        label={t("detail.head.more")}
        autoFocus
        items={[
          {
            key: "history",
            label: t("detail.head.history"),
            icon: <ClockCounterClockwiseIcon size={13} />,
            onSelect: () => {
              setOpen(false);
              onHistory();
            },
          },
          {
            key: "delete",
            label: t("detail.head.deleteTask"),
            icon: <TrashIcon size={13} />,
            danger: true,
            onSelect: () => {
              setOpen(false);
              onDelete();
            },
          },
        ]}
      />
    </Floating>
  );
}

function DeleteConfirm({ task, onCancel }: { task: Task; onCancel: () => void }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const close = useUiStore((s) => s.closeOverlay);
  useEscLayer(true, onCancel, ESC_PRIORITY.inlineInput);
  const remove = async () => {
    const m = await mutate(() => api.deleteTask(task.id));
    if (m) close();
  };
  return (
    <div
      className={styles.deleteBox}
      role="alertdialog"
      aria-label={t("detail.deleteConfirm.label")}
    >
      <div className={styles.deleteTitle}>
        {t("detail.deleteConfirm.title", { title: task.title })}
      </div>
      <div className={styles.deleteText}>{t("detail.deleteConfirm.text")}</div>
      <div className={styles.deleteFoot}>
        <Button variant="text" onClick={onCancel}>
          {t("detail.deleteConfirm.keep")}
        </Button>
        <button type="button" className={styles.dangerButton} onClick={() => void remove()}>
          {t("detail.deleteConfirm.delete")}
        </button>
      </div>
    </div>
  );
}

function Missing() {
  const { t } = useTranslation();
  const close = useUiStore((s) => s.closeOverlay);
  return (
    <Modal title={t("detail.missing.title")} onClose={close} width="narrow">
      <p className={styles.missing}>{t("detail.missing.text")}</p>
    </Modal>
  );
}

export default function TaskDetail({ taskId, focusKeyPointId, readOnly }: TaskDetailProps) {
  const { t } = useTranslation();
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  const close = useUiStore((s) => s.closeOverlay);
  const [view, setView] = useState<"main" | "history" | "delete">("main");
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const scrolled = useRef(false);

  const task = snap?.tasks.find((x) => x.id === taskId) ?? null;
  const kps = useMemo(
    () => (snap ? snap.keyPoints.filter((k) => k.taskId === taskId).sort(bySortKey) : []),
    [snap, taskId],
  );
  const overdue = useMemo(
    () => (task ? overdueByKp(task, kps, today) : new Map<string, number>()),
    [task, kps, today],
  );
  // The swipe peek (§10.14) is decided once, as the detail opens: the first open key point of an
  // editable task. Kept across the history view so going back does not count again; `hint` is
  // only true while the peek plays, so going back does not peek again either.
  const hintFor = useRef<string | null | undefined>(undefined);
  if (hintFor.current === undefined && task) {
    hintFor.current = readOnly || task.archivedAt !== null ? null : hintRowId(kps);
  }
  const hint = useSwipeHint(Boolean(hintFor.current));

  // Scroll the focused key point (and flash it), else the first overdue one, else the first open
  // one, to the middle (§10.8).
  useLayoutEffect(() => {
    if (scrolled.current || view !== "main") return;
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller || !list) return;
    const target =
      focusKeyPointId ??
      kps.find((k) => overdue.has(k.id))?.id ??
      kps.find((k) => k.kind !== "note" && k.doneDate === null)?.id;
    scrolled.current = true;
    if (!target) return;
    const el = list.querySelector<HTMLElement>(`[data-kp-id="${target}"]`);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += delta - Math.max(8, (scroller.clientHeight - el.offsetHeight) / 2);
    if (focusKeyPointId) setFlashId(focusKeyPointId);
  }, [focusKeyPointId, kps, overdue, view]);

  useEffect(() => {
    if (!flashId) return;
    // Matches the flash animation in TaskDetail.module.css.
    const timer = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  if (!snap) return null;
  if (!task) return <Missing />;

  const archived = task.archivedAt !== null;
  const ro = readOnly || archived;
  const shown = displayStatus(task, today);
  const canArchive = !ro && (shown === "done" || shown === "overdue");

  const headExtra = ro ? (
    <span className={styles.archivedTag}>{t("detail.head.archived")}</span>
  ) : (
    <>
      <StatusDropdown task={task} today={today} />
      {canArchive && (
        <button
          type="button"
          className={cx(styles.archiveButton, shown === "done" && styles.archiveSolid)}
          onClick={() => void requestArchive(task, kps)}
        >
          <ArchiveIcon size={12} />
          {t("detail.head.archive")}
        </button>
      )}
      <MoreMenu onHistory={() => setView("history")} onDelete={() => setView("delete")} />
    </>
  );

  const restore = async () => {
    const m = await restoreArchivedTask(task.id);
    if (m) close();
  };

  return (
    <Modal
      title={<EditableTitle key={task.title} task={task} readOnly={ro} />}
      onClose={close}
      width="wide"
      headExtra={headExtra}
      className={styles.panel}
    >
      {view === "history" ? (
        <HistoryView taskId={task.id} onBack={() => setView("main")} />
      ) : (
        <div className={styles.content}>
          {view === "delete" && <DeleteConfirm task={task} onCancel={() => setView("main")} />}
          <TimeBlock task={task} kps={kps} today={today} readOnly={ro} />
          <div className={styles.kpHead}>
            <span className={styles.kpTitle}>{t("detail.keyPoints.title")}</span>
            <span className={styles.kpCount}>{kpHeadText(kps)}</span>
          </div>
          <ScrollFade ref={scrollRef} surface="elevated" className={styles.timelineScroll}>
            <Timeline
              ref={listRef}
              entries={kps}
              overdue={overdue}
              flashId={flashId}
              readOnly={ro}
              summary={ro ? task.summary : null}
              today={today}
              hintId={hint ? (hintFor.current ?? null) : null}
            />
          </ScrollFade>
          <div className={styles.divider} />
          {ro ? (
            <div className={styles.restoreRow}>
              {archived && (
                <Button
                  variant="glass"
                  icon={<ArrowCounterClockwiseIcon size={13} />}
                  onClick={() => void restore()}
                >
                  {t("detail.restore")}
                </Button>
              )}
            </div>
          ) : (
            <AddBar taskId={task.id} today={today} />
          )}
        </div>
      )}
    </Modal>
  );
}
