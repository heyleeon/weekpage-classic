// In-memory backend for the browser preview and component tests (architecture §3).
//
// Not a second implementation of the business rules: it reads the demo fixture generated from
// the Rust seed, supports settings / cache / undo, and implements with `mockWrite` the 19 write
// operations the demo script needs, plus `setTaskDates` / `updateKeyPoint` that the
// calendar's cross-day drag uses. Every other write rejects with
// "not implemented in preview: <name>". Undo is the blunt version: each op keeps a copy of the
// whole snapshot from before it ran. The writes follow the Rust repositories loosely (no history,
// no tombstones: deleted rows simply leave the snapshot); correctness is pinned by the Rust tests.
// The detail's step gestures (§10.14) also run here: `moveKeyPoint`, `deleteKeyPoint`, and
// dated key points keeping date order on add / update (`dateSlotKey`).

import type {
  EventInput,
  KeyPoint,
  KeyPointInput,
  Mutation,
  NewTaskInput,
  Settings,
  SettingsPatch,
  ShortcutStatus,
  Snapshot,
  Task,
  TaskStatus,
  Todo,
  TodoInput,
} from "@/types/domain";
import fixture from "./__fixtures__/demo-snapshot.json";
import type { Api, LogLevel, Unlisten } from "./api";
import { ApiError } from "./api";
import { clockOffset, isValidTimezone, nowMs, todayStr } from "./clock";
import { isMac } from "./platform";

const FIXTURE = fixture as Snapshot;

/** Event names mirrored from the Rust side (backend/src/model.rs). */
export type MockEventName =
  | "shell://shown"
  | "shell://hidden"
  | "shell://navigate"
  | "shell://shortcut-status"
  | "clock://day-changed"
  | "input://trackpad";

type Listener = (payload: unknown) => void;

type MockState = {
  snap: Snapshot;
  /** Ops in the order they ran, each with the snapshot from before it. */
  ops: { opId: string; before: Snapshot }[];
  cache: Map<string, string>;
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Settings defaults = the Rust fixture (Settings::fixture(), language "system", first row
 *  "thisWeek"). Snapshots handed to resetMockBackend that predate a field get it from here. */
export const MOCK_SETTINGS_DEFAULTS: Settings = FIXTURE.settings;

let state: MockState = fresh(FIXTURE);
const listeners = new Map<MockEventName, Set<Listener>>();

function fresh(snap: Snapshot): MockState {
  const s = clone(snap);
  s.settings = { ...MOCK_SETTINGS_DEFAULTS, ...s.settings };
  return { snap: s, ops: [], cache: new Map() };
}

/** Tests: start over from the fixture (or a given snapshot). */
export function resetMockBackend(snap: Snapshot = FIXTURE): void {
  state = fresh(snap);
}

/** A copy of the current mock data. */
export function mockSnapshot(): Snapshot {
  return clone(state.snap);
}

export type MockWriteContext = {
  opId: string;
  /** Epoch ms from lib/clock (honours ?now=). */
  now: number;
  /** 'YYYY-MM-DD' from lib/clock. */
  today: string;
  newId(): string;
};

/**
 * Runs one preview write: `run` mutates a draft copy and returns the id of the created / changed
 * row (becomes `Mutation.id`). Throwing inside `run` leaves the data untouched.
 */
export function mockWrite(
  run: (draft: Snapshot, ctx: MockWriteContext) => string | null,
): Mutation {
  const opId = crypto.randomUUID();
  const before = clone(state.snap);
  const draft = clone(state.snap);
  const id = run(draft, {
    opId,
    now: nowMs(),
    today: todayStr(),
    newId: () => crypto.randomUUID(),
  });
  state.snap = draft;
  state.ops.push({ opId, before });
  return { opId, id };
}

/** Restores the snapshot from before the earliest of `opIds`; later ops are forgotten. */
export function mockUndo(opIds: string[]): void {
  if (opIds.length === 0) throw new ApiError("invalid", "undo needs at least one op id");
  const indexes = opIds.map((id) => state.ops.findIndex((o) => o.opId === id));
  if (indexes.some((i) => i < 0)) {
    throw new ApiError("conflict", "op is unknown or expired");
  }
  const earliest = Math.min(...indexes);
  state.snap = clone(state.ops[earliest].before);
  state.ops = state.ops.slice(0, earliest);
}

/** Simulates a Rust → TS event (tests, preview console: `__wp`). */
export function mockEmit(name: MockEventName, payload: unknown): void {
  for (const cb of listeners.get(name) ?? []) cb(payload);
}

function subscribe<T>(name: MockEventName, cb: (p: T) => void): Promise<Unlisten> {
  const set = listeners.get(name) ?? new Set<Listener>();
  listeners.set(name, set);
  const listener: Listener = (p) => cb(p as T);
  set.add(listener);
  return Promise.resolve(() => {
    set.delete(listener);
  });
}

const SETTINGS_ENUMS: Partial<Record<keyof Settings, readonly unknown[]>> = {
  theme: ["system", "light", "dark"],
  lastPage: ["calendar", "tasks"],
  calendarWeeks: [2, 3, 4],
  language: ["system", "zh-Hans", "en"],
  calendarFirstRow: ["thisWeek", "lastWeek"],
};

/** Same rejections as Rust (db/settings.rs validate + serde enums). */
function validatePatch(patch: SettingsPatch): void {
  for (const [k, allowed] of Object.entries(SETTINGS_ENUMS)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && !allowed.includes(v)) {
      throw new ApiError("invalid", `${k} has an unsupported value: ${String(v)}`);
    }
  }
  if (typeof patch.shortcut === "string" && patch.shortcut.trim() === "") {
    throw new ApiError("invalid", "shortcut must not be empty");
  }
  if (typeof patch.timezone === "string" && patch.timezone !== "system") {
    if (!isValidTimezone(patch.timezone)) {
      throw new ApiError("invalid", `timezone must be "system" or an IANA zone name`);
    }
  }
}

