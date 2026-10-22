// Task card (ui-spec §8): title row (「⚠ N」 when steps are overdue, §9.3; the status icon →
// status menu; archive icon when overdue / done), time bar, key point list (≤ 7 rows, scrolls),
// inline 「+ 关键点」, footer (✓ a/b, + icon). Words live in tips (§8.1): icons, place and colour
// carry the card. Same component for short cards (no key points) and tall cards. Click on blank /
// title / time bar = detail.

import { ArchiveIcon } from "@phosphor-icons/react/dist/csr/Archive";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrayArrowDownIcon } from "@phosphor-icons/react/dist/csr/TrayArrowDown";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { requestArchive } from "@/components/detail/taskActions";
import { cx } from "@/components/ui/cx";
import { StatusMark, StatusTag, statusLabel } from "@/components/ui/StatusTag";
import { Tip } from "@/components/ui/Tip";
import { useDataStore } from "@/hooks/useDataStore";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { keyPointCounts, overdueByKp } from "@/lib/keyPoint";
import { displayStatus, timeBar } from "@/lib/taskMath";
import type { KeyPoint, Task, TaskStatus } from "@/types/domain";
import { FloatingMenu } from "./FloatingMenu";
import { isInteractiveTarget, useHighlightFor } from "./helpers";
import { InlineAddKeyPoint } from "./InlineAddKeyPoint";
import { KeyPointList } from "./KeyPointList";
import styles from "./TaskCard.module.css";
import { TimeBar } from "./TimeBar";
import { CARD_MOVE_MS } from "./useCardFlip";

export type TaskCardProps = {
  task: Task;
  /** This task's key points and notes (any order). */
  keyPoints: KeyPoint[];
  today: string;
  /** Drag overlay copy. */
  overlay?: boolean;
  /** Drop frame left in place while the card is dragged. */
  placeholder?: boolean;
  style?: CSSProperties;
  dragProps?: HTMLAttributes<HTMLDivElement>;
};

/** Status menu entries (labels: StatusTag's names). */
const STATUS_ITEMS: TaskStatus[] = ["active", "waiting", "done"];

