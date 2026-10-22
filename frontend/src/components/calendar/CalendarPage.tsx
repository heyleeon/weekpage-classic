// Calendar page (ui-spec §2, §3): weekday row, N×7 grid (rows share the height, 64 left at the
// bottom for the today pill, horizontal lines only), today pill. One input open at a time.
//
// Week navigation is vertical and direct (useWeekScroll): wheel / trackpad and grab-dragging empty
// space slide the rows by weeks; ↑ / ← and ↓ / → page a week, T goes home; every anchor change
// slides. One buffer week above and one below the visible rows is rendered (clipped, inert).
// Items drag across days and weeks (useCalDrag; one DndContext for the grid).
// Never subscribes to shell events (hooks/useShellEvents.ts resets the anchor).

import { DndContext, DragOverlay } from "@dnd-kit/core";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useHotkey } from "@/hooks/useHotkeys";
import { useToday } from "@/hooks/useToday";
import { useUiStore } from "@/hooks/useUiStore";
import { deriveCalendar, lockedCalKeys } from "@/lib/calendar";
import { addDays } from "@/lib/dates";
import type { CalItem } from "@/types/domain";
import styles from "./CalendarPage.module.css";
import { CalItemView } from "./CalItem";
import {
  type CommitResult,
  commitDayOrder,
  commitItemEdit,
  commitNewEvent,
  deleteEventItem,
  openTaskDetail,
} from "./calendarActions";
import { backToToday, shiftWeek } from "./calendarNav";
import { type CellDrop, type CellEditing, DayCell } from "./DayCell";
import { TodayPill } from "./TodayPill";
import { useCalDrag } from "./useCalDrag";
import { useWeekScroll } from "./useWeekScroll";
import { WeekdayRow } from "./WeekdayRow";
import { parseDurationMs, renderedWeeks } from "./weekScroll";

type Editing = CellEditing & { date: string };

const EMPTY: CalItem[] = [];
const NO_KEYS: ReadonlySet<string> = new Set();

