// Detail timeline (ui-spec §10.1–§10.3, §10.6, §10.14, §9.2–§9.3): key points and notes, one line
// each (2026-10-02): date column, marker with the connecting rail, text, type chip at the end;
// done rows go grey, overdue ones get a red date, a red 「!」 marker and 「逾期 N 天」 (no 「current」
// row any more); inline edit; a soft flash on focus. No hover buttons: rows swipe (SwipeRow:
// right = tick / untick, left = delete button, Delete / Backspace from the keyboard); the date
// cell is the date control and the type chip the type menu. The row itself never slides: 「完成」 /
// 「删除」 slide in over its ends (SwipeRow `overlay`), so the date, marker and rail stay put. Key points without a date drag up and
// down like calendar items (4px, a lifted copy follows the pointer, 「放到这里」 shows where it
// lands); dated ones and notes follow their date. The list keeps its height while a row is held:
// the held row itself turns into 「放到这里」, and once it is moved elsewhere its own place closes
// (a ghost plus a separate slot made the list a row taller, and the centred detail jumped by half
// a row). The first open key point peeks at its swipe actions the first few times a detail opens
// (useSwipeHint + SwipeRow `hint`), once per detail.

import {
  DndContext,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  type Modifier,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { QuotesIcon } from "@phosphor-icons/react/dist/csr/Quotes";
import { Fragment, forwardRef, type Ref, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { insertIndexAt } from "@/components/calendar/dayOrder";
import { provisionalKey, useDragA11y } from "@/components/tasks/helpers";
import { STEP_CONSTRAINT, StepSensor } from "@/components/tasks/sensors";
import { cx } from "@/components/ui/cx";
import { KeyPointMarker } from "@/components/ui/KeyPointMarker";
import { Menu } from "@/components/ui/Menu";
import { MiniCalendar } from "@/components/ui/MiniCalendar";
import { PEEK_DELAY_MS, PEEK_STEP_MS, SWIPE_DELETE_KEYS, SwipeRow } from "@/components/ui/SwipeRow";
import { useDataStore } from "@/hooks/useDataStore";
import { ESC_PRIORITY, useEscLayer } from "@/hooks/useEscLayer";
import { useImeSafeEnter } from "@/hooks/useImeSafeEnter";
import { useUiStore } from "@/hooks/useUiStore";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { formatMD } from "@/lib/dates";
import { markerOf } from "@/lib/keyPoint";
import type {
  KeyPoint,
  KeyPointInput,
  KeyPointStepKind,
  MarkerKind,
  NoteMarkerKind,
} from "@/types/domain";
import { KIND_ICON } from "./AddBar";
import { Floating, floatingCard } from "./Floating";
import styles from "./TaskDetail.module.css";

/**
 * Rows the user can drag (§10.14): key points without a date of their own, done or not (since
 * 2026-10-02 the date column shows only that date, so 「no date shown」 = 「can drag」). Dated ones
 * (and notes, which always have a date) keep date order on their own.
 */
export function canReorder(kp: KeyPoint): boolean {
  return kp.kind !== "note" && kp.date === null;
}

/**
 * The type chip stays out of sight until the row is hovered or focused (§10.2, 2026-10-02): the
 * default 我来做, and any type of a done row. Only what differs from the usual is labelled.
 */
export function quietKind(kp: KeyPoint): boolean {
  return kp.kind !== "note" && (kp.kind === "do" || kp.doneDate !== null);
}

const STEP_KINDS: KeyPointStepKind[] = ["do", "wait", "check"];

/** Grabbing everywhere while a row is held (TaskDetail.module.css `data-step-cursor`). */
function setStepCursor(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.stepCursor = "grabbing";
  else delete root.dataset.stepCursor;
}

function pointOf(e: Event | null): { x: number; y: number } | null {
  if (e && "clientX" in e && "clientY" in e) {
    return { x: (e as PointerEvent).clientX, y: (e as PointerEvent).clientY };
  }
  return null;
}

/** The row that peeks at its swipe actions (§10.14): the first open key point, in order. */
export function hintRowId(kps: KeyPoint[]): string | null {
  return kps.find((k) => k.kind !== "note" && k.doneDate === null)?.id ?? null;
}

/** Persistent count of detail opens that showed the swipe peek; it stops at SWIPE_HINT_MAX. */
export const SWIPE_HINT_KEY = "cache:detailSwipeHint";
export const SWIPE_HINT_MAX = 2;

/** How long the peek plays (SwipeRow `hint`: the delay, then at most four legs) plus a leg. */
export const SWIPE_HINT_MS = PEEK_DELAY_MS + 5 * PEEK_STEP_MS;

/**
 * Whether this detail shows the swipe peek now: `active` (decided as the detail opens), motion
 * allowed and fewer than SWIPE_HINT_MAX shown so far. Showing it counts it. True only while the
 * peek plays: a row that mounts again later (back from the history view) does not peek again.
 */
export function useSwipeHint(active: boolean): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let live = true;
    let timer = 0;
    void (async () => {
      try {
        const seen = Number(await api.getCache(SWIPE_HINT_KEY)) || 0;
        if (!live || seen >= SWIPE_HINT_MAX) return;
        setShow(true);
        timer = window.setTimeout(() => setShow(false), SWIPE_HINT_MS);
        await api.setCache(SWIPE_HINT_KEY, String(seen + 1));
      } catch {
        // No cache: no peek.
      }
    })();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [active]);
  return show;
}

