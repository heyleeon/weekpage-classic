// One todo row (ui-spec §5.4): [checkbox] [title, wraps] [tag | 「设提醒」 on hover]. The whole
// row drags (§5.6) and swipes (§10.14): right = tick / untick, left = red 删除 (undo toast).
// Check → ≈600 ms later it moves to 「今天完成」; double-click edits in place (empty + Enter
// deletes with undo); right-click menu: 设提醒 / 删除.

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/Checkbox";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { SWIPE_DELETE_KEYS, SwipeRow } from "@/components/ui/SwipeRow";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { todoTag } from "@/lib/todos";
import type { Todo } from "@/types/domain";
import { FloatingMenu } from "./FloatingMenu";
import { leftColumnAnchor, useHighlightFor } from "./helpers";
import styles from "./TodoRow.module.css";

/** Delay between ticking a todo and moving it to 「今天完成」 (ui-spec §5.4). */
export const CHECK_MOVE_MS = 600;

export type TodoRowProps = {
  todo: Todo;
  today: string;
  /** Rows in 「今天完成」: no drag, no tag, unchecking restores. */
  done?: boolean;
  /** Drag overlay copy (floating, no interaction). */
  overlay?: boolean;
  /** Placeholder slot left behind while this row is dragged (no swipe: the drag owns it). */
  placeholder?: boolean;
  style?: CSSProperties;
  dragProps?: HTMLAttributes<HTMLDivElement>;
};

export const TodoRow = forwardRef<HTMLDivElement, TodoRowProps>(function TodoRow(
  { todo, today, done = false, overlay = false, placeholder = false, style, dragProps },
  ref,
) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const openPopover = useUiStore((s) => s.openPopover);
  const pickerOpen = useUiStore(
    (s) => s.popover?.kind === "datePicker" && s.popover.targetId === todo.id,
  );
  const highlight = useHighlightFor(todo.id);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const setRefs = (el: HTMLDivElement | null) => {
    rowRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  const tag = done ? null : todoTag(todo, today);
  const checked = done || pending;

  const onCheck = (next: boolean) => {
    if (done) {
      if (!next) void mutate(() => api.setTodoDone(todo.id, false));
      return;
    }
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPending(next);
    if (next) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void mutate(() => api.setTodoDone(todo.id, true)).finally(() => setPending(false));
      }, CHECK_MOVE_MS);
    }
  };

  const openPicker = () => {
    const el = rowRef.current;
    if (!el) return;
    openPopover({
      kind: "datePicker",
      purpose: "todoReminder",
      targetId: todo.id,
      anchor: leftColumnAnchor(el),
    });
  };

  const remove = () =>
    void mutate(() => api.deleteTodo(todo.id), {
      toast: { text: t("tasks.todo.deleted", { title: todo.title }) },
    });

  const onContextMenu = (e: MouseEvent) => {
    if (overlay || placeholder) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // A dragged row (and its floating copy) does not swipe: an unfinished swipe settles to nothing.
  const swipeable = !overlay && !placeholder && !editing;
  // Delete / Backspace on the row's controls opens 删除 (SwipeRow); screen readers announce it.
  const deleteKeys = swipeable ? SWIPE_DELETE_KEYS : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click menu + drag source; the menu items are reachable via the tag / 设提醒 buttons
    <div
      ref={setRefs}
      style={style}
      className={cx(styles.item, overlay && styles.overlay, placeholder && styles.placeholder)}
      data-todo-id={todo.id}
      onContextMenu={onContextMenu}
      {...dragProps}
    >
      {placeholder && <span className={styles.dot} aria-hidden="true" />}
      <SwipeRow
        className={styles.swipe}
        right={
          swipeable
            ? {
                label: t(checked ? "tasks.todo.swipeUndo" : "tasks.todo.swipeDone"),
                icon: checked ? (
                  <ArrowCounterClockwiseIcon size={14} weight="bold" />
                ) : (
                  <CheckIcon size={14} weight="bold" />
                ),
                tone: checked ? "muted" : "st",
                run: () => onCheck(!checked),
              }
            : null
        }
        onDelete={swipeable ? remove : null}
        deleteLabel={t("common.actions.delete")}
      >
        <div
          className={cx(
            styles.row,
            done && styles.done,
            pickerOpen && styles.active,
            highlight && styles.fresh,
            highlight?.fading && styles.freshFading,
          )}
        >
          <span className={styles.check} data-no-drag="true">
            <Checkbox
              checked={checked}
              onChange={onCheck}
              label={todo.title}
              keyShortcuts={deleteKeys}
            />
          </span>
          {editing ? (
            <TitleEditor
              todo={todo}
              onDone={() => setEditing(false)}
              onDelete={() => {
                setEditing(false);
                remove();
              }}
            />
          ) : (
            // biome-ignore lint/a11y/noStaticElementInteractions: double-click to edit (mouse shortcut)
            <span
              className={cx(styles.title, checked && styles.titleDone)}
              onDoubleClick={() => !done && !overlay && setEditing(true)}
            >
              {todo.title}
            </span>
          )}
          {!editing && tag && (
            <span className={styles.tagSlot} data-no-drag="true">
              <Chip
                tone={tag.tone}
                icon={<BellIcon size={9} weight="fill" />}
                onClick={openPicker}
                title={t("tasks.todo.changeReminder")}
                className={styles.tag}
              >
                {tag.text}
              </Chip>
            </span>
          )}
          {!editing && !done && !overlay && todo.remindDate === null && (
            <button
              type="button"
              className={cx(styles.remindBtn, pickerOpen && styles.remindBtnOn)}
              aria-keyshortcuts={deleteKeys}
              onClick={openPicker}
            >
              <BellIcon size={10} />
              {t("tasks.todo.remind")}
            </button>
          )}
        </div>
      </SwipeRow>
      {menu && (
        <FloatingMenu
          x={menu.x}
          y={menu.y}
          label={t("tasks.todo.menu")}
          onClose={() => setMenu(null)}
          items={[
            { key: "remind", label: t("tasks.todo.remind"), onSelect: openPicker, disabled: done },
            { key: "delete", label: t("common.actions.delete"), danger: true, onSelect: remove },
          ]}
        />
      )}
    </div>
  );
});

/** Inline title editor: Enter saves, Esc cancels, blur saves; empty + Enter deletes. */
function TitleEditor({
  todo,
  onDone,
  onDelete,
}: {
  todo: Todo;
  onDone: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [value, setValue] = useState(todo.title);
  const finished = useRef(false);

  const save = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    const title = value.trim();
    if (title && title !== todo.title) {
      void mutate(() =>
        api.updateTodo(todo.id, {
          title,
          remindDate: todo.remindDate,
          remindTime: todo.remindTime,
        }),
      );
    }
    onDone();
  }, [value, todo, mutate, onDone]);

  const cancel = useCallback(() => {
    finished.current = true;
    onDone();
  }, [onDone]);

  useEscLayer(true, cancel, ESC_PRIORITY.inlineInput);

  const ime = useImeSafeEnter(() => {
    if (value.trim() === "") {
      finished.current = true;
      onDelete();
      return;
    }
    save();
  });

  return (
    <input
      className={styles.editor}
      value={value}
      // biome-ignore lint/a11y/noAutofocus: editing starts on an explicit double-click
      autoFocus
      aria-label={t("tasks.todo.edit")}
      data-no-drag="true"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim() === "") cancel();
        else save();
      }}
      {...ime}
    />
  );
}
