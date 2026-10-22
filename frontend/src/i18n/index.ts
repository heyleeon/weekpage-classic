// i18n entry (i18next + react-i18next). Initialised synchronously on first import with inline
// resources, so `t` works in lib/ code, tests and the first render without waiting.
//
// - Components: `const { t } = useTranslation();` (from "react-i18next") → t("calendar.foo").
// - lib/ and other non-React code: `import { t } from "@/i18n";` (always the current language).
// - Resources: src/i18n/locales/<lang>/<section>.ts, one "translation" namespace whose top-level
//   keys are the sections. zh-Hans is the source shape; en sections are typed against it.
// - Date words / formats: src/lib/dates.ts (weekdayShort, calendarTitle, todayTitle, …).
// - Which language is active: hooks/useLanguage.ts (settings.language → resolveLang).
// - Pseudo-localization (dev only, `?pseudo` / VITE_PSEUDO_LOCALE=1): ./pseudo.ts.

import i18next, { type PostProcessorModule } from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "@/types/domain";
import en from "./locales/en";
import zhHans from "./locales/zh-Hans";
import { pseudoLocalize, pseudoRequested } from "./pseudo";
import type { Lang } from "./types";

export type { Lang, Messages, Translation } from "./types";

export const LANGS: readonly Lang[] = ["zh-Hans", "en"];

/** The source language: initial language and fallback for missing keys. */
export const SOURCE_LANG: Lang = "zh-Hans";

export const resources = {
  "zh-Hans": { translation: zhHans },
  en: { translation: en },
};

/** Dev builds only; `import.meta.env.DEV` is a constant `false` in release builds. */
const PSEUDO =
  import.meta.env.DEV &&
  pseudoRequested(
    typeof location === "undefined" ? "" : location.search,
    import.meta.env.VITE_PSEUDO_LOCALE,
  );

if (PSEUDO) {
  i18next.use({
    type: "postProcessor",
    name: "pseudo",
    process: (value: string) => pseudoLocalize(value),
  } satisfies PostProcessorModule);
}

void i18next.use(initReactI18next).init({
  resources,
  lng: SOURCE_LANG,
  fallbackLng: SOURCE_LANG,
  supportedLngs: [...LANGS],
  defaultNS: "translation",
  ns: ["translation"],
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  postProcess: PSEUDO ? ["pseudo"] : false,
});

// Keep <html lang> (screen readers, hyphenation, fonts) and the document title in step with every
// language change.
i18next.on("languageChanged", (lng) => {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lng;
  document.title = i18next.t("common.appName");
});

export const i18n = i18next;
export default i18next;

/** `t` for non-React code; resolves against the language active at call time. */
export const t: typeof i18next.t = i18next.t.bind(i18next);

/** Normalises any language tag to one we have resources for. */
export function toLang(tag: string | null | undefined): Lang {
  if (!tag) return SOURCE_LANG;
  return tag.toLowerCase().startsWith("en") ? "en" : SOURCE_LANG;
}

/** The language the UI currently renders in. */
export function currentLang(): Lang {
  return toLang(i18next.resolvedLanguage ?? i18next.language);
}

/**
 * Simplified-script Chinese: zh, zh-CN, zh-SG, zh-Hans-*. Traditional (zh-TW, zh-HK, zh-MO,
 * zh-Hant-*) is a different script, not a region of it: the app has no zh-Hant copy, so those tags
 * count as "no text for this language" — the same choice macOS makes when it matches the user's
 * languages against the bundle's zh-Hans / en localizations (Finder name, WebKit).
 */
export function isSimplifiedChinese(tag: string): boolean {
  if (!/^zh(?:[-_]|$)/i.test(tag)) return false;
  try {
    return new Intl.Locale(tag.replace(/_/g, "-")).maximize().script === "Hans";
  } catch {
    return false;
  }
}

/**
 * The 语言 setting → a language with resources. "system" looks at the OS preferred languages
 * (`navigator.languages`, OS tags such as zh-CN / zh-Hant-TW / en-US, most preferred first): the
 * first one we have text for decides (Simplified Chinese of any region → zh-Hans, English → en;
 * Traditional Chinese is skipped, see isSimplifiedChinese), a list with neither → en, an empty
 * list keeps the source language (zh-Hans). Same rule as the backend's `i18n::resolve`, so the
 * tray menu and the window agree even for a list like [ja, zh-CN].
 */
export function resolveLang(
  setting: Language | null | undefined,
  navigatorLanguages: readonly string[],
): Lang {
  if (setting === "zh-Hans" || setting === "en") return setting;
  const tags = navigatorLanguages.map((l) => l.trim().toLowerCase()).filter((l) => l !== "");
  if (tags.length === 0) return SOURCE_LANG;
  const known = tags.find((l) => isSimplifiedChinese(l) || l.startsWith("en"));
  return known !== undefined && isSimplifiedChinese(known) ? "zh-Hans" : "en";
}

/** Switches the UI language (no-op when already active). Synchronous: resources are inline. */
export function setLang(lang: Lang): void {
  if (currentLang() === lang && i18next.language === lang) return;
  void i18next.changeLanguage(lang);
}

/** `navigator.languages` with a `navigator.language` fallback (empty outside a browser). */
export function navigatorLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
