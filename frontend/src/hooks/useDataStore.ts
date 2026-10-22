// Data state (architecture §3): one full snapshot, re-read after every write.
// Components never call write commands directly; they go through `mutate`, which refreshes the
// snapshot, shows the undo toast and sets the highlight.

import { create } from "zustand";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import type {
  AppInfo,
  HighlightReason,
  Mutation,
  SettingsPatch,
  Snapshot,
  ToastSpec,
} from "@/types/domain";
import { useUiStore } from "./useUiStore";

export type MutateOptions = {
  /** Toast to show on success; this op id is attached automatically for undo. */
  toast?: ToastSpec;
  /** Highlight for the created / changed object (its id is only known after the command). */
  highlight?: (m: Mutation) => { id: string; reason: HighlightReason } | null;
};

export type DataState = {
  snap: Snapshot | null;
  status: "loading" | "ready" | "error";
  appInfo: AppInfo | null;
  refresh(): Promise<void>;
  loadAppInfo(): Promise<AppInfo | null>;
  /** Runs a write → refresh → optional toast / highlight. Returns null on failure (toast shown). */
  mutate(run: () => Promise<Mutation>, opts?: MutateOptions): Promise<Mutation | null>;
  /** Optimistic local change before a drag command (re-read afterwards by mutate). */
  patchLocal(update: (s: Snapshot) => Snapshot): void;
  /** Settings patch → Rust merges and applies side effects → only `snap.settings` is replaced. */
  saveSettings(patch: SettingsPatch): Promise<void>;
};

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useDataStore = create<DataState>()((set, get) => ({
  snap: null,
  status: "loading",
  appInfo: null,

  refresh: async () => {
    try {
      const snap = await api.loadSnapshot();
      set({ snap, status: "ready" });
    } catch (e) {
      api.log("error", `load_snapshot failed: ${describe(e)}`);
      set({ status: get().snap ? "ready" : "error" });
    }
  },

  loadAppInfo: async () => {
    try {
      const appInfo = await api.appInfo();
      set({ appInfo });
      useUiStore.getState().setShortcutStatus(appInfo.shortcut);
      return appInfo;
    } catch (e) {
      api.log("error", `app_info failed: ${describe(e)}`);
      return null;
    }
  },

  mutate: async (run, opts) => {
    let m: Mutation;
    try {
      m = await run();
    } catch (e) {
      api.log("error", `write failed: ${describe(e)}`);
      // Generic failure text (the English details went to the log above).
      useUiStore.getState().showToast({
        text: t("toasts.mutateFailed"),
        opIds: [],
        tone: "notice",
      });
      return null;
    }
    await get().refresh();
    const ui = useUiStore.getState();
    if (opts?.toast) ui.showToast({ ...opts.toast, opIds: [m.opId] });
    const h = opts?.highlight?.(m);
    if (h) ui.setHighlight(h.id, h.reason);
    return m;
  },

  patchLocal: (update) => {
    const snap = get().snap;
    if (snap) set({ snap: update(snap) });
  },

  saveSettings: async (patch) => {
    try {
      const res = await api.updateSettings(patch);
      const snap = get().snap;
      if (snap) set({ snap: { ...snap, settings: res.settings } });
      useUiStore.getState().setShortcutStatus(res.shortcut);
    } catch (e) {
      api.log("error", `update_settings failed: ${describe(e)}`);
    }
  },
}));
