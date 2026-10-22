// Today as 'YYYY-MM-DD'. Driven by lib/clock (offset) and refreshed by shell://shown and
// clock://day-changed (useShellEvents) — never by JS timers (WebView timers stall while hidden).

import { useUiStore } from "./useUiStore";

export function useToday(): string {
  return useUiStore((s) => s.today);
}