function applyPatch(s: Settings, patch: SettingsPatch): Settings {
  validatePatch(patch);
  const next: Settings = { ...s };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null && k in next) {
      (next as Record<string, unknown>)[k] = v;
    }
  }
  return next;
}

function shortcutOf(s: Settings): ShortcutStatus {
  return { accelerator: s.shortcut, registered: false, error: null, conflict: null };
}

// ── preview writes ─────────────────────────────────────────────────────────────────────────

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Midpoint of fractional keys `a` ("" = 0) and `b` (null = 1); same scheme as Rust sort_key.rs. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.ceil((da + db) / 2)];
  if (b !== null && b.length > 1) return b[0];
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** A sort key strictly between `prev` and `next` (null = open end). */
export function keyBetween(prev: string | null, next: string | null): string {
  if (prev !== null && next !== null && !(prev < next)) {
    throw new ApiError("invalid", `sort keys out of order: ${prev} >= ${next}`);
  }
  return midpoint(prev ?? "", next);
}

function byKeys<T>(...keys: ((row: T) => string | number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const k of keys) {
      const x = k(a);
      const y = k(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
}

/** Re-establishes the total order `load_snapshot` guarantees. */
function normalize(s: Snapshot): void {
  s.events.sort(
    byKeys(
      (e) => e.date,
      (e) => e.id,
    ),
  );
  s.todos.sort(
    byKeys(
      (t) => t.sortKey,
      (t) => t.id,
    ),
  );
  s.inbox.sort(
    byKeys(
      (i) => i.sortKey,
      (i) => i.id,
    ),
  );
  s.tasks.sort(
    byKeys(
      (t) => t.boardColumn,
      (t) => t.sortKey,
      (t) => t.id,
    ),
  );
  s.keyPoints.sort(
    byKeys(
      (k) => k.taskId,
      (k) => k.sortKey,
      (k) => k.id,
    ),
  );
  s.dayOrders.sort(
    byKeys(
      (o) => o.date,
      (o) => o.id,
    ),
  );
}

/** `mockWrite` + the snapshot order restored afterwards. */
function write(run: (draft: Snapshot, ctx: MockWriteContext) => string | null): Promise<Mutation> {
  try {
    return Promise.resolve(
      mockWrite((draft, ctx) => {
        const id = run(draft, ctx);
        normalize(draft);
        return id;
      }),
    );
  } catch (e) {
    return Promise.reject(e);
  }
}

function text(raw: string, field: string, max: number): string {
  const t = raw.trim();
  if (t.length === 0) throw new ApiError("invalid", `${field} must not be empty`);
  if ([...t].length > max) throw new ApiError("invalid", `${field} is too long`);
  return t;
}

function find<T extends { id: string }>(rows: T[], id: string, what: string): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new ApiError("not_found", `${what} ${id} not found`);
  return row;
}

function remove<T extends { id: string }>(rows: T[], id: string, what: string): void {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) throw new ApiError("not_found", `${what} ${id} not found`);
  rows.splice(i, 1);
}