const bySortKey = (a: KeyPoint, b: KeyPoint) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(function TaskCard(
  { task, keyPoints, today, overlay = false, placeholder = false, style, dragProps },
  ref,
) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const highlight = useHighlightFor(task.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const tagRef = useRef<HTMLSpanElement>(null);

  const status = displayStatus(task, today);
  // Key points and notes in timeline order (notes show on the card since 2026-10-02, ui-spec
  // §8.6); counts and progress are about the key points only.
  const entries = [...keyPoints].sort(bySortKey);
  const steps = entries.filter((k) => k.kind !== "note");
  const overdue = overdueByKp(task, keyPoints, today);
  const counts = keyPointCounts(steps);
  const tall = entries.length > 0;
  const done = status === "done";

  const openDetail = () => openOverlay({ kind: "taskDetail", taskId: task.id });

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (overlay || placeholder || isInteractiveTarget(e.target, e.currentTarget)) return;
    openDetail();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      openDetail();
    }
  };

  const openMenu = () => {
    const r = tagRef.current?.getBoundingClientRect();
    if (r) setMenu({ x: r.left, y: r.bottom + 6 });
  };

  // Shared with the detail head: key points → confirmation, none → archive + undo toast.
  // Without key points the card first collapses over 200ms (§8.8), then leaves the board.
  const cardEl = useRef<HTMLDivElement | null>(null);
  const setCardEl = useCallback(
    (el: HTMLDivElement | null) => {
      cardEl.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const archive = () => {
    const el = cardEl.current;
    const direct = keyPointCounts(steps).total === 0;
    if (!direct || overlay || !el || typeof el.animate !== "function") {
      void requestArchive(task, keyPoints);
      return;
    }
    el.dataset.collapsing = "true";
    const h = el.getBoundingClientRect().height;
    const anim = el.animate(
      [
        { height: `${h}px`, opacity: 1, marginBottom: "0px" },
        {
          height: "0px",
          opacity: 0,
          paddingTop: "0px",
          paddingBottom: "0px",
          borderWidth: "0px",
          // The column gap (14) goes with it.
          marginBottom: "-14px",
        },
      ],
      { duration: CARD_MOVE_MS, easing: "ease-out", fill: "forwards" },
    );
    el.style.overflow = "hidden";
    const restore = () => {
      anim.cancel();
      el.style.overflow = "";
      delete el.dataset.collapsing;
    };
    // A timer rather than anim.finished: a hidden window never finishes animations.
    new Promise((resolve) => window.setTimeout(resolve, CARD_MOVE_MS))
      .then(() => requestArchive(task, keyPoints))
      .then(() => {
        const t = useDataStore.getState().snap?.tasks.find((x) => x.id === task.id);
        // Still on the board (the archive failed): show the card again.
        if (t && t.archivedAt === null) restore();
      })
      .catch(restore);
  };

  const startAdding = () => setAdding(true);

  const progress = { done: counts.done, total: counts.total };
  const allDone = counts.total > 0 && counts.done === counts.total;
  const progressWords = t(done && allDone ? "tasks.card.allDone" : "tasks.card.progress", progress);
  const fromInbox = highlight?.reason === "fromInbox";
  const showFooter = !(done && !tall);
  const addLabel = t("tasks.addStep.label");
  const archiveLabel = t("tasks.card.archive");
  const overdueWords = t("tasks.card.overdue", { count: overdue.size });

  return (
    // biome-ignore lint/a11y/useSemanticElements: a card that is also a drag source
    <div
      ref={setCardEl}
      style={style}
      role="group"
      aria-label={task.title}
      tabIndex={overlay ? -1 : 0}
      data-task-id={task.id}
      data-status={status}
      className={cx(
        styles.card,
        styles[status],
        adding && styles.adding,
        highlight && styles.highlight,
        highlight?.fading && styles.highlightFading,
        overlay && styles.overlay,
        placeholder && styles.placeholder,
      )}
      onClick={onClick}
      onKeyDown={onKeyDown}
      {...dragProps}
    >
      <div className={styles.titleRow}>
        <h3 className={styles.title}>{task.title}</h3>
        <div className={styles.actions}>
          {overdue.size > 0 && (
            <Tip text={overdueWords}>
              <span className={styles.overdueSteps} role="img" aria-label={overdueWords}>
                <WarningCircleIcon size={11} weight="bold" aria-hidden="true" />
                {overdue.size}
              </span>
            </Tip>
          )}
          <span ref={tagRef} className={styles.tagWrap}>
            <Tip text={statusLabel(status)}>
              <StatusTag status={status} iconOnly onClick={overlay ? undefined : openMenu} />
            </Tip>
          </span>
          {(status === "overdue" || done) && (
            <Tip text={archiveLabel}>
              <button
                type="button"
                className={cx(styles.archive, done && styles.archiveDone)}
                onClick={archive}
                tabIndex={overlay ? -1 : undefined}
                aria-label={archiveLabel}
              >
                <ArchiveIcon size={12} />
              </button>
            </Tip>
          )}
        </div>
      </div>
      <TimeBar view={timeBar(task, keyPoints, today)} />
      {tall && (
        <div className={styles.kps}>
          <KeyPointList
            taskId={task.id}
            entries={entries}
            overdue={overdue}
            flashId={flashId}
            inert={overlay}
          />
        </div>
      )}
      {adding && (
        <InlineAddKeyPoint
          taskId={task.id}
          onAdded={(id) => setFlashId(id)}
          onClose={() => setAdding(false)}
          standalone={!tall}
        />
      )}
      {/* A done short card drops 「+ 关键点」 (§8.5) but keeps the footer's room, so its height
          matches the other short cards in the row (v2/04-1). */}
      {!showFooter && <div className={styles.footer} aria-hidden="true" />}
      {showFooter && (
        <div className={cx(styles.footer, adding && styles.footerSplit)}>
          {tall && (
            <Tip text={progressWords}>
              <span
                className={cx(styles.progress, allDone && styles.progressAll)}
                role="img"
                aria-label={progressWords}
              >
                <CheckIcon size={11} weight="bold" aria-hidden="true" />
                {counts.done}/{counts.total}
              </span>
            </Tip>
          )}
          {fromInbox && (
            <Tip text={t("tasks.card.fromInbox")}>
              <span className={styles.fromInbox} role="img" aria-label={t("tasks.card.fromInbox")}>
                <TrayArrowDownIcon size={12} weight="bold" aria-hidden="true" />
              </span>
            </Tip>
          )}
          {!done && (
            <Tip text={addLabel}>
              <button
                type="button"
                className={styles.addKp}
                onClick={startAdding}
                tabIndex={overlay ? -1 : undefined}
                aria-label={addLabel}
              >
                <PlusIcon size={12} weight="bold" />
              </button>
            </Tip>
          )}
        </div>
      )}
      {menu && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          label={t("tasks.card.statusMenu")}
          onClose={() => setMenu(null)}
          items={STATUS_ITEMS.map((s) => ({
            key: s,
            label: t(`tasks.status.${s}`),
            icon: <StatusMark status={s} size="pill" />,
            checked: task.status === s,
            onSelect: () => {
              if (task.status !== s) void mutate(() => api.setTaskStatus(task.id, s));
            },
          }))}
        />
      )}
    </div>
  );
});
