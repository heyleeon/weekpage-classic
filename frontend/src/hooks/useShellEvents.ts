// The only subscriber of shell / clock / input events (architecture §8). Pages never subscribe.

import { useEffect } from "react";
import { api, type Unlisten } from "@/lib/api";
import { homeAnchor } from "@/lib/dates";
import { setTrackpadTouching } from "@/lib/trackpad";
import { useDataStore } from "./useDataStore";
import { useUiStore } from "./useUiStore";

/**
 * Back to the bare page: popover and overlay (task detail, settings…) closed with no exit beat,
 * the archive back to tasks (where it opens from), the calendar at home (homeAnchor with the
 * calendarFirstRow setting).
 */
function resetView(today: string): void {
  const ui = useUiStore.getState();
  ui.closePopover();
  if (ui.overlay) ui.dropOverlay();
  if (ui.page === "archive") ui.setPage("tasks");
  ui.setCalendarAnchor(homeAnchor(today, ui.calendarFirstRow));
}

/**
 * shell://hidden (ui-spec §1.1): reset the view while nobody sees it, so the next show paints the
 * calendar / tasks page at once instead of flashing the old detail panel first (WebKit shows the
 * last painted frame before shell://shown can run).
 */
export function handleHidden(): void {
  resetView(useUiStore.getState().today);
}

/**
 * shell://shown handling: today → the same reset (a no-op after shell://hidden; covers a hidden
 * event the suspended WebView missed, and a new day / week since) → a background snapshot refresh
 * so changes made while hidden (tray autostart toggle, reminder bookkeeping) reach the UI without
 * a dedicated settings-changed event.
 */
export function handleShown(): void {
  resetView(useUiStore.getState().recomputeToday());
  void useDataStore.getState().refresh();
}

export function handleNavigate(page: "calendar" | "tasks" | "settings"): void {
  const ui = useUiStore.getState();
  if (page === "settings") ui.openOverlay({ kind: "settings" });
  else ui.setPage(page);
}

export function useShellEvents(): void {
  useEffect(() => {
    let disposed = false;
    const offs: Unlisten[] = [];
    const keep = (p: Promise<Unlisten>) => {
      p.then((off) => (disposed ? off() : offs.push(off))).catch((e: unknown) =>
        api.log("warn", `event subscribe failed: ${String(e)}`),
      );
    };
    keep(api.onShown(() => handleShown()));
    keep(api.onHidden(() => handleHidden()));
    keep(api.onNavigate((p) => handleNavigate(p.page)));
    // setToday keeps a calendar that sat at home at the new day's home.
    keep(api.onDayChanged((p) => useUiStore.getState().setToday(p.today)));
    keep(api.onShortcutStatus((s) => useUiStore.getState().setShortcutStatus(s)));
    keep(api.onTrackpad((p) => setTrackpadTouching(p.touching)));
    return () => {
      disposed = true;
      for (const off of offs) off();
    };
  }, []);
}
