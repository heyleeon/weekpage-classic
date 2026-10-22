// Window-level shortcuts (ui-spec §17). "mod" = ⌘ on macOS, Ctrl on Windows.
// Built-ins (installed once by `useGlobalHotkeys` in AppFrame): mod+1 / mod+2 pages, mod+W hide,
// mod+, settings, mod+Z undo toast, macOS mod+Q quit. Units add their own with `useHotkey`.

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { hasMod, isMac } from "@/lib/platform";
import { useUiStore } from "./useUiStore";

/** True when keyboard focus is in a text field (native text undo / letter keys belong to it). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range", "color"].includes(type);
  }
  return false;
}

/** Parses "mod+1" / "mod+shift+z" / "t" into a matcher. */
export function matchCombo(combo: string, e: KeyboardEvent, mac: boolean = isMac()): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  if (wantMod !== hasMod(e, mac)) return false;
  if (!wantMod && (e.metaKey || e.ctrlKey)) return false;
  if (wantShift !== e.shiftKey || wantAlt !== e.altKey) return false;
  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (pressed === key) return true;
  // Digits / letters by physical key so Shift / layouts do not break mod+1.
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (key === ",") return e.code === "Comma";
  return false;
}

export type HotkeyOptions = {
  /** Fire even when focus is in a text field (default: only mod combos fire there). */
  inInputs?: boolean;
  enabled?: boolean;
};

/** Registers one window shortcut while mounted. Return `false` from the handler to not consume. */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => boolean | undefined,
  opts: HotkeyOptions = {},
): void {
  const ref = useRef(handler);
  ref.current = handler;
  const { inInputs, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || !matchCombo(combo, e)) return;
      const isLetterOnly = !combo.toLowerCase().includes("mod");
      const allowInInput = inInputs ?? !isLetterOnly;
      if (!allowInInput && isEditableTarget(e.target)) return;
      if (ref.current(e) !== false) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, inInputs, enabled]);
}

/** mod+Z: undo the toast only when one is showing and focus is not in a text field. */
export function handleUndoKey(e: KeyboardEvent): boolean {
  if (isEditableTarget(e.target)) return false;
  const { toast, undoToast } = useUiStore.getState();
  if (!toast || toast.undone || toast.opIds.length === 0) return false;
  void undoToast();
  return true;
}

export function useGlobalHotkeys(): void {
  useHotkey("mod+1", () => {
    useUiStore.getState().setPage("calendar");
    return true;
  });
  useHotkey("mod+2", () => {
    useUiStore.getState().setPage("tasks");
    return true;
  });
  useHotkey("mod+w", () => {
    void api.windowHide().catch(() => undefined);
    return true;
  });
  useHotkey("mod+,", () => {
    useUiStore.getState().openOverlay({ kind: "settings" });
    return true;
  });
  useHotkey("mod+z", (e) => handleUndoKey(e), { inInputs: true });
  useHotkey(
    "mod+q",
    () => {
      void api.quitApp().catch(() => undefined);
      return true;
    },
    { enabled: isMac() },
  );
}
