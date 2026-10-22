// Theme and material classes on <html> (architecture §4, ui-spec §0.3):
// settings.theme system → no data-theme (CSS follows prefers-color-scheme); light / dark → set it.
// appInfo.vibrancy false → <html class="no-vibrancy"> (solid outer ring).

import { useEffect } from "react";
import type { Theme } from "@/types/domain";
import { useDataStore } from "./useDataStore";

export function applyTheme(
  root: HTMLElement,
  theme: Theme | undefined,
  vibrancy: boolean | undefined,
) {
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
  root.classList.toggle("no-vibrancy", vibrancy === false);
}

export function useTheme(): void {
  const theme = useDataStore((s) => s.snap?.settings.theme);
  const vibrancy = useDataStore((s) => s.appInfo?.vibrancy);
  useEffect(() => {
    applyTheme(document.documentElement, theme, vibrancy);
  }, [theme, vibrancy]);
}