export default function CalendarPage() {
  const { t } = useTranslation();
  const snap = useDataStore((s) => s.snap);
  const today = useToday();
  const anchor = useUiStore((s) => s.calendarAnchor);
  const weeks = useUiStore((s) => s.calendarWeeks);
  const selectedKey = useUiStore((s) => s.selectedCalItemKey);
  const selectCalItem = useUiStore((s) => s.selectCalItem);
  const highlight = useUiStore((s) => s.highlight);

  const mondays = useMemo(() => renderedWeeks(anchor, weeks), [anchor, weeks]);
  const from = mondays[0];
  const to = addDays(mondays[mondays.length - 1], 6);
  const byDate = useMemo(
    () => (snap ? deriveCalendar(snap, from, to, today) : new Map<string, CalItem[]>()),
    [snap, from, to, today],
  );
  const locked = useMemo(() => (snap ? lockedCalKeys(snap) : NO_KEYS), [snap]);

  const scroll = useWeekScroll(anchor, weeks, snap !== null);
  const dnd = useCalDrag(byDate, scroll.viewportRef);
  const held = dnd.drag;
  // A refused / outside drop flies back on --duration-fast (150ms; 0 with reduced motion).
  const backMs = useMemo(
    () =>
      parseDurationMs(
        getComputedStyle(document.documentElement).getPropertyValue("--duration-fast"),
      ),
    [],
  );

  const [editing, setEditing] = useState<Editing | null>(null);
  const nextId = useRef(1);

  const highlightId = highlight && highlight.until > Date.now() ? highlight.id : null;

  const findItem = useCallback(
    (key: string | null): CalItem | null => {
      if (!key) return null;
      for (const items of byDate.values()) {
        const hit = items.find((i) => i.key === key);
        if (hit) return hit;
      }
      return null;
    },
    [byDate],
  );

  const closeEditing = useCallback((id: number) => {
    setEditing((cur) => (cur && cur.id === id ? null : cur));
  }, []);

  const onOpenNew = useCallback(
    (date: string) => {
      selectCalItem(null);
      setEditing({ id: nextId.current++, date, target: null });
    },
    [selectCalItem],
  );

  const onOpenItem = useCallback(
    (item: CalItem) => {
      if (item.kind === "event" || item.kind === "reminder") {
        selectCalItem(null);
        setEditing({ id: nextId.current++, date: item.date, target: item });
      } else {
        openTaskDetail(item);
      }
    },
    [selectCalItem],
  );

  const onSelect = useCallback(
    (item: CalItem | null) => selectCalItem(item ? item.key : null),
    [selectCalItem],
  );

  const onCommit = useCallback(
    (e: CellEditing, raw: string, viaEnter: boolean): CommitResult => {
      const date = (e as Editing).date;
      const res = e.target
        ? commitItemEdit(e.target, raw, viaEnter)
        : commitNewEvent(date, raw, viaEnter);
      if (res === "close") closeEditing(e.id);
      return res;
    },
    [closeEditing],
  );

  const onCancel = useCallback((e: CellEditing) => closeEditing(e.id), [closeEditing]);

  // Esc with a selected item clears the selection (ui-spec §15.4 level 6).
  useEscLayer(selectedKey !== null, () => selectCalItem(null), ESC_PRIORITY.selection);

  /** Calendar keys only when nothing sits on top of the page. */
  const pageKeysOn = () => {
    const ui = useUiStore.getState();
    return ui.page === "calendar" && !ui.overlay && !ui.popover && !ui.dragging && !editing;
  };

  const deleteSelected = () => {
    if (!pageKeysOn()) return false;
    const item = findItem(useUiStore.getState().selectedCalItemKey);
    // Items that come from todos / tasks ignore Delete (ui-spec §2.5).
    if (item?.kind !== "event") return false;
    selectCalItem(null);
    deleteEventItem(item);
    return true;
  };
  useHotkey("delete", deleteSelected);
  useHotkey("backspace", deleteSelected);

  // Week keys: ↑ / ← earlier, ↓ / → later, T home. ⌥↑ / ⌥↓ reorder the selected item (§2.7).
  const page = (delta: -1 | 1) => () => {
    if (!pageKeysOn()) return false;
    shiftWeek(delta);
    return true;
  };
  useHotkey("arrowup", page(-1));
  useHotkey("arrowleft", page(-1));
  useHotkey("arrowdown", page(1));
  useHotkey("arrowright", page(1));
  useHotkey("t", () => {
    if (!pageKeysOn()) return false;
    backToToday();
    return true;
  });
  const moveSelected = (delta: -1 | 1) => {
    if (!pageKeysOn()) return false;
    const item = findItem(useUiStore.getState().selectedCalItemKey);
    if (!item) return false;
    const items = byDate.get(item.date) ?? [];
    const from = items.findIndex((i) => i.key === item.key);
    const to = from + delta;
    if (to < 0 || to >= items.length) return true;
    commitDayOrder(item.date, items, item.key, to);
    return true;
  };
  useHotkey("alt+arrowup", () => moveSelected(-1));
  useHotkey("alt+arrowdown", () => moveSelected(1));

  const rows = useMemo(
    () => mondays.map((monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))),
    [mondays],
  );

  // Only the target day gets a placeholder object (keeps the other cells memoised).
  const target = held?.target ?? null;
  const dropDate = target?.valid ? target.date : null;
  const dropIndex = target?.index ?? 0;
  const dropHeight = held?.height ?? 18;
  const drop = useMemo<CellDrop | null>(
    () => (dropDate ? { index: dropIndex, height: dropHeight } : null),
    [dropDate, dropIndex, dropHeight],
  );

  return (
    <section className={styles.page} aria-label={t("calendar.pageLabel")}>
      <WeekdayRow />
      <div ref={scroll.gridRef} className={styles.grid} data-cal-grid="">
        <div ref={scroll.viewportRef} className={styles.viewport} data-cal-viewport="">
          <DndContext
            sensors={dnd.sensors}
            autoScroll={false}
            accessibility={dnd.accessibility}
            onDragStart={dnd.onDragStart}
            onDragMove={dnd.onDragMove}
            onDragEnd={dnd.onDragEnd}
            onDragCancel={dnd.onDragCancel}
          >
            <div
              ref={scroll.trackRef}
              className={styles.track}
              style={{ "--weeks": weeks, "--rows": weeks + 2 } as CSSProperties}
            >
              {rows.map((week, i) => {
                const buffer = i === 0 || i === rows.length - 1;
                return (
                  <div
                    key={week[0]}
                    className={styles.row}
                    data-cal-row={week[0]}
                    data-buffer={buffer || undefined}
                    aria-hidden={buffer || undefined}
                    inert={buffer || undefined}
                  >
                    {week.map((date) => (
                      <DayCell
                        key={date}
                        date={date}
                        items={byDate.get(date) ?? EMPTY}
                        today={today}
                        editing={editing && editing.date === date ? editing : null}
                        selectedKey={selectedKey}
                        highlightId={highlightId}
                        ghostKey={held && held.item.date === date ? held.item.key : null}
                        drop={dropDate === date ? drop : null}
                        locked={locked}
                        onOpenNew={onOpenNew}
                        onOpenItem={onOpenItem}
                        onSelect={onSelect}
                        onCommit={onCommit}
                        onCancel={onCancel}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
            {createPortal(
              <DragOverlay
                className={styles.overlay}
                dropAnimation={
                  dnd.accepted || backMs <= 0 ? null : { duration: backMs, easing: "ease-out" }
                }
                zIndex={200}
              >
                {held ? (
                  <CalItemView item={held.item} past={held.item.date < today} lifted />
                ) : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        </div>
      </div>
      <TodayPill />
    </section>
  );
}
