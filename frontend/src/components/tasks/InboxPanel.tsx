// 「收件箱」 tab (ui-spec §6): input on top (Enter saves to the top of the list), then the items.
// Rows swipe (§10.14): right = 今天, left = red 删除. Hover / keyboard selection reveals 定日期 ·
// 变任务; keys T / D / R / ⌫ on the row (announced through aria-keyshortcuts). The toasts of
// consecutive triages merge (lib/toasts.ts inboxTriageToast, merged and undone by ToastHost).

import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CheckSquareIcon } from "@phosphor-icons/react/dist/csr/CheckSquare";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { TrayIcon } from "@phosphor-icons/react/dist/csr/Tray";
import {
  forwardRef,
  type KeyboardEvent,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/components/ui/cx";
import { SWIPE_DELETE_KEYS, SwipeRow } from "@/components/ui/SwipeRow";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useUiStore } from "@/hooks/useUiStore";
import { api } from "@/lib/api";
import { inboxTriageToast } from "@/lib/toasts";
import type { InboxItem } from "@/types/domain";
import { leftColumnAnchor } from "./helpers";
import styles from "./InboxPanel.module.css";

export type InboxPanelHandle = { focusInput(): void };

export const InboxPanel = forwardRef<InboxPanelHandle, { items: InboxItem[] }>(function InboxPanel(
  { items },
  ref,
) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }), []);
  const sorted = [...items].sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
  );
  const listRef = useRef<HTMLDivElement>(null);

  const moveFocus = (from: HTMLElement, dir: 1 | -1) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-inbox-id]") ?? [],
    );
    const i = rows.indexOf(from);
    rows[i + dir]?.focus();
  };

  return (
    <>
      <InboxInput ref={inputRef} />
      <div ref={listRef} className={styles.list} data-testid="inbox-list">
        {sorted.length === 0 && <p className={styles.empty}>{t("tasks.inbox.empty")}</p>}
        {sorted.map((item) => (
          <InboxRow key={item.id} item={item} onArrow={moveFocus} />
        ))}
      </div>
    </>
  );
});

// ── input ────────────────────────────────────────────────────────────────────────────────

/** The row's own keys (onKeyDown below): ↑↓, 今天, 定日期, 变任务, delete. */
const ROW_KEYS = "ArrowUp ArrowDown T D R Backspace Delete";

const InboxInput = forwardRef<HTMLInputElement>(function InboxInput(_props, ref) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement, []);

  useEscLayer(
    focused,
    () => {
      setValue("");
      inner.current?.blur();
    },
    ESC_PRIORITY.inlineInput,
  );
  const ime = useImeSafeEnter(() => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    void mutate(() => api.createInboxItem(text));
  });

  return (
    <label className={styles.input}>
      <PencilSimpleIcon size={14} className={styles.inputIcon} />
      <input
        ref={inner}
        value={value}
        placeholder={t("tasks.inbox.placeholder")}
        aria-label={t("tasks.inbox.input")}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...ime}
      />
    </label>
  );
});

// ── row ──────────────────────────────────────────────────────────────────────────────────

