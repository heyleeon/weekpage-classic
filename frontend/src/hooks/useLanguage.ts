// Active UI language: settings.language (snapshot) → resolveLang → i18next.changeLanguage, which
// also updates <html lang> (src/i18n/index.ts). Called once from App; App keys the Paper subtree by
// the returned language so every component re-renders in the new language, including those that
// only call lib/ text helpers (they read the language at call time and do not subscribe).

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { currentLang, i18n, type Lang, navigatorLanguages, resolveLang, setLang } from "@/i18n";
import { useDataStore } from "./useDataStore";

function subscribe(onChange: () => void): () => void {
  i18n.on("languageChanged", onChange);
  return () => i18n.off("languageChanged", onChange);
}

/** The language the UI renders in; re-renders the caller on every switch. */
export function useCurrentLang(): Lang {
  return useSyncExternalStore(subscribe, currentLang, currentLang);
}

/** Applies the 语言 setting. Before the first snapshot the source language (zh-Hans) stays. */
export function useLanguage(): Lang {
  const setting = useDataStore((s) => s.snap?.settings.language);

  // Layout effect: the switch (and the re-render it causes) lands before the browser paints, so
  // the first visible frame is already in the right language.
  useLayoutEffect(() => {
    if (setting === undefined) return;
    setLang(resolveLang(setting, navigatorLanguages()));
  }, [setting]);

  // "跟随系统": follow OS language changes while the app runs.
  useEffect(() => {
    if (setting !== "system") return;
    const onSystemChange = () => setLang(resolveLang(setting, navigatorLanguages()));
    window.addEventListener("languagechange", onSystemChange);
    return () => window.removeEventListener("languagechange", onSystemChange);
  }, [setting]);

  return useCurrentLang();
}
