// Platform detection for labels and key handling. Synchronous (user agent based) so it works the
// same in the app (WKWebView / WebView2) and in the browser preview.

export function isMac(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return /Mac|iPhone|iPad/i.test(ua);
}

/** Label of the "mod" key in UI hints: 「⌘」 on macOS, 「Ctrl」 elsewhere (ui-spec §0.3). */
export function modKeyLabel(mac: boolean = isMac()): string {
  return mac ? "⌘" : "Ctrl";
}

/** Shortcut hint shown in capsules: 「⌘1」 on macOS, 「Ctrl 1」 on Windows. */
export function shortcutHint(key: string, mac: boolean = isMac()): string {
  return mac ? `⌘${key}` : `Ctrl ${key}`;
}

/** True when the platform's "mod" modifier (⌘ / Ctrl) is pressed, and only that one of the two. */
export function hasMod(e: { metaKey: boolean; ctrlKey: boolean }, mac: boolean = isMac()): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
