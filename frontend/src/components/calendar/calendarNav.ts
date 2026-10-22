// Calendar week navigation (the toolbar, the calendar page's wheel / drag / keys and the
// 「回到今天」 button all go through here). The view is week-granular: `calendarAnchor` in
// useUiStore is the Monday of the first visible row. "Home" = homeAnchor(today, calendarFirstRow)
// (lib/dates.ts): this week, or last week when the 「第一行显示」 setting says so.

import { useUiStore } from "@/hooks/useUiStore";
import { addDays, homeAnchor, homeDirection } from "@/lib/dates";
import type { HomeDirection } from "@/types/domain";

/** Moves the view by `delta` weeks (negative = earlier). Non-integers are truncated. */
export function shiftWeek(delta: number): void {
  const weeks = Math.trunc(delta);
  if (!Number.isFinite(weeks) || weeks === 0) return;
  const ui = useUiStore.getState();
  ui.setCalendarAnchor(addDays(ui.calendarAnchor, weeks * 7));
}

/** Back to the home position (key T, 「回到今天」). */
export function backToToday(): void {
  const ui = useUiStore.getState();
  const home = homeAnchor(ui.today, ui.calendarFirstRow);
  if (ui.calendarAnchor !== home) ui.setCalendarAnchor(home);
}

/**
 * Where today's home position is relative to the current view: `"up"` (home is earlier — the user
 * scrolled into later weeks), `"down"` (home is later), `null` when the view is at home (hide the
 * 「回到今天」 button).
 */
export function useHomeDirection(): HomeDirection {
  return useUiStore((s) =>
    homeDirection(s.calendarAnchor, homeAnchor(s.today, s.calendarFirstRow)),
  );
}
