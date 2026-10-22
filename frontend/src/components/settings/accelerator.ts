// Global shortcut helpers for the settings panel and the first-run hint (ui-spec §16, §1.1):
// keydown → Tauri accelerator, accelerator → keycaps / display text, and the copy for errors and
// macOS system-shortcut conflicts (i18n, active language). Pure functions; the platform is passed in.
//
// Canonical accelerator spelling matches Rust (`platform::accelerator::Accel::canonical`):
// modifiers in macOS order `Control+Alt+Shift+Super`, then one key (`A`–`Z`, `0`–`9`, `Space`,
// `F1`–`F12`).

import { t } from "@/i18n";

export type AccelParts = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** ⌘ on macOS, the Windows key on Windows. */
  meta: boolean;
  key: string;
};

export type KeyLike = {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

export type RecordResult =
  | { kind: "cancel" }
  /** Only modifiers so far: keep listening. */
  | { kind: "pending" }
  | { kind: "invalid"; reason: "noModifier" | "key" }
  | { kind: "reserved"; accelerator: string }
  | { kind: "ok"; accelerator: string };

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "CapsLock",
  "Fn",
]);

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS", "CapsLock", "Fn"]);

/** Main key from the physical key code (Option / Shift change `e.key`, not `e.code`). */
export function mainKeyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  if (code === "Space") return "Space";
  m = /^F([0-9]{1,2})$/.exec(code);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) return `F${n}`;
  }
  return null;
}

/** Canonical accelerator string, e.g. `Control+Alt+Shift+Space`. */
export function toAccelerator(p: AccelParts): string {
  const out: string[] = [];
  if (p.ctrl) out.push("Control");
  if (p.alt) out.push("Alt");
  if (p.shift) out.push("Shift");
  if (p.meta) out.push("Super");
  out.push(p.key);
  return out.join("+");
}

function canonicalKey(raw: string): string | null {
  const up = raw.trim().toUpperCase();
  if (!up) return null;
  if (/^[A-Z0-9]$/.test(up)) return up;
  let m = /^KEY([A-Z])$/.exec(up);
  if (m) return m[1];
  m = /^DIGIT([0-9])$/.exec(up);
  if (m) return m[1];
  if (up === "SPACE") return "Space";
  m = /^F([0-9]{1,2})$/.exec(up);
  if (m) return `F${Number(m[1])}`;
  return up.charAt(0) + up.slice(1).toLowerCase();
}

/** Parses an accelerator (aliases: Ctrl, Option, Cmd / Command / Meta, CommandOrControl). */
export function parseAccelerator(acc: string, mac: boolean): AccelParts | null {
  const p: AccelParts = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  let key: string | null = null;
  for (const token of acc.split("+")) {
    const t = token.trim();
    if (!t) return null;
    switch (t.toUpperCase()) {
      case "CONTROL":
      case "CTRL":
        p.ctrl = true;
        break;
      case "ALT":
      case "OPTION":
        p.alt = true;
        break;
      case "SHIFT":
        p.shift = true;
        break;
      case "SUPER":
      case "CMD":
      case "COMMAND":
      case "META":
      case "WIN":
        p.meta = true;
        break;
      case "COMMANDORCONTROL":
      case "COMMANDORCTRL":
      case "CMDORCTRL":
      case "CMDORCONTROL":
        if (mac) p.meta = true;
        else p.ctrl = true;
        break;
      default: {
        if (key !== null) return null;
        key = canonicalKey(t);
        if (key === null) return null;
      }
    }
  }
  if (key === null) return null;
  p.key = key;
  return p;
}

/** One label per key: macOS `["⌃", "⌥", "Space"]`, Windows `["Ctrl", "Alt", "Space"]`. */
export function keycaps(acc: string, mac: boolean): string[] {
  const p = parseAccelerator(acc, mac);
  if (!p) return acc ? [acc] : [];
  const caps: string[] = [];
  if (p.ctrl) caps.push(mac ? "⌃" : "Ctrl");
  if (p.alt) caps.push(mac ? "⌥" : "Alt");
  if (p.shift) caps.push(mac ? "⇧" : "Shift");
  if (p.meta) caps.push(mac ? "⌘" : "Win");
  caps.push(p.key);
  return caps;
}

