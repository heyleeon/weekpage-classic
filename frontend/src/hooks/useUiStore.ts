// UI state: page, calendar anchor / weeks, overlay, popover, toast, highlight,
// measured column heights, drag state, today. Store = hook (zustand); read with selectors.

import { create } from "zustand";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { todayStr } from "@/lib/clock";
import { homeAnchor, mondayOf } from "@/lib/dates";
import type {
  CalendarFirstRow,
  CalendarWeeks,
  HighlightReason,
  Overlay,
  Page,
  Popover,
  Settings,
  ShortcutStatus,
  ToastSpec,
  ToastState,
} from "@/types/domain";
import { useDataStore } from "./useDataStore";

/** Toast lifetime (ui-spec §15.3). */
export const TOAST_MS = 6000;
/** 「已撤销」 lingers this long. */
export const TOAST_UNDONE_MS = 1500;
/** Card / row highlight after create / restore. */
export const HIGHLIGHT_MS = 3000;
/** The remembered page is written this long after the last switch: the snapshot refresh that
 *  follows a settings write re-renders both pages, and must not land while they slide. */
export const LAST_PAGE_SAVE_MS = 700;

let lastPageTimer = 0;

export type UiState = {
  /** Local 'YYYY-MM-DD'; recomputed on shell://shown and clock://day-changed. */
  today: string;
  /** A new day keeps a calendar that sat at home at home (the new day's homeAnchor). */
  setToday(d: string): void;
  recomputeToday(): string;

  page: Page;
  /** Switches page (closes an open overlay first) and remembers calendar / tasks (after
   *  LAST_PAGE_SAVE_MS, the last switch wins). */
  setPage(p: Page): void;

  /** Monday of the first visible week. Navigation: components/calendar/calendarNav.ts. */
  calendarAnchor: string;
  calendarWeeks: CalendarWeeks;
  /** Which week the first row shows at home (mirrors settings.calendarFirstRow). */
  calendarFirstRow: CalendarFirstRow;
  setCalendarAnchor(d: string): void;
  setCalendarWeeks(n: CalendarWeeks): void;
  /** Remembers the setting (saveSettings) and moves the view to the new home. */
  setCalendarFirstRow(v: CalendarFirstRow): void;

  leftTab: "today" | "inbox";
  setLeftTab(t: "today" | "inbox"): void;

  overlay: Overlay | null;
  openOverlay(o: Overlay): void;
  closeOverlay(): void;
  /** Closes without the exit beat (the window is hiding: nothing may be left to fade on show). */
  dropOverlay(): void;
  /** The last close was dropOverlay: OverlayHost unmounts at once. */
  overlayDropped: boolean;

  popover: Popover | null;
  openPopover(p: Popover): void;
  closePopover(): void;

  highlight: { id: string; reason: HighlightReason; until: number } | null;
  setHighlight(id: string, reason: HighlightReason, ms?: number): void;
  clearHighlight(): void;

  /** Real heights of the 3 task columns (TaskGrid writes them; null when unmounted). */
  columnHeights: [number, number, number] | null;
  setColumnHeights(h: [number, number, number] | null): void;

  toast: ToastState | null;
  showToast(spec: ToastSpec & { opIds: string[] }): void;
  /** Undoes every op of the current toast (button or mod+Z). */
  undoToast(): Promise<void>;
  dismissToast(): void;
  pauseToast(): void;
  resumeToast(): void;

  dragging: boolean;
  /** Also raises / lowers the Rust blur guard so a drag never hides the window. */
  setDragging(b: boolean): void;

  selectedCalItemKey: string | null;
  selectCalItem(k: string | null): void;

  /** Last global shortcut status from Rust (settings panel shows it). */
  shortcutStatus: ShortcutStatus | null;
  setShortcutStatus(s: ShortcutStatus | null): void;

  /** Applies remembered settings once after the first snapshot (no write back). */
  hydrateFromSettings(s: Settings): void;
};

function asWeeks(n: number): CalendarWeeks {
  return n === 2 || n === 4 ? n : 3;
}

function asFirstRow(v: string | undefined): CalendarFirstRow {
  return v === "lastWeek" ? "lastWeek" : "thisWeek";
}

function initialToday(): string {
  return todayStr();
}

