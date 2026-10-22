// The ONLY place that talks to Rust (scripts/check-boundaries.sh: invoke / listen /
// @tauri-apps/api/core appear only here and in the generated bindings).
//
// Every command of backend/src/commands.rs is wrapped with friendly optional arguments; errors are
// normalised to `ApiError { code, message }`. Without Tauri (plain browser preview, vitest) the
// same interface is served by the in-memory `mockBackend` (architecture §3).

import {
  error as logErrorToFile,
  info as logInfoToFile,
  warn as logWarnToFile,
} from "@tauri-apps/plugin-log";
import { commands, events } from "@/types/bindings";
import type {
  AppInfo,
  DayChangedPayload,
  ErrorCode,
  EventInput,
  KeyPointInput,
  Mutation,
  NavigatePayload,
  NewTaskInput,
  SettingsApplied,
  SettingsPatch,
  ShortcutStatus,
  ShownPayload,
  Snapshot,
  TaskEvent,
  TaskStatus,
  TodoInput,
  TrackpadPayload,
} from "@/types/domain";
import { mockApi } from "./mockBackend";

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

const ERROR_CODES: readonly ErrorCode[] = [
  "invalid",
  "not_found",
  "conflict",
  "db",
  "platform",
  "not_implemented",
];

/** Normalises whatever a command rejected with (serialized AppError, Error, string). */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
    const { code, message } = e as { code: unknown; message: unknown };
    if (typeof code === "string" && (ERROR_CODES as readonly string[]).includes(code)) {
      return new ApiError(code as ErrorCode, String(message));
    }
  }
  if (e instanceof Error) return new ApiError("platform", e.message);
  return new ApiError("platform", String(e));
}

export type Unlisten = () => void;
export type LogLevel = "info" | "warn" | "error";

export interface Api {
  // §8.1 read / general
  appInfo(): Promise<AppInfo>;
  loadSnapshot(): Promise<Snapshot>;
  listTaskHistory(taskId: string): Promise<TaskEvent[]>;
  undo(opIds: string[]): Promise<void>;
  getCache(key: string): Promise<string | null>;
  setCache(key: string, value: string): Promise<void>;
  // §8.2 window and settings
  windowReady(): Promise<void>;
  windowHide(): Promise<void>;
  setBlurGuard(active: boolean): Promise<void>;
  updateSettings(patch: SettingsPatch): Promise<SettingsApplied>;
  quitApp(): Promise<void>;
  // §8.3 writes
  createEvent(input: EventInput): Promise<Mutation>;
  updateEvent(id: string, input: EventInput): Promise<Mutation>;
  deleteEvent(id: string): Promise<Mutation>;
  setDayOrder(date: string, itemKeys: string[]): Promise<Mutation>;
  createTodo(input: TodoInput, fromInboxId?: string | null): Promise<Mutation>;
  updateTodo(id: string, input: TodoInput): Promise<Mutation>;
  setTodoDone(id: string, done: boolean): Promise<Mutation>;
  restoreTodo(id: string): Promise<Mutation>;
  moveTodo(id: string, prevId?: string | null, nextId?: string | null): Promise<Mutation>;
  deleteTodo(id: string): Promise<Mutation>;
  createInboxItem(text: string): Promise<Mutation>;
  updateInboxItem(id: string, text: string): Promise<Mutation>;
  deleteInboxItem(id: string): Promise<Mutation>;
  createTask(input: NewTaskInput): Promise<Mutation>;
  renameTask(id: string, title: string): Promise<Mutation>;
  setTaskStatus(id: string, status: TaskStatus): Promise<Mutation>;
  setTaskDates(id: string, startDate: string, dueDate?: string | null): Promise<Mutation>;
  setTaskRemind(id: string, remindDayBefore: boolean): Promise<Mutation>;
  moveTask(
    id: string,
    column: 0 | 1 | 2,
    prevId?: string | null,
    nextId?: string | null,
  ): Promise<Mutation>;
  archiveTask(id: string, summary?: string | null): Promise<Mutation>;
  restoreTask(id: string, column: 0 | 1 | 2): Promise<Mutation>;
  deleteTask(id: string): Promise<Mutation>;
  addKeyPoint(taskId: string, input: KeyPointInput): Promise<Mutation>;
  updateKeyPoint(id: string, input: KeyPointInput): Promise<Mutation>;
  setKeyPointDone(id: string, done: boolean): Promise<Mutation>;
  moveKeyPoint(id: string, prevId?: string | null, nextId?: string | null): Promise<Mutation>;
  deleteKeyPoint(id: string): Promise<Mutation>;
  // §8.4 events (Rust → TS)
  onShown(cb: (p: ShownPayload) => void): Promise<Unlisten>;
  onHidden(cb: () => void): Promise<Unlisten>;
  onNavigate(cb: (p: NavigatePayload) => void): Promise<Unlisten>;
  onShortcutStatus(cb: (p: ShortcutStatus) => void): Promise<Unlisten>;
  onDayChanged(cb: (p: DayChangedPayload) => void): Promise<Unlisten>;
  /** macOS: fingers down on / lifted off the trackpad (never fires elsewhere). */
  onTrackpad(cb: (p: TrackpadPayload) => void): Promise<Unlisten>;
  /** English log line into the app log file (preview: console). */
  log(level: LogLevel, message: string): void;
}