function inputOf(kp: KeyPoint, patch: Partial<KeyPointInput>): KeyPointInput {
  return { kind: kp.kind, text: kp.text, date: kp.date, who: kp.who, ...patch };
}

/** Reorder moves rows up and down only. */
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** The held row (§10.14): in place it is the drop slot; moved elsewhere its place closes. */
type HeldState = { mode: "slot" | "away"; height: number } | null;

type EntryProps = {
  kp: KeyPoint;
  /** Days past its date (overdueDays), 0 = not overdue. */
  late: number;
  held: HeldState;
  first: boolean;
  last: boolean;
  flash: boolean;
  readOnly: boolean;
  today: string;
  hint: boolean;
};

/** Chip colours (§10.2 table, simplified 2026-10-02): 等别人 / 检查点 / 对方 orange, else grey. */
function chipTone(kp: KeyPoint): "neutral" | "rm" {
  if (kp.kind === "note") return kp.who === "me" ? "neutral" : "rm";
  return kp.doneDate !== null || kp.kind === "do" ? "neutral" : "rm";
}

function chipText(kp: KeyPoint): string {
  if (kp.kind === "note") return t(kp.who === "me" ? "detail.who.me" : "detail.who.them");
  return t(`detail.kind.${kp.kind}`);
}

function InlineEdit({ kp, onDone }: { kp: KeyPoint; onDone: () => void }) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [value, setValue] = useState(kp.text);
  const save = () => {
    const text = value.trim();
    onDone();
    if (text && text !== kp.text)
      void mutate(() => api.updateKeyPoint(kp.id, inputOf(kp, { text })));
  };
  const enter = useImeSafeEnter(save);
  useEscLayer(true, onDone, ESC_PRIORITY.inlineInput);
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: double-click opens the editor
      autoFocus
      className={styles.inlineInput}
      value={value}
      maxLength={200}
      aria-label={t("detail.timeline.editLabel")}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      {...enter}
    />
  );
}

/**
 * Date column (§10.2) as the date control: only the row's own date (2026-10-02: a done row no
 * longer shows its done date there, it looked like a date that could not be cleared). A click
 * opens the picker, with 清掉日期 under it when a key point has a date (a note always keeps one).
 * Undated rows show a faint 设日期 on row hover / focus; read-only rows just show the date. The row
 * owns `open`: a swipe closes the picker (it would slide and clip with the row).
 */