export const useUiStore = create<UiState>()((set, get) => ({
  today: initialToday(),
  setToday: (d) => {
    const s = get();
    if (d === s.today) return;
    const atHome = s.calendarAnchor === homeAnchor(s.today, s.calendarFirstRow);
    set(atHome ? { today: d, calendarAnchor: homeAnchor(d, s.calendarFirstRow) } : { today: d });
  },
  recomputeToday: () => {
    const d = todayStr();
    get().setToday(d);
    return d;
  },

  page: "calendar",
  setPage: (p) => {
    if (get().overlay) set({ overlay: null });
    if (get().popover) set({ popover: null });
    if (get().page === p) return;
    set({ page: p, selectedCalItemKey: null });
    if (p === "archive") return;
    window.clearTimeout(lastPageTimer);
    lastPageTimer = window.setTimeout(
      () => void useDataStore.getState().saveSettings({ lastPage: p }),
      LAST_PAGE_SAVE_MS,
    );
  },

  calendarAnchor: homeAnchor(initialToday(), "thisWeek"),
  calendarWeeks: 3,
  calendarFirstRow: "thisWeek",
  setCalendarAnchor: (d) => set({ calendarAnchor: mondayOf(d) }),
  setCalendarWeeks: (n) => {
    if (get().calendarWeeks === n) return;
    set({ calendarWeeks: n });
    void useDataStore.getState().saveSettings({ calendarWeeks: n });
  },
  setCalendarFirstRow: (v) => {
    if (get().calendarFirstRow === v) return;
    set({ calendarFirstRow: v, calendarAnchor: homeAnchor(get().today, v) });
    void useDataStore.getState().saveSettings({ calendarFirstRow: v });
  },

  leftTab: "today",
  setLeftTab: (t) => set({ leftTab: t }),

  overlay: null,
  openOverlay: (o) => set({ overlay: o, popover: null, overlayDropped: false }),
  closeOverlay: () => set({ overlay: null, overlayDropped: false }),
  dropOverlay: () => set({ overlay: null, overlayDropped: true }),
  overlayDropped: false,

  popover: null,
  openPopover: (p) => set({ popover: p }),
  closePopover: () => set({ popover: null }),

  highlight: null,
  setHighlight: (id, reason, ms = HIGHLIGHT_MS) =>
    set({ highlight: { id, reason, until: Date.now() + ms } }),
  clearHighlight: () => set({ highlight: null }),

  columnHeights: null,
  setColumnHeights: (h) => set({ columnHeights: h }),

  toast: null,
  showToast: (spec) => {
    const now = Date.now();
    const prev = get().toast;
    const alive = prev !== null && !prev.undone && prev.until > now;
    if (alive && spec.mergeKey && prev.mergeKey === spec.mergeKey && spec.merge) {
      const merged = spec.merge(prev, spec);
      set({
        toast: {
          text: merged.text,
          mergeKey: spec.mergeKey,
          meta: merged.meta,
          opIds: [...prev.opIds, ...spec.opIds],
          until: now + TOAST_MS,
          undone: false,
        },
      });
      return;
    }
    set({
      toast: {
        text: spec.text,
        mergeKey: spec.mergeKey,
        meta: spec.meta ?? {},
        opIds: [...spec.opIds],
        until: now + TOAST_MS,
        undone: false,
        tone: spec.tone,
      },
    });
  },
  undoToast: async () => {
    const toast = get().toast;
    if (!toast || toast.undone || toast.opIds.length === 0) return;
    // Prevent a double undo while the command runs.
    set({ toast: { ...toast, undone: true } });
    try {
      await api.undo(toast.opIds);
      await useDataStore.getState().refresh();
      set({
        toast: {
          text: t("toasts.undone"),
          meta: {},
          opIds: [],
          until: Date.now() + TOAST_UNDONE_MS,
          undone: true,
        },
      });
    } catch (e) {
      api.log("error", `undo failed: ${e instanceof Error ? e.message : String(e)}`);
      set({
        toast: {
          text: t("toasts.undoFailed"),
          meta: {},
          opIds: [],
          until: Date.now() + TOAST_MS,
          undone: true,
          tone: "notice",
        },
      });
    }
  },
  dismissToast: () => set({ toast: null }),
  pauseToast: () => {
    const t = get().toast;
    if (!t || t.pausedRemaining !== undefined) return;
    set({
      toast: { ...t, pausedRemaining: Math.max(0, t.until - Date.now()), until: Infinity },
    });
  },
  resumeToast: () => {
    const t = get().toast;
    if (!t || t.pausedRemaining === undefined) return;
    const { pausedRemaining, ...rest } = t;
    set({ toast: { ...rest, until: Date.now() + pausedRemaining } });
  },

  dragging: false,
  setDragging: (b) => {
    if (get().dragging === b) return;
    set({ dragging: b });
    void api.setBlurGuard(b).catch(() => undefined);
  },

  selectedCalItemKey: null,
  selectCalItem: (k) => set({ selectedCalItemKey: k }),

  shortcutStatus: null,
  setShortcutStatus: (s) => set({ shortcutStatus: s }),

  hydrateFromSettings: (s) =>
    set({
      page: s.lastPage === "tasks" ? "tasks" : "calendar",
      calendarWeeks: asWeeks(s.calendarWeeks),
      calendarFirstRow: asFirstRow(s.calendarFirstRow),
    }),
}));