/** True inside the Tauri WebView. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw toApiError(e);
  }
}

async function done(run: () => Promise<unknown>): Promise<void> {
  await call(run);
}

const tauriApi: Api = {
  appInfo: () => call(() => commands.appInfo()),
  loadSnapshot: () => call(() => commands.loadSnapshot()),
  listTaskHistory: (taskId) => call(() => commands.listTaskHistory(taskId)),
  undo: (opIds) => done(() => commands.undo(opIds)),
  getCache: (key) => call(() => commands.getCache(key)),
  setCache: (key, value) => done(() => commands.setCache(key, value)),
  windowReady: () => done(() => commands.windowReady()),
  windowHide: () => done(() => commands.windowHide()),
  setBlurGuard: (active) => done(() => commands.setBlurGuard(active)),
  updateSettings: (patch) => call(() => commands.updateSettings(patch)),
  quitApp: () => done(() => commands.quitApp()),
  createEvent: (input) => call(() => commands.createEvent(input)),
  updateEvent: (id, input) => call(() => commands.updateEvent(id, input)),
  deleteEvent: (id) => call(() => commands.deleteEvent(id)),
  setDayOrder: (date, itemKeys) => call(() => commands.setDayOrder(date, itemKeys)),
  createTodo: (input, fromInboxId) => call(() => commands.createTodo(input, fromInboxId ?? null)),
  updateTodo: (id, input) => call(() => commands.updateTodo(id, input)),
  setTodoDone: (id, isDone) => call(() => commands.setTodoDone(id, isDone)),
  restoreTodo: (id) => call(() => commands.restoreTodo(id)),
  moveTodo: (id, prevId, nextId) =>
    call(() => commands.moveTodo(id, prevId ?? null, nextId ?? null)),
  deleteTodo: (id) => call(() => commands.deleteTodo(id)),
  createInboxItem: (text) => call(() => commands.createInboxItem(text)),
  updateInboxItem: (id, text) => call(() => commands.updateInboxItem(id, text)),
  deleteInboxItem: (id) => call(() => commands.deleteInboxItem(id)),
  createTask: (input) => call(() => commands.createTask(input)),
  renameTask: (id, title) => call(() => commands.renameTask(id, title)),
  setTaskStatus: (id, status) => call(() => commands.setTaskStatus(id, status)),
  setTaskDates: (id, startDate, dueDate) =>
    call(() => commands.setTaskDates(id, startDate, dueDate ?? null)),
  setTaskRemind: (id, remindDayBefore) => call(() => commands.setTaskRemind(id, remindDayBefore)),
  moveTask: (id, column, prevId, nextId) =>
    call(() => commands.moveTask(id, column, prevId ?? null, nextId ?? null)),
  archiveTask: (id, summary) => call(() => commands.archiveTask(id, summary ?? null)),
  restoreTask: (id, column) => call(() => commands.restoreTask(id, column)),
  deleteTask: (id) => call(() => commands.deleteTask(id)),
  addKeyPoint: (taskId, input) => call(() => commands.addKeyPoint(taskId, input)),
  updateKeyPoint: (id, input) => call(() => commands.updateKeyPoint(id, input)),
  setKeyPointDone: (id, isDone) => call(() => commands.setKeyPointDone(id, isDone)),
  moveKeyPoint: (id, prevId, nextId) =>
    call(() => commands.moveKeyPoint(id, prevId ?? null, nextId ?? null)),
  deleteKeyPoint: (id) => call(() => commands.deleteKeyPoint(id)),
  onShown: (cb) => events.shellShown.listen((e) => cb(e.payload)),
  onHidden: (cb) => events.shellHidden.listen(() => cb()),
  onNavigate: (cb) => events.shellNavigate.listen((e) => cb(e.payload)),
  onShortcutStatus: (cb) => events.shellShortcutStatus.listen((e) => cb(e.payload)),
  onDayChanged: (cb) => events.clockDayChanged.listen((e) => cb(e.payload)),
  onTrackpad: (cb) => events.inputTrackpad.listen((e) => cb(e.payload)),
  log: (level, message) => {
    const write =
      level === "error" ? logErrorToFile : level === "warn" ? logWarnToFile : logInfoToFile;
    void write(`[web] ${message}`).catch(() => undefined);
  },
};

let override: Api | null = null;

/** Tests only: force a backend (null = automatic). */
export function setApiBackend(backend: Api | null): void {
  override = backend;
}

function backend(): Api {
  return override ?? (isTauri() ? tauriApi : mockApi);
}

/** The API used by hooks and components. The backend is picked per call (Tauri or preview mock). */
export const api: Api = new Proxy({} as Api, {
  get: (_target, prop) => Reflect.get(backend(), prop),
});
