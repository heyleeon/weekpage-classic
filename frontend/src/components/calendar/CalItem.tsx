// One calendar item (ui-spec §2.5): [icon column 10] 6 [title, wraps] [time, first line, right].
// Five kinds → four looks; done = 0.45 + strike-through; past days fade unless overdue (an
// overdue due, or an overdue checkpoint, which turns red with a warning icon: ui-spec §9.3).

import { useDraggable } from "@dnd-kit/core";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CircleIcon } from "@phosphor-icons/react/dist/csr/Circle";
import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { forwardRef, type HTMLAttributes, type MouseEvent } from "react";
import { cx } from "@/components/ui/cx";
import type { CalItem, CalKind } from "@/types/domain";
import styles from "./CalItem.module.css";

const KIND_CLASS: Record<CalKind, string> = {
  event: styles.event,
  reminder: styles.reminder,
  checkpoint: styles.checkpoint,
  start: styles.start,
  due: styles.due,
};

function KindIcon({ kind, overdue }: { kind: CalKind; overdue: boolean }) {
  if (kind === "checkpoint" && overdue) return <WarningCircleIcon weight="bold" size={10} />;
  switch (kind) {
    case "event":
      return <CircleIcon weight="fill" size={6} />;
    case "reminder":
    case "checkpoint":
      return <BellIcon weight="fill" size={10} />;
    case "start":
      return <PlayIcon weight="fill" size={9} />;
    case "due":
      return <FlagIcon weight="fill" size={10} />;
  }
}

export type CalItemViewProps = HTMLAttributes<HTMLDivElement> & {
  item: CalItem;
  /** The day is before today. */
  past?: boolean;
  selected?: boolean;
  /** Just created: blue ring + glow that fades out. */
  fresh?: boolean;
  /** Original position while dragging (0.35). */
  ghost?: boolean;
  /** The lifted copy in the drag overlay. */
  lifted?: boolean;
};

/** Native tooltip with the end time of an event: 「15:00–17:00」 (ui-spec §2.5). */
export function endTimeTip(item: CalItem): string | undefined {
  return item.kind === "event" && item.time && item.endTime
    ? `${item.time}–${item.endTime}`
    : undefined;
}

export const CalItemView = forwardRef<HTMLDivElement, CalItemViewProps>(function CalItemView(
  {
    item,
    past = false,
    selected = false,
    fresh = false,
    ghost = false,
    lifted = false,
    className,
    ...rest
  },
  ref,
) {
  const faded = item.done || (past && !item.overdue);
  const lateCheckpoint = item.kind === "checkpoint" && item.overdue;
  return (
    <div
      ref={ref}
      className={cx(
        styles.item,
        KIND_CLASS[item.kind],
        lateCheckpoint && styles.overdue,
        faded && !lifted && styles.faded,
        item.done && styles.done,
        selected && !lifted && styles.selected,
        fresh && !lifted && styles.fresh,
        ghost && styles.ghost,
        lifted && styles.lifted,
        className,
      )}
      data-kind={item.kind}
      data-key={item.key}
      data-state={item.done ? "done" : faded ? "past" : undefined}
      title={endTimeTip(item)}
      {...rest}
    >
      <span className={styles.icon} aria-hidden="true">
        <KindIcon kind={item.kind} overdue={item.overdue} />
      </span>
      <span className={styles.title}>{item.title}</span>
      {item.time && (item.kind === "event" || item.kind === "reminder") && (
        <span className={styles.time}>{item.time}</span>
      )}
    </div>
  );
});

export type DraggableCalItemProps = {
  item: CalItem;
  past: boolean;
  selected: boolean;
  fresh: boolean;
  /** This item is being dragged (render the ghost). */
  ghost: boolean;
  dragDisabled: boolean;
  onSelect: (item: CalItem) => void;
  onOpen: (item: CalItem) => void;
};

/** Item inside a day cell: drag source (4px, any day; data.item for the grid), click = select,
 *  double-click = edit / open. */
export function DraggableCalItem({
  item,
  past,
  selected,
  fresh,
  ghost,
  dragDisabled,
  onSelect,
  onOpen,
}: DraggableCalItemProps) {
  const { setNodeRef, listeners, attributes } = useDraggable({
    id: item.key,
    data: { item },
    disabled: dragDisabled,
  });
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    onSelect(item);
  };
  const onDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onOpen(item);
  };
  return (
    <CalItemView
      ref={setNodeRef}
      item={item}
      past={past}
      selected={selected}
      fresh={fresh}
      ghost={ghost}
      className={dragDisabled ? undefined : styles.draggable}
      {...attributes}
      {...listeners}
      aria-pressed={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}
