// What the settings panel and the first-run hint show about the global shortcut: the combo in
// effect (Rust status first, stored setting otherwise), the platform for labels, and the
// conflict / error copy (in the active language; re-rendered on a language switch).

import { useDataStore } from "@/hooks/useDataStore";
import { useCurrentLang } from "@/hooks/useLanguage";
import { useUiStore } from "@/hooks/useUiStore";
import { isMac } from "@/lib/platform";
import { conflictText, shortcutErrorText } from "./accelerator";

export type ShortcutView = {
  mac: boolean;
  /** Accelerator in effect, e.g. "Control+Alt+Space" ("" before anything loaded). */
  accelerator: string;
  /** Red status line from the last registration (null when fine). */
  errorText: string | null;
  /** macOS system-shortcut conflict guidance (null when none). */
  conflict: string | null;
};

/** macOS labels when the backend says macOS; the user agent before app info arrives. */
export function useIsMac(): boolean {
  const platform = useDataStore((s) => s.appInfo?.platform);
  return platform ? platform === "macos" : isMac();
}

export function useShortcutView(): ShortcutView {
  useCurrentLang();
  const mac = useIsMac();
  const status = useUiStore((s) => s.shortcutStatus);
  const stored = useDataStore((s) => s.snap?.settings.shortcut ?? "");
  const accelerator = status?.accelerator || stored;
  return {
    mac,
    accelerator,
    errorText: shortcutErrorText(status?.error),
    conflict: conflictText(status?.conflict, accelerator, mac),
  };
}