/** Display text: macOS `⌃⌥Space`, Windows `Ctrl+Alt+Space` (always from the current setting). */
export function formatAccelerator(acc: string, mac: boolean): string {
  const caps = keycaps(acc, mac);
  return mac ? caps.join("") : caps.join("+");
}

/** Combos the system owns (ui-spec §16.3). macOS ⌃⌥Space is allowed: it is the chosen default
 *  (decision D4) and shows up as a `conflict` with guidance instead. */
export function isReserved(p: AccelParts, mac: boolean): boolean {
  const only = (ctrl: boolean, alt: boolean, shift: boolean, meta: boolean) =>
    p.ctrl === ctrl && p.alt === alt && p.shift === shift && p.meta === meta;
  if (mac) {
    return (
      (p.key === "Space" && (only(false, false, false, true) || only(true, false, false, false))) ||
      (p.key === "Tab" && p.meta)
    );
  }
  return (
    p.meta ||
    (p.key === "Space" && only(true, false, false, false)) ||
    (p.key === "Tab" && p.alt) ||
    (p.key === "F4" && only(false, true, false, false))
  );
}

/** keydown while recording → what to do. Esc (no modifiers) cancels; lone modifiers wait. */
export function recordKey(e: KeyLike, mac: boolean): RecordResult {
  const anyMod = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
  if (e.key === "Escape" && !anyMod) return { kind: "cancel" };
  if (MODIFIER_CODES.has(e.code) || MODIFIER_KEYS.has(e.key)) return { kind: "pending" };
  const key = mainKeyFromCode(e.code);
  if (key === null) return { kind: "invalid", reason: "key" };
  const parts: AccelParts = {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key,
  };
  const accelerator = toAccelerator(parts);
  if (isReserved(parts, mac)) return { kind: "reserved", accelerator };
  const strong = parts.ctrl || parts.alt || parts.meta;
  const functionKey = /^F[0-9]+$/.test(key);
  if (!strong && !(parts.shift && functionKey)) return { kind: "invalid", reason: "noModifier" };
  return { kind: "ok", accelerator };
}

// ── Copy ────────────────────────────────────────────────────────────────────────────────────
// Texts come from the i18n `settings.shortcut.*` / `settings.firstRun.*` keys and follow the
// language active at call time.

/** Status line for `ShortcutStatus.error` (English, from Rust) — null when there is none. */
export function shortcutErrorText(error: string | null | undefined): string | null {
  if (!error) return null;
  if (error.startsWith("reserved")) return t("settings.shortcut.reserved");
  if (error.startsWith("invalid")) return t("settings.shortcut.invalid");
  return t("settings.shortcut.taken");
}

/** Status line for a combo refused before it reached Rust. */
export function recordErrorText(r: RecordResult, mac: boolean): string | null {
  switch (r.kind) {
    case "reserved":
      return t("settings.shortcut.reserved");
    case "invalid":
      if (r.reason !== "noModifier") return t("settings.shortcut.invalid");
      return mac ? t("settings.shortcut.noModifierMac") : t("settings.shortcut.noModifierWin");
    default:
      return null;
  }
}

/** Guidance for `ShortcutStatus.conflict` (an enabled macOS system shortcut on the same combo). */
export function conflictText(
  conflict: string | null | undefined,
  acc: string,
  mac: boolean,
): string | null {
  if (!conflict) return null;
  const vars = {
    combo: formatAccelerator(acc, mac),
    path: t("settings.shortcut.systemSettingsPath"),
  };
  switch (conflict) {
    case "input-source-next":
      return t("settings.shortcut.conflict.inputSourceNext", vars);
    case "input-source-previous":
      return t("settings.shortcut.conflict.inputSourcePrevious", vars);
    case "spotlight":
      return t("settings.shortcut.conflict.spotlight", vars);
    case "spotlight-window":
      return t("settings.shortcut.conflict.spotlightWindow", vars);
    default:
      return t("settings.shortcut.conflict.other", vars);
  }
}

/** First-run hint (ui-spec §1.1). */
export function firstRunText(acc: string, mac: boolean): string {
  return t("settings.firstRun.text", { combo: formatAccelerator(acc, mac) });
}
