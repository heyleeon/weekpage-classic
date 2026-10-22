// 3-column masonry (ui-spec §7): each column is its own ordered list (board_column + sort_key).
// Cards drag within and across columns (≥ 5 px); the column under the pointer is the target and
// the pointer y against card midlines picks the slot. Real column heights go to
// useUiStore.columnHeights (mount, resize, unmount → null) for shortestColumn().

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  MeasuringStrategy,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollEdge } from "@/components/ui/ScrollEdge";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import type { KeyPoint, Snapshot, Task } from "@/types/domain";
import { provisionalKey, useDragA11y } from "./helpers";
import { CARD_DRAG_DISTANCE, CardSensor } from "./sensors";
import { TaskCard } from "./TaskCard";
import styles from "./TaskGrid.module.css";
import { useCardFlip } from "./useCardFlip";

export const COLUMNS = [0, 1, 2] as const;
type Col = (typeof COLUMNS)[number];
type Columns = [string[], string[], string[]];

const colId = (c: Col) => `col-${c}`;
const colOfId = (id: string): Col | null =>
  id === "col-0" ? 0 : id === "col-1" ? 1 : id === "col-2" ? 2 : null;

/** Board columns from the snapshot: live, unarchived tasks, each column by sort key. */
export function boardColumns(snap: Snapshot): Columns {
  const cols: Columns = [[], [], []];
  const sorted = snap.tasks
    .filter((t) => t.archivedAt === null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  for (const t of sorted) {
    const c = t.boardColumn;
    if (c === 0 || c === 1 || c === 2) cols[c].push(t.id);
  }
  return cols;
}

function findCol(cols: Columns, id: string): Col | null {
  const asCol = colOfId(id);
  if (asCol !== null) return asCol;
  for (const c of COLUMNS) if (cols[c].includes(id)) return c;
  return null;
}

export function TaskGrid({
  snap,
  today,
  onScrolledChange,
}: {
  snap: Snapshot;
  today: string;
  /** Whether cards are scrolled under the floating header (it then puts its title on glass). */
  onScrolledChange?: (scrolled: boolean) => void;
}) {
  const { t } = useTranslation();
  const patchLocal = useDataStore((s) => s.patchLocal);
  const mutate = useDataStore((s) => s.mutate);
  const setDragging = useUiStore((s) => s.setDragging);
  const setColumnHeights = useUiStore((s) => s.setColumnHeights);
  const accessibility = useDragA11y("card");

  const base = useMemo(() => boardColumns(snap), [snap]);
  const [drag, setDrag] = useState<{ id: string; cols: Columns; from: Col } | null>(null);
  const cols = drag?.cols ?? base;
  const gridRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  // Cards below a card that grows / shrinks / leaves slide over 200ms (§7.1).
  useCardFlip(gridRef);

  const tasks = useMemo(() => new Map(snap.tasks.map((t) => [t.id, t])), [snap.tasks]);
  const kpsByTask = useMemo(() => {
    const m = new Map<string, KeyPoint[]>();
    for (const k of snap.keyPoints) {
      const list = m.get(k.taskId);
      if (list) list.push(k);
      else m.set(k.taskId, [k]);
    }
    return m;
  }, [snap.keyPoints]);

  // Measured column heights (useUiStore.columnHeights, read by lib/board.ts).
  const measure = useCallback(() => {
    const h = colRefs.current.map((el) => el?.getBoundingClientRect().height ?? 0);
    setColumnHeights([h[0], h[1], h[2]]);
  }, [setColumnHeights]);
  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return () => setColumnHeights(null);
    const ro = new ResizeObserver(measure);
    for (const el of colRefs.current) if (el) ro.observe(el);
    return () => {
      ro.disconnect();
      setColumnHeights(null);
    };
  }, [measure, setColumnHeights]);
  // ResizeObserver callbacks wait for a rendering opportunity (late or never while the window is
  // hidden), so also re-measure synchronously after every data change: the next 「变任务」 /
  // restore right after a create must already see the new card.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snap is the trigger, not an input
  useLayoutEffect(() => measure(), [measure, snap]);

  const sensors = useSensors(
    useSensor(CardSensor, { activationConstraint: { distance: CARD_DRAG_DISTANCE } }),
  );
  useEscLayer(drag !== null, () => undefined, ESC_PRIORITY.drag);

  // Column = the one under the pointer (x only); slot = pointer y vs card midlines.
  const collision: CollisionDetection = (args) => {
    const p = args.pointerCoordinates;
    const grid = gridRef.current?.getBoundingClientRect();
    if (!p || !grid) return [];
    if (p.x < grid.left || p.x > grid.right || p.y < grid.top - 48 || p.y > grid.bottom + 48)
      return [];
    const column = args.droppableContainers.find((c) => {
      if (colOfId(String(c.id)) === null) return false;
      const r = args.droppableRects.get(c.id);
      return r !== undefined && p.x >= r.left - 7 && p.x <= r.right + 7;
    });
    if (!column) return [];
    const items = args.droppableContainers
      .filter((c) => c.data.current?.sortable?.containerId === column.id)
      .map((c) => ({ id: c.id, rect: args.droppableRects.get(c.id) }))
      .filter((c): c is { id: typeof c.id; rect: NonNullable<typeof c.rect> } => !!c.rect)
      .sort((a, b) => a.rect.top - b.rect.top);
    // k = slot among the other cards; `over` follows the sortable convention (the active card
    // takes over's index) for its own column, and "insert before over" for a foreign one.
    const others = items.filter((c) => c.id !== args.active.id);
    const k = others.filter((c) => c.rect.top + c.rect.height / 2 < p.y).length;
    const own = others.length !== items.length;
    const target = own ? items[k] : others[k];
    return [{ id: target ? target.id : column.id }];
  };

  const onStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const from = findCol(base, id);
    if (from === null) return;
    setDrag({ id, from, cols: [[...base[0]], [...base[1]], [...base[2]]] });
    setDragging(true);
  };

  const onOver = ({ active, over }: DragOverEvent) => {
    if (!drag || !over) return;
    const id = String(active.id);
    const overId = String(over.id);
    const fromCol = findCol(drag.cols, id);
    const toCol = findCol(drag.cols, overId);
    if (fromCol === null || toCol === null || fromCol === toCol) return;
    const next: Columns = [[...drag.cols[0]], [...drag.cols[1]], [...drag.cols[2]]];
    next[fromCol] = next[fromCol].filter((x) => x !== id);
    const at = colOfId(overId) !== null ? next[toCol].length : next[toCol].indexOf(overId);
    next[toCol].splice(at < 0 ? next[toCol].length : at, 0, id);
    setDrag({ ...drag, cols: next });
  };

  const end = () => {
    setDrag(null);
    setDragging(false);
  };

  const onEnd = ({ active, over }: DragEndEvent) => {
    const state = drag;
    end();
    if (!state || !over) return;
    const id = String(active.id);
    const col = findCol(state.cols, id);
    if (col === null) return;
    let list = state.cols[col];
    const overId = String(over.id);
    const from = list.indexOf(id);
    const to = colOfId(overId) !== null ? list.length - 1 : list.indexOf(overId);
    if (to >= 0 && from !== to) list = arrayMove(list, from, to);
    const at = list.indexOf(id);
    if (col === state.from && base[col].indexOf(id) === at) return;
    const prevId = list[at - 1] ?? null;
    const nextId = list[at + 1] ?? null;
    const key = provisionalKey(
      prevId ? (tasks.get(prevId)?.sortKey ?? null) : null,
      nextId ? (tasks.get(nextId)?.sortKey ?? null) : null,
    );
    patchLocal((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, boardColumn: col, sortKey: key } : t)),
    }));
    void mutate(() => api.moveTask(id, col, prevId, nextId));
  };

  const active = drag ? tasks.get(drag.id) : undefined;
  const total = base[0].length + base[1].length + base[2].length;

  return (
    <div
      className={styles.scroll}
      data-testid="task-grid-scroll"
      onScroll={(e) => onScrolledChange?.(e.currentTarget.scrollTop > 0)}
    >
      <ScrollEdge />
      {total === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t("tasks.grid.emptyTitle")}</p>
          <p className={styles.emptyHint}>{t("tasks.grid.emptyHint")}</p>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={accessibility}
        onDragStart={onStart}
        onDragOver={onOver}
        onDragEnd={onEnd}
        onDragCancel={end}
        autoScroll={{ threshold: { x: 0, y: 0.1 } }}
      >
        <div ref={gridRef} className={styles.grid}>
          {COLUMNS.map((c) => (
            <Column
              key={c}
              col={c}
              ids={cols[c]}
              setRef={(el) => {
                colRefs.current[c] = el;
              }}
            >
              {cols[c].map((id) => {
                const t = tasks.get(id);
                return t ? (
                  <SortableCard key={id} task={t} kps={kpsByTask.get(id) ?? []} today={today} />
                ) : null;
              })}
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 200, easing: "ease-out" }}>
          {active ? (
            <TaskCard
              task={active}
              keyPoints={kpsByTask.get(active.id) ?? []}
              today={today}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  col,
  ids,
  setRef,
  children,
}: {
  col: Col;
  ids: string[];
  setRef: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: colId(col) });
  return (
    <SortableContext id={colId(col)} items={ids} strategy={verticalListSortingStrategy}>
      <div
        ref={(el) => {
          setNodeRef(el);
          setRef(el);
        }}
        className={styles.column}
        data-column={col}
      >
        {children}
      </div>
    </SortableContext>
  );
}

function SortableCard({ task, kps, today }: { task: Task; kps: KeyPoint[]; today: string }) {
  // Cards in the target column make room over 180ms (§7.2).
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    transition: { duration: 180, easing: "ease-out" },
  });
  return (
    <TaskCard
      ref={setNodeRef}
      task={task}
      keyPoints={kps}
      today={today}
      placeholder={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragProps={listeners}
    />
  );
}