function maxKey(keys: string[]): string | null {
  return keys.reduce<string | null>((m, k) => (m === null || k > m ? k : m), null);
}

function minKey(keys: string[]): string | null {
  return keys.reduce<string | null>((m, k) => (m === null || k < m ? k : m), null);
}

/** New key between two neighbours of `rows` (ids may be null / undefined = open end). */
function moveKey<T extends { id: string; sortKey: string }>(
  rows: T[],
  prevId: string | null | undefined,
  nextId: string | null | undefined,
): string {
  const keyOf = (id: string | null | undefined) =>
    id ? find(rows, id, "neighbour").sortKey : null;
  return keyBetween(keyOf(prevId), keyOf(nextId));
}

function columnOf(column: number): 0 | 1 | 2 {
  if (column !== 0 && column !== 1 && column !== 2) {
    throw new ApiError("invalid", `board column must be 0, 1 or 2, got ${column}`);
  }
  return column;
}

/** Unchecking / restoring a todo whose reminder day is over drops the reminder. */
function clearPastReminder(t: Todo, today: string): void {
  if (t.remindDate !== null && t.remindDate < today) {
    t.remindDate = null;
    t.remindTime = null;
  }
}

function kpRow(
  taskId: string,
  input: KeyPointInput,
  sortKey: string,
  ctx: MockWriteContext,
): KeyPoint {
  const note = input.kind === "note";
  return {
    id: ctx.newId(),
    taskId,
    kind: input.kind,
    text: text(input.text, "key point text", 200),
    date: input.date ?? (note ? ctx.today : null),
    who: note ? (input.who ?? "them") : null,
    sortKey,
    doneDate: null,
    isCurrent: false,
    currentSince: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

function lastKpKey(s: Snapshot, taskId: string): string | null {
  return maxKey(s.keyPoints.filter((k) => k.taskId === taskId).map((k) => k.sortKey));
}

/**
 * Like Rust key_points::date_slot: a key that puts a key point dated `date` into date order, or
 * null when its place already fits (`own` = the row being redated; null = a new, appended row).
 */
function dateSlotKey(
  s: Snapshot,
  taskId: string,
  own: KeyPoint | null,
  date: string,
  notes = false,
): string | null {
  const rows = s.keyPoints
    .filter((k) => k.taskId === taskId && k.id !== own?.id)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const dateOf = (k: KeyPoint) => (k.kind === "note" && !notes ? null : k.date);
  const before = (k: KeyPoint) => own === null || k.sortKey < own.sortKey;
  const fits = rows.every((k) => {
    const d = dateOf(k);
    return d === null || (before(k) ? d <= date : d >= date);
  });
  if (fits) return null;
  const i = rows.findIndex((k) => (dateOf(k) ?? "") > date);
  if (i >= 0) return keyBetween(i > 0 ? rows[i - 1].sortKey : null, rows[i].sortKey);
  const last = rows.findLastIndex((k) => dateOf(k) !== null);
  return keyBetween(rows[last]?.sortKey ?? null, rows[last + 1]?.sortKey ?? null);
}

function createEvent(input: EventInput): Promise<Mutation> {
  return write((s, ctx) => {
    const id = ctx.newId();
    s.events.push({
      id,
      date: input.date,
      time: input.time ?? null,
      endTime: input.time ? (input.endTime ?? null) : null,
      title: text(input.title, "title", 200),
      location: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return id;
  });
}

function updateEvent(id: string, input: EventInput): Promise<Mutation> {
  return write((s, ctx) => {
    const e = find(s.events, id, "event");
    e.title = text(input.title, "title", 200);
    e.date = input.date;
    e.time = input.time ?? null;
    e.endTime = input.time ? (input.endTime ?? null) : null;
    e.updatedAt = ctx.now;
    return id;
  });
}

function setDayOrder(date: string, itemKeys: string[]): Promise<Mutation> {
  return write((s, ctx) => {
    const keys = [...new Set(itemKeys.map((k) => k.trim()))];
    const row = s.dayOrders.find((o) => o.date === date);
    if (row) {
      row.itemKeys = keys;
      row.updatedAt = ctx.now;
      return row.id;
    }
    const id = ctx.newId();
    s.dayOrders.push({ id, date, itemKeys: keys, createdAt: ctx.now, updatedAt: ctx.now });
    return id;
  });
}

function createTodo(input: TodoInput, fromInboxId?: string | null): Promise<Mutation> {
  return write((s, ctx) => {
    const title = text(input.title, "title", 200);
    if (fromInboxId) remove(s.inbox, fromInboxId, "inbox item");
    const id = ctx.newId();
    s.todos.push({
      id,
      title,
      sortKey: keyBetween(maxKey(s.todos.map((t) => t.sortKey)), null),
      remindDate: input.remindDate ?? null,
      remindTime: input.remindDate ? (input.remindTime ?? null) : null,
      createdDate: ctx.today,
      doneAt: null,
      doneDate: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return id;
  });
}

function updateTodo(id: string, input: TodoInput): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.todos, id, "todo");
    t.title = text(input.title, "title", 200);
    t.remindDate = input.remindDate ?? null;
    t.remindTime = input.remindDate ? (input.remindTime ?? null) : null;
    t.updatedAt = ctx.now;
    return id;
  });
}

function setTodoDone(id: string, done: boolean): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.todos, id, "todo");
    if (done && t.doneDate === null) {
      t.doneAt = ctx.now;
      t.doneDate = ctx.today;
    } else if (!done) {
      t.doneAt = null;
      t.doneDate = null;
      clearPastReminder(t, ctx.today);
    }
    t.updatedAt = ctx.now;
    return id;
  });
}

