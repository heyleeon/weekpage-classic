// Active time zone: settings.timezone → lib/clock (what "today" and clock times mean). Called once
// from App, next to useLanguage; independent of the UI language. "system" follows the OS zone, which
// is re-read whenever the window is shown (useShellEvents → recomputeToday).

import { useLayoutEffect } from "react";
import { setTimezone } from "@/lib/clock";
import { useDataStore } from "./useDataStore";
import { useUiStore } from "./useUiStore";

export function useTimezone(): void {
  const setting = useDataStore((s) => s.snap?.settings.timezone);

  // Layout effect: "today" is already in the new zone when the next frame paints.
  useLayoutEffect(() => {
    if (setting === undefined) return;
    setTimezone(setting);
    useUiStore.getState().recomputeToday();
  }, [setting]);
}
