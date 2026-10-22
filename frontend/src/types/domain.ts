// Domain + view types shared by lib/, hooks/ and components/.
//
// Entity / input / payload types are generated from Rust into ./bindings.ts and re-exported
// here, so feature code imports everything from "@/types/domain". View types below are the
// contract between lib/* (produces them) and the components (consume them): change a type here
// and fix both sides in the same commit.

import type { KeyPoint, Task, Todo } from "./bindings";

export type * from "./bindings";

/** 2 / 3 / 4 weeks on the calendar page. */
export type CalendarWeeks = 2 | 3 | 4;

/** Settings.language ("system" | "zh-Hans" | "en") and Settings.calendarFirstRow ("thisWeek" |
 *  "lastWeek") come from ./bindings; the resolved UI language is `Lang` in "@/i18n". */

/** Where the calendar's home position is relative to the current view (null = at home):
 *  lib/dates.ts homeDirection, components/calendar/calendarNav.ts useHomeDirection. */
export type HomeDirection = "up" | "down" | null;

/** Window pages. `archive` is a layer under "tasks" and is never remembered in settings. */
export type Page = "calendar" | "tasks" | "archive";

/** Semantic colour family (visual spec §3): event / reminder / start / due + neutral grey. */
export type Tone = "ev" | "rm" | "st" | "du" | "neutral";

/** Text colour used by derived labels (time bar, archive meta…). Maps to --text / --text-muted /
 *  --text-3 / --st-text / --du-text / --du-text at 70% / --rm-text. */
export type TextTone = "text" | "muted" | "subtle" | "st" | "du" | "rm";

/** Displayed task status (ui-spec §0.5): `upcoming` = 未开始, `overdue` = 逾期 (both derived). */
export type DisplayStatus = "active" | "waiting" | "done" | "overdue" | "upcoming";

/** Key point marker (ui-spec §9.1–§9.2): done, overdue (§9.3), else by type (idle = 我来做). */
export type MarkerKind = "done" | "overdue" | "wait" | "check" | "idle";

/** Note ("记一笔") marker in the detail timeline: 对方 / 我 (ui-spec §9.2). */
export type NoteMarkerKind = "noteThem" | "noteMe";

/** Key point kinds that are real key points (notes excluded). */
export type KeyPointStepKind = "do" | "wait" | "check";

// ── Task time bar (ui-spec §8.4, §20) ────────────────────────────────────────────────────────

export type TimeBarLabel = { text: string; tone: TextTone; strong: boolean };

export type TimeBarView = {
  /** Upper-left label, e.g. 「今天 · 第 2 / 4 天」. */
  topLeft: TimeBarLabel;
  /** Upper-right label, e.g. 「还剩 2 天」; null when nothing is shown. */
  topRight: TimeBarLabel | null;
  /** Fill ratio 0..1. */
  fill: number;
  /** Fill colour: active → st, waiting → rm, overdue → du, done → --task-done-bar, none = track only. */
  fillTone: "st" | "rm" | "du" | "done" | "none";
  /** Lower row 「9/29 开始」……「10/2 截止」; null when hidden (no due date). */
  bottom: { start: TimeBarLabel; end: TimeBarLabel } | null;
  /** The card's bare date range (ui-spec §8.4): 「9/29 – 10/2」 (due null = no due date, ∞). */
  ends: { start: string; due: string | null };
  /** The card's one visible sentence (ui-spec §8.4), always top left with its count set large:
   *  「还剩 25 天」「已过 3 天」「还有 8 天」「已进行 19 天」. */
  headline: TimeBarLabel;
  /** The other sentence, muted (the detail shows it on the right, ui-spec §10.2): 「今天 · 第 13 /
   *  15 天」 next to 「还剩 2 天」; null without a due date or when overdue. */
  aside: TimeBarLabel | null;
};

/** Detail view time block (ui-spec §10.1–§10.2, §20.1 last rows). */
export type DetailTrackView = {
  /** Same texts / fill as the card (Row2, track fill, Row3). */
  bar: TimeBarView;
  /** Position of the "today" tick, 0..1; null when today is outside [start, due], not started,
   *  done without due, or a step marker sits on today (the marker stands for it). */
  todayAt: number | null;
  /** Markers for dated steps, notes excluded (clamped to 0..1), each with the step's own icon;
   *  only markers that cannot sit apart merge (`count`, `tip` lists them). */
  dots: {
    keyPointId: string;
    at: number;
    marker: MarkerKind;
    count: number;
    tip: string;
  }[];
  /** Red due dot (task has a due date); without one the track is open-ended. */
  dueDot: boolean;
  /** Where the due dot sits, 0..1: 1 unless steps dated after the due date stretch the track
   *  (then the part after it is a dashed tail); null without a due date. */
  dueAt: number | null;
  /** Latest open step dated after the due date of an unfinished task: the date the due date
   *  could move to; null when there is none. */
  extendTo: string | null;
  /** How many such open steps after the due date there are (a new one re-offers the move). */
  lateCount: number;
  /** Due − 1 day, for 「截止前一天提醒我（10/30）」; null without due date. */
  remindDate: string | null;
};

