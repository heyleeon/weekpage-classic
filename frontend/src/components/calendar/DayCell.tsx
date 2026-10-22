// One day of the grid (ui-spec §2.3, §2.7): head + scrolling item list + optional input at the end.
// Dragging lives on the grid (CalendarPage + useCalDrag): this cell only draws the 0.35 ghost of
// the held item (its origin day) and the 「放到这里」 placeholder (the day it would land on).

import { type MouseEvent, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollFade } from "@/components/ui/ScrollFade";
import { useUiStore } from "@/hooks/useUiStore";
import { formatMD, monthDayLabel } from "@/lib/dates";
import type { CalItem } from "@/types/domain";
import { CalInput } from "./CalInput";
import { DraggableCalItem } from "./CalItem";
import { type CommitResult, editText } from "./calendarActions";
import styles from "./DayCell.module.css";
import { DayHead } from "./DayHead";
import { isSameOrder } from "./dayOrder";

/** The open input of this cell: a new event (target null) or an item edited in place. */
export type CellEditing = { id: number; target: CalItem | null };

/** The held item would land here: before others[index] (others = items without the held one). */
export type CellDrop = { index: number; height: number };

export type DayCellProps = {
  date: string;
  items: CalItem[];
  today: string;
  editing: CellEditing | null;
  selectedKey: string | null;
  /** Source id of the object highlighted after a create (3 s). */
  highlightId: string | null;
  /** Key of the held item when this is its origin day (drawn as a ghost). */
  ghostKey: string | null;
  /** Placeholder while the held item is over this day (a valid drop). */
  drop: CellDrop | null;
  /** Keys that cannot be dragged (archived tasks). */
  locked: ReadonlySet<string>;
  onOpenNew: (date: string) => void;
  onOpenItem: (item: CalItem) => void;
  onSelect: (item: CalItem | null) => void;
  onCommit: (editing: CellEditing, raw: string, viaEnter: boolean) => CommitResult;
  onCancel: (editing: CellEditing) => void;
};

export const DayCell = memo(function DayCell({
  date,
  items,
  today,
  editing,
  selectedKey,
  highlightId,
  ghostKey,
  drop,
  locked,
  onOpenNew,
  onOpenItem,
  onSelect,
  onCommit,
  onCancel,
}: DayCellProps) {
  const { t } = useTranslation();
  const past = date < today;
  const isToday = date === today;

  // The placeholder goes before others[index] (or at the end); not where the item already is.
  const placeholderBefore = useMemo(() => {
    if (!drop) return null;
    if (ghostKey !== null && isSameOrder(items, ghostKey, drop.index)) return null;
    const others = ghostKey === null ? items : items.filter((i) => i.key !== ghostKey);
    return others[drop.index]?.key ?? "end";
  }, [drop, ghostKey, items]);

  const onCellDoubleClick = (e: MouseEvent) => {
    if (useUiStore.getState().dragging) return;
    if ((e.target as HTMLElement).closest("[data-kind], [data-cal-input], [data-placeholder]")) {
      return;
    }
    onOpenNew(date);
  };

  const onCellClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-kind]")) return;
    onSelect(null);
  };

  const placeholder = drop && (
    <div
      key="__placeholder"
      className={styles.placeholder}
      style={{ height: drop.height }}
      data-placeholder=""
    >
      {t("calendar.dropHere")}
    </div>
  );

  const editingTarget = editing?.target?.key ?? null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click on empty space opens the input; items and the input are the keyboard targets
    // biome-ignore lint/a11y/useKeyWithClickEvents: clicking empty space only clears the selection (Esc does the same)
    <div
      className={styles.cell}
      data-date={date}
      data-today={isToday || undefined}
      data-past={past || undefined}
      onDoubleClick={onCellDoubleClick}
      onClick={onCellClick}
    >
      <DayHead date={date} today={today} />
      <ScrollFade surface="paper" scrollbar="hover" className={styles.list}>
        <div className={styles.items} data-day-items="">
          {items.flatMap((item) => {
            const nodes = [];
            if (placeholderBefore === item.key) nodes.push(placeholder);
            if (editingTarget === item.key && editing) {
              nodes.push(
                <CalInput
                  key={`edit-${editing.id}`}
                  initial={editText(item)}
                  label={t("calendar.input.editLabel", { title: item.title })}
                  onCommit={(raw, viaEnter) => onCommit(editing, raw, viaEnter)}
                  onCancel={() => onCancel(editing)}
                />,
              );
            } else {
              nodes.push(
                <DraggableCalItem
                  key={item.key}
                  item={item}
                  past={past}
                  selected={selectedKey === item.key}
                  fresh={highlightId !== null && highlightId === item.sourceId}
                  ghost={ghostKey === item.key}
                  dragDisabled={editing !== null || locked.has(item.key)}
                  onSelect={onSelect}
                  onOpen={onOpenItem}
                />,
              );
            }
            return nodes;
          })}
          {placeholderBefore === "end" && placeholder}
          {editing && editing.target === null && (
            <CalInput
              key={`new-${editing.id}`}
              initial=""
              label={t("calendar.input.newLabel", {
                md: formatMD(date),
                monthDay: monthDayLabel(date),
              })}
              onCommit={(raw, viaEnter) => onCommit(editing, raw, viaEnter)}
              onCancel={() => onCancel(editing)}
            />
          )}
        </div>
      </ScrollFade>
    </div>
  );
});