function restoreTodo(id: string): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.todos, id, "todo");
    t.sortKey = keyBetween(maxKey(s.todos.map((x) => x.sortKey)), null);
    t.doneAt = null;
    t.doneDate = null;
    clearPastReminder(t, ctx.today);
    t.updatedAt = ctx.now;
    return id;
  });
}

function moveTodo(id: string, prevId?: string | null, nextId?: string | null): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.todos, id, "todo");
    t.sortKey = moveKey(s.todos, prevId, nextId);
    t.updatedAt = ctx.now;
    return id;
  });
}

function createInboxItem(raw: string): Promise<Mutation> {
  return write((s, ctx) => {
    const id = ctx.newId();
    s.inbox.push({
      id,
      text: text(raw, "text", 500),
      sortKey: keyBetween(null, minKey(s.inbox.map((i) => i.sortKey))),
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return id;
  });
}

function createTask(input: NewTaskInput): Promise<Mutation> {
  return write((s, ctx) => {
    const title = text(input.title, "title", 200);
    const column = columnOf(input.column);
    if (input.dueDate && input.dueDate < input.startDate) {
      throw new ApiError("invalid", "due date is before start date");
    }
    if (input.fromInboxId) remove(s.inbox, input.fromInboxId, "inbox item");
    const top = minKey(s.tasks.filter((t) => t.boardColumn === column).map((t) => t.sortKey));
    const id = ctx.newId();
    s.tasks.push({
      id,
      title,
      status: "active",
      startDate: input.startDate,
      dueDate: input.dueDate ?? null,
      lastDueDate: null,
      remindDayBefore: input.remindDayBefore,
      boardColumn: column,
      sortKey: keyBetween(null, top),
      doneAt: null,
      doneDate: null,
      archivedAt: null,
      archivedDate: null,
      summary: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    let last: string | null = null;
    for (const kp of input.keyPoints) {
      last = keyBetween(last, null);
      s.keyPoints.push(kpRow(id, kp, last, ctx));
    }
    return id;
  });
}

function addKeyPoint(taskId: string, input: KeyPointInput): Promise<Mutation> {
  return write((s, ctx) => {
    find(s.tasks, taskId, "task");
    const timeline = s.keyPoints.filter((k) => k.taskId === taskId);
    let key = keyBetween(lastKpKey(s, taskId), null);
    if (input.kind === "note") {
      // before the first open key point ("now" on the timeline), else at the end
      const i = timeline.findIndex((k) => k.kind !== "note" && k.doneDate === null);
      if (i >= 0) key = keyBetween(i > 0 ? timeline[i - 1].sortKey : null, timeline[i].sortKey);
    } else if (input.date) {
      key = dateSlotKey(s, taskId, null, input.date) ?? key;
    }
    const row = kpRow(taskId, input, key, ctx);
    s.keyPoints.push(row);
    return row.id;
  });
}

function setKeyPointDone(id: string, done: boolean): Promise<Mutation> {
  return write((s, ctx) => {
    const k = find(s.keyPoints, id, "key point");
    if (k.kind === "note") throw new ApiError("invalid", "a note cannot be checked off");
    if (done && k.doneDate === null) {
      k.doneDate = ctx.today;
      k.isCurrent = false; // currentSince is kept (waiting days)
    } else if (!done) {
      k.doneDate = null;
    }
    k.updatedAt = ctx.now;
    return id;
  });
}

/** Like Rust tasks::set_dates: due ≥ start; clearing the due keeps it as lastDueDate. */
function setTaskDates(id: string, startDate: string, dueDate?: string | null): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.tasks, id, "task");
    const due = dueDate ?? null;
    if (due !== null && due < startDate) {
      throw new ApiError("invalid", "due date is before start date");
    }
    if (due === null && t.dueDate !== null) t.lastDueDate = t.dueDate;
    t.startDate = startDate;
    t.dueDate = due;
    t.updatedAt = ctx.now;
    return id;
  });
}

