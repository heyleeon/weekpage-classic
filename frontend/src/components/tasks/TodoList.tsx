// 「今天」 tab body (ui-spec §5): open todos (drag up / down or hold to reorder; rows swipe,
// §10.14), 「+ 添加待办」, and 「今天完成」. Everything below the hint scrolls together.

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
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
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollEdge } from "@/components/ui/ScrollEdge";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { todoLists } from "@/lib/todos";
import type { Snapshot, Todo } from "@/types/domain";
import { provisionalKey, useDragA11y } from "./helpers";
import { TODO_CONSTRAINT, TodoRowSensor } from "./sensors";
import styles from "./TodoList.module.css";
import { TodoRow } from "./TodoRow";

export type TodoListProps = {
  snap: Snapshot;
  today: string;
  adding: boolean;
  setAdding: (open: boolean) => void;
};

export function TodoList({ snap, today, adding, setAdding }: TodoListProps) {
  const { t } = useTranslation();
  const { open, doneToday } = todoLists(snap, today);
  return (
    <div className={styles.scroll} data-testid="todo-list">
      <ScrollEdge />
      {open.length === 0 && (
        <p className={styles.empty}>
          {doneToday.length > 0 ? t("tasks.todo.allDone") : t("tasks.todo.empty")}
        </p>
      )}
      <SortableTodos todos={open} today={today} />
      <AddTodoRow open={adding} setOpen={setAdding} />
      <DoneSection todos={doneToday} today={today} collapsed={snap.settings.todoDoneCollapsed} />
    </div>
  );
}

// ── open list with drag ──────────────────────────────────────────────────────────────────

function SortableTodos({ todos, today }: { todos: Todo[]; today: string }) {
  const patchLocal = useDataStore((s) => s.patchLocal);
  const mutate = useDataStore((s) => s.mutate);
  const setDragging = useUiStore((s) => s.setDragging);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(TodoRowSensor, { activationConstraint: TODO_CONSTRAINT }));
  const accessibility = useDragA11y("todo");
  // dnd-kit cancels on Esc itself; this layer only keeps Esc from going further down the chain.
  useEscLayer(activeId !== null, () => undefined, ESC_PRIORITY.drag);

  const ids = todos.map((t) => t.id);
  const active = activeId ? todos.find((t) => t.id === activeId) : undefined;

  const onStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setDragging(true);
  };

  const finish = () => {
    setActiveId(null);
    setDragging(false);
  };

  const onEnd = (e: DragEndEvent) => {
    finish();
    const { active: a, over } = e;
    if (!over || a.id === over.id) return;
    // Released outside the list → back to where it was (ui-spec §5.6).
    const list = listRef.current?.getBoundingClientRect();
    const start = e.activatorEvent as PointerEvent | null;
    if (list && start && "clientX" in start) {
      const x = start.clientX + e.delta.x;
      const y = start.clientY + e.delta.y;
      if (x < list.left || x > list.right || y < list.top - 40 || y > list.bottom + 40) return;
    }
    const from = ids.indexOf(String(a.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const order = arrayMove(ids, from, to);
    const id = order[to];
    const prevId = order[to - 1] ?? null;
    const nextId = order[to + 1] ?? null;
    const byId = new Map(todos.map((t) => [t.id, t]));
    const key = provisionalKey(
      prevId ? (byId.get(prevId)?.sortKey ?? null) : null,
      nextId ? (byId.get(nextId)?.sortKey ?? null) : null,
    );
    patchLocal((s) => ({
      ...s,
      todos: s.todos.map((t) => (t.id === id ? { ...t, sortKey: key } : t)),
    }));
    void mutate(() => api.moveTodo(id, prevId, nextId));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={accessibility}
      onDragStart={onStart}
      onDragEnd={onEnd}
      onDragCancel={finish}
      autoScroll={{ threshold: { x: 0, y: 0.15 } }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={listRef} className={styles.open}>
          {todos.map((t) => (
            <SortableTodo key={t.id} todo={t} today={today} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease-out" }}>
        {active ? <TodoRow todo={active} today={today} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableTodo({ todo, today }: { todo: Todo; today: string }) {
  // The other rows make room over 150ms (§5.6).
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: todo.id,
    transition: { duration: 150, easing: "ease-out" },
  });
  return (
    <TodoRow
      ref={setNodeRef}
      todo={todo}
      today={today}
      placeholder={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragProps={listeners}
    />
  );
}

// ── 「+ 添加待办」 ─────────────────────────────────────────────────────────────────────────

export function AddTodoRow({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [value, setValue] = useState("");
  useEscLayer(
    open,
    () => {
      setValue("");
      setOpen(false);
    },
    ESC_PRIORITY.inlineInput,
  );
  const ime = useImeSafeEnter(() => {
    const title = value.trim();
    if (!title) return;
    setValue("");
    void mutate(() => api.createTodo({ title }));
  });

  if (!open) {
    return (
      <button type="button" className={styles.addBtn} onClick={() => setOpen(true)}>
        <PlusIcon size={12} />
        {t("tasks.todo.add")}
      </button>
    );
  }
  return (
    <div className={styles.addRow}>
      <span className={styles.addBox} aria-hidden="true" />
      <input
        className={styles.addInput}
        placeholder={t("tasks.todo.add")}
        aria-label={t("tasks.todo.add")}
        value={value}
        // biome-ignore lint/a11y/noAutofocus: the row opens on an explicit click
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() === "") setOpen(false);
        }}
        {...ime}
      />
    </div>
  );
}

// ── 「今天完成」 ──────────────────────────────────────────────────────────────────────────

function DoneSection({
  todos,
  today,
  collapsed,
}: {
  todos: Todo[];
  today: string;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  const saveSettings = useDataStore((s) => s.saveSettings);
  if (todos.length === 0) return null;
  return (
    <section className={styles.done} aria-label={t("tasks.todo.doneSection")}>
      <button
        type="button"
        className={styles.doneHead}
        aria-expanded={!collapsed}
        onClick={() => void saveSettings({ todoDoneCollapsed: !collapsed })}
      >
        {collapsed ? <CaretRightIcon size={10} /> : <CaretDownIcon size={10} />}
        <span className={styles.doneLabel}>{t("tasks.todo.doneCount", { n: todos.length })}</span>
        <span className={styles.doneLine} />
        <span className={styles.doneHint}>{t("tasks.todo.doneHint")}</span>
      </button>
      {!collapsed && todos.map((t) => <TodoRow key={t.id} todo={t} today={today} done />)}
    </section>
  );
}