function DateCell({
  kp,
  late,
  readOnly,
  today,
  open,
  setOpen,
  keyShortcuts,
}: {
  kp: KeyPoint;
  late: boolean;
  readOnly: boolean;
  today: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The row's delete keys (SwipeRow), announced on the button. */
  keyShortcuts?: string;
}) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const date = kp.date;
  if (readOnly) {
    return (
      <span className={cx(styles.entryDate, late && styles.entryDateLate)}>
        {date ? formatMD(date) : ""}
      </span>
    );
  }
  const setDate = (d: string | null) => {
    setOpen(false);
    void mutate(() => api.updateKeyPoint(kp.id, inputOf(kp, { date: d })));
  };
  return (
    <span className={styles.dateCell}>
      <Floating
        open={open}
        onClose={() => setOpen(false)}
        trigger={
          <button
            type="button"
            className={cx(
              styles.dateButton,
              late && styles.entryDateLate,
              open && styles.dateButtonOpen,
            )}
            aria-label={
              date
                ? t("detail.timeline.changeDate", { date: formatMD(date) })
                : t("detail.timeline.setDate")
            }
            aria-expanded={open}
            aria-keyshortcuts={keyShortcuts}
            data-date-cell
            onClick={() => setOpen(!open)}
          >
            {date ? (
              formatMD(date)
            ) : (
              <span className={styles.datePlaceholder}>{t("detail.timeline.setDate")}</span>
            )}
          </button>
        }
      >
        {/* Inside the row's DOM, but not part of the row: no swipe, reorder or Delete here. */}
        <div className={floatingCard} data-swipe-ignore data-no-drag>
          <MiniCalendar today={today} value={kp.date} onPick={(d) => setDate(d)} allowPast />
          {kp.date && kp.kind !== "note" && (
            <button type="button" className={styles.clearDate} onClick={() => setDate(null)}>
              {t("detail.timeline.clearDate")}
            </button>
          )}
        </div>
      </Floating>
    </span>
  );
}

/**
 * Type chip at the row's end (§10.2, 2026-10-02): a key point's type opens a menu (我来做 / 等别人 /
 * 检查点); a note's 对方 / 我 toggles. Quiet chips (quietKind, and every chip of an overdue row,
 * which ends with 「逾期 N 天」 instead) keep their place but show only on row hover / focus or
 * while the menu is open; read-only rows drop them.
 */
function KindChip({
  kp,
  late,
  readOnly,
  open,
  setOpen,
  keyShortcuts,
}: {
  kp: KeyPoint;
  late: boolean;
  readOnly: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  keyShortcuts?: string;
}) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const quiet = quietKind(kp) || late;
  const text = chipText(kp);
  const className = cx(
    styles.kindLabel,
    styles[`label_${chipTone(kp)}`],
    quiet && styles.kindQuiet,
    open && styles.kindOpen,
  );
  if (readOnly) return quiet ? null : <span className={className}>{text}</span>;
  if (kp.kind === "note") {
    const toggleWho = () =>
      void mutate(() =>
        api.updateKeyPoint(kp.id, inputOf(kp, { who: kp.who === "me" ? "them" : "me" })),
      );
    return (
      <button
        type="button"
        className={className}
        onClick={toggleWho}
        title={t("detail.timeline.toggleWho")}
        aria-keyshortcuts={keyShortcuts}
      >
        {text}
      </button>
    );
  }
  const pick = (kind: KeyPointStepKind) => {
    setOpen(false);
    if (kind !== kp.kind) void mutate(() => api.updateKeyPoint(kp.id, inputOf(kp, { kind })));
  };
  return (
    <Floating
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      className={styles.kindSlot}
      trigger={
        <button
          type="button"
          className={className}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("detail.timeline.kindLabel", { kind: text })}
          aria-keyshortcuts={keyShortcuts}
          onClick={() => setOpen(!open)}
        >
          {text}
        </button>
      }
    >
      {/* Inside the row's DOM, but not part of the row: no swipe, reorder or Delete here. */}
      <div data-swipe-ignore data-no-drag>
        <Menu
          label={t("detail.timeline.kindMenu")}
          autoFocus
          items={STEP_KINDS.map((k) => ({
            key: k,
            label: t(`detail.kind.${k}`),
            icon: KIND_ICON[k],
            checked: kp.kind === k,
            onSelect: () => pick(k),
          }))}
        />
      </div>
    </Floating>
  );
}