/** Like Rust key_points::update: kind / text / date / who replaced; a note always has a date; a
 *  redated key point moves into date order when its place no longer fits. */
function updateKeyPoint(id: string, input: KeyPointInput): Promise<Mutation> {
  return write((s, ctx) => {
    const k = find(s.keyPoints, id, "key point");
    const note = input.kind === "note";
    const date = input.date ?? (note ? ctx.today : null);
    if (!note && date !== null && (date !== k.date || k.kind === "note")) {
      k.sortKey = dateSlotKey(s, k.taskId, k, date) ?? k.sortKey;
    } else if (note && k.kind === "note" && date !== k.date && date !== null) {
      k.sortKey = dateSlotKey(s, k.taskId, k, date, true) ?? k.sortKey;
    }
    k.kind = input.kind;
    k.text = text(input.text, "key point text", 200);
    k.date = date;
    k.who = note ? (input.who ?? "them") : null;
    if (note) {
      k.doneDate = null;
      k.isCurrent = false;
    }
    k.updatedAt = ctx.now;
    return id;
  });
}

/** Like Rust key_points::move_key_point: undated key points only, neighbours in the same task. */
function moveKeyPoint(
  id: string,
  prevId?: string | null,
  nextId?: string | null,
): Promise<Mutation> {
  return write((s, ctx) => {
    const k = find(s.keyPoints, id, "key point");
    if (k.date !== null) {
      throw new ApiError(
        "invalid",
        "a dated key point follows its date; change the date to move it",
      );
    }
    const siblings = s.keyPoints.filter((x) => x.taskId === k.taskId && x.id !== id);
    k.sortKey = moveKey(siblings, prevId, nextId);
    k.updatedAt = ctx.now;
    return id;
  });
}

function setTaskStatus(id: string, status: TaskStatus): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.tasks, id, "task");
    if (t.status !== status) {
      t.status = status;
      t.doneAt = status === "done" ? ctx.now : null;
      t.doneDate = status === "done" ? ctx.today : null;
    }
    t.updatedAt = ctx.now;
    return id;
  });
}

function boardCards(s: Snapshot, column: number): Task[] {
  return s.tasks.filter((t) => t.archivedAt === null && t.boardColumn === column);
}

function moveTask(
  id: string,
  column: 0 | 1 | 2,
  prevId?: string | null,
  nextId?: string | null,
): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.tasks, id, "task");
    if (t.archivedAt !== null)
      throw new ApiError("invalid", "an archived task is not on the board");
    const col = columnOf(column);
    t.sortKey = moveKey(boardCards(s, col), prevId, nextId);
    t.boardColumn = col;
    t.updatedAt = ctx.now;
    return id;
  });
}

