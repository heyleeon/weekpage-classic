// App shell: frame → paper → toolbar / page stage / overlay / popover / toast.
// Startup: clock → app info → snapshot → remembered settings → holidays → theme → first frame →
// `windowReady` (Rust shows the window only then, so it never flashes white).
// Language: useLanguage applies settings.language; the Paper subtree is keyed by the active
// language so a switch re-renders everything (boot() does not run again).

import { useEffect } from "react";
import FirstRunHint from "@/components/settings/FirstRunHint";
import { AppFrame } from "@/components/shell/AppFrame";
import { OverlayHost } from "@/components/shell/OverlayHost";
import { PageStage } from "@/components/shell/PageStage";
import { Paper } from "@/components/shell/Paper";
import { PopoverHost } from "@/components/shell/PopoverHost";
import { ToastHost } from "@/components/shell/ToastHost";
import { Toolbar } from "@/components/shell/Toolbar";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { useGlobalHotkeys } from "@/hooks/useHotkeys";
import { useLanguage } from "@/hooks/useLanguage";
import { useShellEvents } from "@/hooks/useShellEvents";
import { useTheme } from "@/hooks/useTheme";
import { useTimezone } from "@/hooks/useTimezone";
import { useUiStore } from "@/hooks/useUiStore";
import { api, isTauri } from "@/lib/api";
import { initClockFromUrl, setClockOffset } from "@/lib/clock";
import { homeAnchor } from "@/lib/dates";
import { initHolidays } from "@/lib/holidays";
import { mockEmit } from "@/lib/mockBackend";

declare global {
  interface Window {
    /** Debug handle (preview and dev builds): stores, api, simulated events. */
    __wp?: {
      ui: typeof useUiStore;
      data: typeof useDataStore;
      api: typeof api;
      emit?: typeof mockEmit;
    };
  }
}

/** Runs once at startup. Exported for tests. */
export async function boot(): Promise<void> {
  const tauri = isTauri();
  if (!tauri) {
    initClockFromUrl(window.location.search);
    document.body.classList.add("preview-wallpaper");
  }
  if (!tauri || import.meta.env.DEV) {
    window.__wp = { ui: useUiStore, data: useDataStore, api, emit: tauri ? undefined : mockEmit };
  }
  const data = useDataStore.getState();
  const info = await data.loadAppInfo();
  if (tauri && info) setClockOffset(info.clockOffsetMs);
  const ui = useUiStore.getState();
  ui.setCalendarAnchor(homeAnchor(ui.recomputeToday(), ui.calendarFirstRow));
  await data.refresh();
  const snap = useDataStore.getState().snap;
  if (snap) {
    ui.hydrateFromSettings(snap.settings);
    // The remembered first-row setting decides where the calendar opens.
    const s = useUiStore.getState();
    s.setCalendarAnchor(homeAnchor(s.today, s.calendarFirstRow));
  }
  try {
    await initHolidays();
  } catch (e) {
    api.log("warn", `holidays init failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function App() {
  useTheme();
  const lang = useLanguage();
  useTimezone();
  useShellEvents();
  useGlobalHotkeys();
  useEscDispatcher();
  const status = useDataStore((s) => s.status);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    // After the first frame with data (or the error state). The window starts hidden and WebKit
    // does not run requestAnimationFrame for hidden windows, so a timer is the fallback.
    let sent = false;
    const ready = () => {
      if (sent) return;
      sent = true;
      void api
        .windowReady()
        .catch((e: unknown) => api.log("error", `window_ready failed: ${String(e)}`));
    };
    const raf = requestAnimationFrame(ready);
    const timer = window.setTimeout(ready, 50);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [status]);

  return (
    <AppFrame>
      <Paper key={lang}>
        <Toolbar />
        <PageStage />
        <FirstRunHint />
        <ToastHost />
        <PopoverHost />
        <OverlayHost />
      </Paper>
    </AppFrame>
  );
}