function InboxRow({
  item,
  onArrow,
}: {
  item: InboxItem;
  onArrow: (from: HTMLElement, dir: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const openPopover = useUiStore((s) => s.openPopover);
  const popoverFor = useUiStore((s) => {
    const p = s.popover;
    if (p?.kind === "datePicker" && p.purpose === "inboxSchedule" && p.targetId === item.id)
      return "schedule";
    if (p?.kind === "newTask" && p.fromInboxId === item.id) return "task";
    return null;
  });
  const rowRef = useRef<HTMLFieldSetElement>(null);
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [editing, setEditing] = useState(false);
  const expanded = hover || focusWithin || popoverFor !== null;

  const toToday = useCallback(
    () =>
      void mutate(() => api.createTodo({ title: item.text }, item.id), {
        toast: inboxTriageToast("todo"),
        highlight: (m) => (m.id ? { id: m.id, reason: "fromInbox" } : null),
      }),
    [mutate, item],
  );
  const schedule = useCallback(() => {
    if (!rowRef.current) return;
    openPopover({
      kind: "datePicker",
      purpose: "inboxSchedule",
      targetId: item.id,
      anchor: leftColumnAnchor(rowRef.current),
    });
  }, [openPopover, item.id]);
  const toTask = useCallback(() => {
    if (!rowRef.current) return;
    openPopover({
      kind: "newTask",
      fromInboxId: item.id,
      title: item.text,
      anchor: leftColumnAnchor(rowRef.current),
    });
  }, [openPopover, item]);
  const remove = useCallback(
    () => void mutate(() => api.deleteInboxItem(item.id), { toast: inboxTriageToast("deleted") }),
    [mutate, item.id],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLFieldSetElement>) => {
    if (e.target !== e.currentTarget || editing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      onArrow(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
    } else if (key === "t") toToday();
    else if (key === "d") schedule();
    else if (key === "r") toTask();
    else if (e.key === "Backspace" || e.key === "Delete") {
      // Deletes at once (undo toast); the row's swipe never sees it.
      e.stopPropagation();
      remove();
    } else return;
    e.preventDefault();
  };

  return (
    <SwipeRow
      className={cx(styles.swipe, expanded && styles.swipeLifted)}
      right={
        editing
          ? null
          : {
              label: t("tasks.inbox.today"),
              icon: <SunIcon size={14} weight="bold" />,
              tone: "st",
              run: toToday,
            }
      }
      onDelete={editing ? null : remove}
      deleteLabel={t("common.actions.delete")}
      // 删除 counts as in the row: Delete on 定日期 opens it, and 定日期 must still be there when
      // Esc closes it and gives focus back.
      onFocusChange={setFocusWithin}
    >
      <fieldset
        ref={rowRef}
        aria-label={item.text}
        aria-keyshortcuts={editing ? undefined : ROW_KEYS}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: rows take focus for ↑↓ + T / D / R / ⌫ triage
        tabIndex={0}
        data-inbox-id={item.id}
        className={cx(styles.row, expanded && styles.expanded)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onKeyDown={onKeyDown}
      >
        <div className={styles.line}>
          <TrayIcon size={14} className={styles.tray} />
          {editing ? (
            <InboxEditor item={item} onDone={() => setEditing(false)} />
          ) : (
            // biome-ignore lint/a11y/noStaticElementInteractions: double-click to edit (mouse shortcut)
            <span className={styles.text} onDoubleClick={() => setEditing(true)}>
              {item.text}
            </span>
          )}
        </div>
        {expanded && !editing && (
          <div className={styles.actions}>
            <button
              type="button"
              className={cx(styles.action, popoverFor === "schedule" && styles.actionRm)}
              title={t("tasks.inbox.tip.schedule")}
              aria-keyshortcuts={SWIPE_DELETE_KEYS}
              onClick={schedule}
            >
              <CalendarBlankIcon size={13} />
              {t("tasks.inbox.schedule")}
            </button>
            <button
              type="button"
              className={cx(styles.action, popoverFor === "task" && styles.actionSt)}
              title={t("tasks.inbox.tip.toTask")}
              aria-keyshortcuts={SWIPE_DELETE_KEYS}
              onClick={toTask}
            >
              <CheckSquareIcon size={13} />
              {t("tasks.inbox.toTask")}
            </button>
          </div>
        )}
      </fieldset>
    </SwipeRow>
  );
}

function InboxEditor({ item, onDone }: { item: InboxItem; onDone: () => void }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [value, setValue] = useState(item.text);
  const finished = useRef(false);
  const save = () => {
    if (finished.current) return;
    finished.current = true;
    const text = value.trim();
    if (text && text !== item.text) void mutate(() => api.updateInboxItem(item.id, text));
    onDone();
  };
  useEscLayer(
    true,
    () => {
      finished.current = true;
      onDone();
    },
    ESC_PRIORITY.inlineInput,
  );
  const ime = useImeSafeEnter(save);
  return (
    <input
      className={styles.editor}
      value={value}
      aria-label={t("tasks.inbox.edit")}
      // biome-ignore lint/a11y/noAutofocus: editing starts on an explicit double-click
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      {...ime}
    />
  );
}