function archiveTask(id: string, summary?: string | null): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.tasks, id, "task");
    if (t.archivedAt !== null) throw new ApiError("invalid", `task ${id} is already archived`);
    const sum = summary?.trim() ? text(summary, "summary", 100) : null;
    t.archivedAt = ctx.now;
    t.archivedDate = ctx.today;
    t.summary = sum;
    t.updatedAt = ctx.now;
    return id;
  });
}

function restoreTask(id: string, column: 0 | 1 | 2): Promise<Mutation> {
  return write((s, ctx) => {
    const t = find(s.tasks, id, "task");
    if (t.archivedAt === null) throw new ApiError("invalid", `task ${id} is not archived`);
    const col = columnOf(column);
    const top = minKey(s.tasks.filter((x) => x.boardColumn === col).map((x) => x.sortKey));
    t.archivedAt = null;
    t.archivedDate = null;
    t.boardColumn = col;
    t.sortKey = keyBetween(null, top);
    t.updatedAt = ctx.now;
    return id;
  });
}

function deleteRow(table: "events" | "todos" | "inbox" | "keyPoints", what: string) {
  return (id: string): Promise<Mutation> =>
    write((s) => {
      remove<{ id: string }>(s[table], id, what);
      return id;
    });
}

/** Writes the preview never supports (rules live in Rust only). */
function previewOnly(name: string): () => Promise<Mutation> {
  return () =>
    Promise.reject(new ApiError("not_implemented", `not implemented in preview: ${name}`));
}

export const mockApi: Api = {
  appInfo: async () => ({
    version: "0.1.0",
    platform: isMac() ? "macos" : "windows",
    isDev: true,
    clockOffsetMs: clockOffset(),
    // The preview paints a fake wallpaper behind a transparent frame, like real vibrancy.
    vibrancy: true,
    shortcut: shortcutOf(state.snap.settings),
  }),
  loadSnapshot: async () => mockSnapshot(),
  listTaskHistory: async () => [],
  undo: async (opIds) => mockUndo(opIds),
  getCache: async (key) => state.cache.get(key) ?? null,
  setCache: async (key, value) => {
    if (!key.startsWith("cache:"))
      throw new ApiError("invalid", "cache key must start with cache:");
    state.cache.set(key, value);
  },
  windowReady: async () => undefined,
  windowHide: async () => undefined,
  setBlurGuard: async () => undefined,
  updateSettings: async (patch) => {
    state.snap.settings = applyPatch(state.snap.settings, patch);
    return { settings: clone(state.snap.settings), shortcut: shortcutOf(state.snap.settings) };
  },
  quitApp: async () => undefined,

  // the 19 preview writes
  createEvent,
  updateEvent,
  deleteEvent: deleteRow("events", "event"),
  setDayOrder,
  createTodo,
  updateTodo,
  setTodoDone,
  restoreTodo,
  moveTodo,
  deleteTodo: deleteRow("todos", "todo"),
  createInboxItem,
  deleteInboxItem: deleteRow("inbox", "inbox item"),
  createTask,
  addKeyPoint,
  setKeyPointDone,
  setTaskStatus,
  moveTask,
  archiveTask,
  restoreTask,
  // calendar cross-day drag
  setTaskDates,
  updateKeyPoint,
  // detail step gestures (§10.14)
  moveKeyPoint,
  deleteKeyPoint: deleteRow("keyPoints", "key point"),

  // never in the preview
  updateInboxItem: previewOnly("updateInboxItem"),
  renameTask: previewOnly("renameTask"),
  setTaskRemind: previewOnly("setTaskRemind"),
  deleteTask: previewOnly("deleteTask"),

  onShown: (cb) => subscribe("shell://shown", cb),
  // The preview has no window to hide (windowHide is a no-op), so this only fires from tests.
  onHidden: (cb) => subscribe("shell://hidden", cb),
  onNavigate: (cb) => subscribe("shell://navigate", cb),
  onShortcutStatus: (cb) => subscribe("shell://shortcut-status", cb),
  onDayChanged: (cb) => subscribe("clock://day-changed", cb),
  onTrackpad: (cb) => subscribe("input://trackpad", cb),
  log: (level: LogLevel, message: string) => {
    const write =
      level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    write(`[preview] ${message}`);
  },
};