/** The held row (DragOverlay, §10.14): a still copy, lifted like a calendar item. Only undated
 *  rows drag, so it is never overdue. */
function LiftedEntry({ kp }: { kp: KeyPoint }) {
  return (
    <div className={cx(styles.entryGrid, styles.entryLifted)}>
      <span className={styles.entryDate} />
      <span className={cx(styles.rail, styles.railFirst, styles.railLast)}>
        <KeyPointMarker kind={markerOf(kp)} size={16} />
      </span>
      <div className={styles.entryBody}>
        <div className={cx(styles.entryText, kp.doneDate !== null && styles.entryTextDone)}>
          {kp.text}
        </div>
        {!quietKind(kp) && (
          <span className={cx(styles.kindLabel, styles[`label_${chipTone(kp)}`])}>
            {chipText(kp)}
          </span>
        )}
      </div>
    </div>
  );
}

function Entry({ kp, late, held, first, last, flash, readOnly, today, hint }: EntryProps) {
  const { t } = useTranslation();
  const mutate = useDataStore((s) => s.mutate);
  const [editing, setEditing] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const note = kp.kind === "note";
  const done = kp.doneDate !== null;
  const draggable = !readOnly && !editing && canReorder(kp);
  // Delete / Backspace on the row's controls opens 删除 (SwipeRow); screen readers announce it.
  const deleteKeys = readOnly || editing ? undefined : SWIPE_DELETE_KEYS;
  // The row never moves itself: a lifted copy follows the pointer and this one stays as a ghost.
  const { setNodeRef, listeners } = useDraggable({ id: kp.id, disabled: !draggable });
  const marker: MarkerKind | NoteMarkerKind = note
    ? kp.who === "me"
      ? "noteMe"
      : "noteThem"
    : markerOf(kp, late > 0);

  const toggleDone = () => {
    if (readOnly || note) return;
    void mutate(() => api.setKeyPointDone(kp.id, !done));
  };
  const remove = () =>
    void mutate(() => api.deleteKeyPoint(kp.id), {
      toast: {
        text: note
          ? t("detail.timeline.deletedNote")
          : t("detail.timeline.deleted", { text: kp.text }),
      },
    });

  // Held (§10.14): the same <li> (the drag source) stands in as the slot, or closes once moved.
  if (held) {
    return (
      <li
        ref={setNodeRef}
        className={cx(styles.entry, held.mode === "slot" ? styles.dropSlot : styles.heldAway)}
        style={held.mode === "slot" ? { height: held.height } : undefined}
        data-kp-id={kp.id}
        aria-hidden="true"
      >
        {held.mode === "slot" && t("detail.timeline.dropHere")}
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      className={cx(styles.entry, draggable && styles.entryDraggable)}
      data-kp-id={kp.id}
      data-late={late > 0 ? "true" : undefined}
      {...listeners}
    >
      <SwipeRow
        className={styles.entrySwipe}
        overlay
        surfaceClassName={cx(styles.entryGrid, flash && styles.flash)}
        right={
          readOnly || note || editing
            ? null
            : {
                label: t(done ? "detail.timeline.swipeUndo" : "detail.timeline.swipeDone"),
                icon: done ? (
                  <ArrowCounterClockwiseIcon size={14} weight="bold" />
                ) : (
                  <CheckIcon size={14} weight="bold" />
                ),
                tone: done ? "muted" : "st",
                run: toggleDone,
              }
        }
        onDelete={readOnly || editing ? null : remove}
        deleteLabel={t("detail.timeline.delete")}
        hint={hint && !readOnly}
        onSwipeStart={() => {
          setDateOpen(false);
          setKindOpen(false);
        }}
      >
        <DateCell
          kp={kp}
          late={late > 0}
          readOnly={readOnly}
          today={today}
          open={dateOpen}
          setOpen={setDateOpen}
          keyShortcuts={deleteKeys}
        />
        <span
          className={cx(styles.rail, first && styles.railFirst, last && styles.railLast)}
          aria-hidden={note || readOnly ? true : undefined}
        >
          <KeyPointMarker
            kind={marker}
            size={16}
            onClick={note || readOnly ? undefined : toggleDone}
            label={
              note || readOnly
                ? undefined
                : t(done ? "detail.timeline.uncheck" : "detail.timeline.check", { text: kp.text })
            }
            keyShortcuts={deleteKeys}
          />
        </span>
        <div className={styles.entryBody}>
          {editing ? (
            <InlineEdit kp={kp} onDone={() => setEditing(false)} />
          ) : (
            // biome-ignore lint/a11y/noStaticElementInteractions: double-click = inline edit (§10.6)
            <div
              className={cx(styles.entryText, done && !note && styles.entryTextDone)}
              onDoubleClick={() => !readOnly && setEditing(true)}
            >
              {kp.text}
            </div>
          )}
          {!editing && (
            <KindChip
              kp={kp}
              late={late > 0}
              readOnly={readOnly}
              open={kindOpen}
              setOpen={setKindOpen}
              keyShortcuts={deleteKeys}
            />
          )}
          {/* Last, so it sits at the row's end like a chip; the quiet type chip shows before it on
              hover. */}
          {!editing && late > 0 && (
            <span className={styles.lateLabel}>{t("detail.timeline.late", { count: late })}</span>
          )}
        </div>
      </SwipeRow>
    </li>
  );
}

type TimelineProps = {
  entries: KeyPoint[];
  /** Overdue steps → days past their date (lib/keyPoint.ts overdueByKp). */
  overdue: Map<string, number>;
  flashId: string | null;
  readOnly: boolean;
  summary: string | null;
  today: string;
  /** The row that peeks at its swipe actions (useSwipeHint), if any. */
  hintId?: string | null;
};

/** The held row: where it was (`from`) and would land (`index`), both among the other rows. */
type Held = { id: string; height: number; from: number; index: number };

/** 「放到这里」 (§10.14): the calendar's drop slot (§2.7), as tall as the held row. */
function DropSlot({ height }: { height: number }) {
  const { t } = useTranslation();
  return (
    <li className={styles.dropSlot} style={{ height }} aria-hidden="true">
      {t("detail.timeline.dropHere")}
    </li>
  );
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export const Timeline = forwardRef<HTMLOListElement, TimelineProps>(function Timeline(
  { entries, overdue, flashId, readOnly, summary, today, hintId = null },
  ref,
) {
  const patchLocal = useDataStore((s) => s.patchLocal);
  const mutate = useDataStore((s) => s.mutate);
  const setDragging = useUiStore((s) => s.setDragging);
  const [held, setHeldState] = useState<Held | null>(null);
  // dnd-kit hands its events to the handlers of the render it started in: read the live value.
  const heldRef = useRef<Held | null>(null);
  const setHeld = (h: Held | null) => {
    heldRef.current = h;
    setHeldState(h);
  };
  const origin = useRef<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const sensors = useSensors(useSensor(StepSensor, { activationConstraint: STEP_CONSTRAINT }));
  const accessibility = useDragA11y("step");
  // dnd-kit cancels on Esc itself; this layer only keeps Esc from closing the detail.
  useEscLayer(held !== null, () => undefined, ESC_PRIORITY.drag);
  useEffect(() => () => setStepCursor(false), []);

  const setListRef = (el: HTMLOListElement | null) => {
    listRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLOListElement | null }).current = el;
  };

  const onStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    const node = listRef.current?.querySelector<HTMLElement>(`[data-kp-id="${id}"]`);
    const from = entries.findIndex((k) => k.id === id);
    origin.current = pointOf(e.activatorEvent);
    setHeld({ id, height: node?.offsetHeight ?? 40, from, index: from });
    setDragging(true);
    setStepCursor(true);
  };

  // Where it lands: among the other rows' midpoints, read from the live DOM like the calendar
  // (§2.7), but as if the slot were not there. There is always exactly one slot-high gap, at
  // `index` (the held row itself while in place, else 「放到这里」 with the held row closed), so the
  // rows from `index` on are pushed down by its height.
  const onMove = (e: DragMoveEvent) => {
    const h = heldRef.current;
    const o = origin.current;
    const list = listRef.current;
    if (!h || !o || !list) return;
    const y = o.y + e.delta.y;
    const mids = [...list.querySelectorAll<HTMLElement>("[data-kp-id]")]
      .filter((el) => el.dataset.kpId !== h.id)
      .map((el, i) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 - (i >= h.index ? h.height : 0);
      });
    const index = insertIndexAt(mids, y);
    if (index !== h.index) setHeld({ ...h, index });
  };

  const finish = () => {
    setHeld(null);
    origin.current = null;
    setDragging(false);
    setStepCursor(false);
  };

  // Drop: the new neighbours go to move_key_point; the row moves locally first (no jump back).
  const onEnd = () => {
    const h = heldRef.current;
    finish();
    if (!h || h.index === h.from) return;
    const others = entries.filter((k) => k.id !== h.id);
    const prev = others[h.index - 1] ?? null;
    const next = others[h.index] ?? null;
    const key = provisionalKey(prev?.sortKey ?? null, next?.sortKey ?? null);
    patchLocal((s) => ({
      ...s,
      keyPoints: s.keyPoints.map((k) => (k.id === h.id ? { ...k, sortKey: key } : k)),
    }));
    void mutate(() => api.moveKeyPoint(h.id, prev?.id ?? null, next?.id ?? null));
  };

  const heldKp = held ? (entries.find((k) => k.id === held.id) ?? null) : null;
  const others = held ? entries.filter((k) => k.id !== held.id) : entries;
  const slotBefore = held ? (others[held.index]?.id ?? "end") : null;
  // A drop that moves the row needs no flight back; a cancel (Esc, same place) flies back home.
  const moves = held !== null && held.index !== held.from;
  const heldState = (id: string): HeldState =>
    held?.id === id ? { mode: moves ? "away" : "slot", height: held.height } : null;

  return (
    <>
      {summary && (
        <div className={styles.summary}>
          <QuotesIcon size={14} weight="fill" className={styles.summaryIcon} />
          <span>{summary}</span>
        </div>
      )}
      {entries.length === 0 ? (
        <div className={styles.emptyTimeline} aria-hidden>
          <ListChecksIcon size={22} />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          modifiers={[vertical]}
          accessibility={accessibility}
          onDragStart={onStart}
          onDragMove={onMove}
          onDragEnd={onEnd}
          onDragCancel={finish}
          autoScroll={{ threshold: { x: 0, y: 0.15 } }}
        >
          <ol
            ref={setListRef as Ref<HTMLOListElement>}
            className={cx(styles.timeline, held && styles.timelineDragging)}
          >
            {entries.map((kp, i) => (
              <Fragment key={kp.id}>
                {held && moves && slotBefore === kp.id && <DropSlot height={held.height} />}
                <Entry
                  kp={kp}
                  late={overdue.get(kp.id) ?? 0}
                  held={heldState(kp.id)}
                  first={i === 0}
                  last={i === entries.length - 1}
                  flash={flashId === kp.id}
                  readOnly={readOnly}
                  today={today}
                  hint={hintId === kp.id}
                />
              </Fragment>
            ))}
            {held && moves && slotBefore === "end" && <DropSlot height={held.height} />}
          </ol>
          {createPortal(
            <DragOverlay
              className={styles.liftedLayer}
              zIndex={200}
              dropAnimation={
                moves || reducedMotion() ? null : { duration: 150, easing: "ease-out" }
              }
            >
              {heldKp ? <LiftedEntry kp={heldKp} /> : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      )}
    </>
  );
});