// ── Calendar (ui-spec §2.5) ──────────────────────────────────────────────────────────────────

export type CalKind = "event" | "reminder" | "checkpoint" | "start" | "due";

export type CalItem = {
  /** 'event:<id>' | 'todo:<id>' | 'kp:<id>' | 'start:<taskId>' | 'due:<taskId>' */
  key: string;
  kind: CalKind;
  date: string;
  title: string;
  time: string | null;
  endTime: string | null;
  /** Todo done / key point done / task done → 0.45 opacity + strike-through. */
  done: boolean;
  /** Due marker of an overdue unfinished task, or an overdue step (ui-spec §9.3): stays opaque
   *  on past days; an overdue step is drawn in --du. */
  overdue: boolean;
  /** Event / todo / task / key point id. */
  sourceId: string;
  taskId: string | null;
};

/** Small label in a day head (ui-spec §2.4): 「国庆 · 2」「寒露」「补班」. */
export type DayLabel = { text: string; kind: "holiday" | "term" | "workday" };

/** Today pill on the calendar page (ui-spec §3). A part is hidden when 0 / null. */
export type TodayPillView = {
  /** Overdue steps (ui-spec §9.3): the first one's task (date, then board order); `count` = all of
   *  them, across tasks. */
  overdue: { taskId: string; title: string; count: number } | null;
  /** Open todos in the to-do list (whatever day they were added). */
  todos: number;
  /** Nearest not-done, not-overdue due date; days = due − today (0 → 「今天截止」). */
  due: { taskId: string; title: string; days: number } | null;
  /** Key points to check tomorrow; `more` = how many beyond the first (「等 2 项」 when > 0). */
  check: { taskId: string; title: string; more: number } | null;
  /** Unprocessed inbox items. */
  inbox: number;
  /** All five parts hidden → 「今天没有要紧的事」. */
  empty: boolean;
};

/** Reminder tag of a todo row (ui-spec §5.4). */
export type TodoTag = {
  /** 「今天 18:00」「明天」「10/9」… */
  text: string;
  /** du = overdue reminder, rm = reminder. */
  tone: "du" | "rm";
};

// ── Archive (ui-spec §14.4–§14.7) ────────────────────────────────────────────────────────────

export type ArchiveEntry =
  | {
      kind: "todo";
      id: string;
      title: string;
      /** Completion date (grouping key). */
      date: string;
      /** UTC ms for in-group ordering (newest first). */
      at: number;
      todo: Todo;
    }
  | {
      kind: "task";
      id: string;
      title: string;
      /** Completion date, or archive date when archived unfinished. */
      date: string;
      at: number;
      task: Task;
      /** Key points and notes of the task, timeline order. */
      keyPoints: KeyPoint[];
      /** Archived while not done (meta ends with 「没做完」). */
      unfinished: boolean;
    };

export type ArchiveGroup = {
  key: string;
  /** 「今天 · 9/30 周三」「上周 · 9/21 – 9/27」「更早 · 9 月上旬 4 条」 */
  label: string;
  /** 「更早」 groups start collapsed. */
  collapsed: boolean;
  entries: ArchiveEntry[];
};

// ── UI state (hooks/useUiStore.ts) ─────────────────────────────────────────────────────────────

/** Viewport rectangle of the element a popover is anchored to. */
export type AnchorRect = { top: number; left: number; width: number; height: number };

export type Overlay =
  | { kind: "taskDetail"; taskId: string; focusKeyPointId?: string; readOnly?: boolean }
  | { kind: "archiveConfirm"; taskId: string }
  | { kind: "settings" };

export type Popover =
  | {
      kind: "datePicker";
      purpose: "todoReminder" | "inboxSchedule";
      targetId: string;
      anchor: AnchorRect;
    }
  | { kind: "newTask"; fromInboxId?: string; title: string; anchor: AnchorRect };

/** Why a card / row is highlighted for ~3 s (card footer: fromInbox → 「新 · 刚从收件箱变来」). */
export type HighlightReason = "new" | "fromInbox" | "restored";

export type ToastState = {
  text: string;
  mergeKey?: string;
  /** Per-category counts used when merging, e.g. { todo: 1, task: 2 }. */
  meta: Record<string, number>;
  /** Every op this toast can undo, in the order they happened. */
  opIds: string[];
  /** Epoch ms when the toast disappears (Infinity while hovered). */
  until: number;
  /** Already undone: shows 「已撤销」 and no undo button. */
  undone: boolean;
  /** Remaining ms captured when hover paused the timer. */
  pausedRemaining?: number;
  /** "notice": nothing was done (a refused move, a failed write) — info icon instead of ✓. */
  tone?: ToastTone;
};

export type ToastTone = "done" | "notice";

export type ToastSpec = {
  text: string;
  /** Same key + previous toast still visible → `merge` is called and op ids accumulate. */
  mergeKey?: string;
  meta?: Record<string, number>;
  merge?: (prev: ToastState, next: ToastSpec) => { text: string; meta: Record<string, number> };
  /** Default "done" (✓). */
  tone?: ToastTone;
};
