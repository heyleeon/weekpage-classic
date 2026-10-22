import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import {
  conflictText,
  firstRunText,
  formatAccelerator,
  type KeyLike,
  keycaps,
  mainKeyFromCode,
  parseAccelerator,
  recordErrorText,
  recordKey,
  shortcutErrorText,
  toAccelerator,
} from "./accelerator";

const RESERVED_TEXT = "这是系统快捷键，换一个吧";
const TAKEN_TEXT = "这个组合被别的应用占用了，换一个试试";

function key(code: string, mods: Partial<KeyLike> = {}, k?: string): KeyLike {
  return {
    key: k ?? (code === "Space" ? " " : code.replace(/^Key|^Digit/, "").toLowerCase()),
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  };
}

describe("mainKeyFromCode", () => {
  it("maps letters, digits, space and F1–F12 by physical key", () => {
    expect(mainKeyFromCode("KeyK")).toBe("K");
    expect(mainKeyFromCode("Digit7")).toBe("7");
    expect(mainKeyFromCode("Space")).toBe("Space");
    expect(mainKeyFromCode("F1")).toBe("F1");
    expect(mainKeyFromCode("F12")).toBe("F12");
  });

  it("rejects everything else", () => {
    for (const c of ["F13", "Tab", "Enter", "Escape", "Comma", "ArrowUp", "Numpad1"]) {
      expect(mainKeyFromCode(c)).toBeNull();
    }
  });
});

describe("recordKey", () => {
  it("builds the canonical accelerator in ⌃⌥⇧⌘ order", () => {
    expect(recordKey(key("Space", { ctrlKey: true, altKey: true, shiftKey: true }), true)).toEqual({
      kind: "ok",
      accelerator: "Control+Alt+Shift+Space",
    });
    expect(recordKey(key("KeyK", { metaKey: true, shiftKey: true }), true)).toEqual({
      kind: "ok",
      accelerator: "Shift+Super+K",
    });
    // Option changes e.key on macOS (⌥K = "˚"), the physical code still says K.
    expect(recordKey(key("KeyK", { altKey: true, ctrlKey: true }, "˚"), true)).toEqual({
      kind: "ok",
      accelerator: "Control+Alt+K",
    });
  });

  it("allows the D4 default ⌃⌥Space on macOS (reported as a conflict instead)", () => {
    expect(recordKey(key("Space", { ctrlKey: true, altKey: true }), true)).toEqual({
      kind: "ok",
      accelerator: "Control+Alt+Space",
    });
  });

  it("Esc cancels, lone modifiers keep waiting", () => {
    expect(recordKey(key("Escape", {}, "Escape"), true)).toEqual({ kind: "cancel" });
    expect(recordKey(key("ShiftLeft", { shiftKey: true }, "Shift"), true)).toEqual({
      kind: "pending",
    });
    expect(recordKey(key("MetaLeft", { metaKey: true }, "Meta"), true)).toEqual({
      kind: "pending",
    });
  });

  it("needs ⌃ / ⌥ / ⌘ (Shift alone only with F-keys)", () => {
    expect(recordKey(key("KeyA"), true)).toEqual({ kind: "invalid", reason: "noModifier" });
    expect(recordKey(key("KeyA", { shiftKey: true }), true)).toEqual({
      kind: "invalid",
      reason: "noModifier",
    });
    expect(recordKey(key("F5", { shiftKey: true }, "F5"), false)).toEqual({
      kind: "ok",
      accelerator: "Shift+F5",
    });
  });

  it("refuses keys outside A–Z / 0–9 / Space / F1–F12", () => {
    expect(recordKey(key("Enter", { ctrlKey: true }, "Enter"), true)).toEqual({
      kind: "invalid",
      reason: "key",
    });
  });

  it("refuses reserved system combos", () => {
    expect(recordKey(key("Space", { metaKey: true }), true).kind).toBe("reserved");
    expect(recordKey(key("Space", { ctrlKey: true }), true).kind).toBe("reserved");
    expect(recordKey(key("KeyE", { metaKey: true }), false).kind).toBe("reserved");
    expect(recordKey(key("Space", { ctrlKey: true }), false).kind).toBe("reserved");
    expect(recordKey(key("F4", { altKey: true }, "F4"), false).kind).toBe("reserved");
    // More modifiers make it a different combo.
    expect(recordKey(key("Space", { metaKey: true, altKey: true }), true).kind).toBe("ok");
  });
});

describe("display", () => {
  it("parses aliases and formats per platform", () => {
    expect(parseAccelerator("ctrl+option+space", true)).toEqual({
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
      key: "Space",
    });
    expect(parseAccelerator("CommandOrControl+KeyK", false)?.ctrl).toBe(true);
    expect(parseAccelerator("CommandOrControl+KeyK", true)?.meta).toBe(true);
    expect(parseAccelerator("Control+", true)).toBeNull();
    expect(parseAccelerator("Control+A+B", true)).toBeNull();
  });

  it("keycaps and text follow the current setting (never hard-coded)", () => {
    expect(keycaps("Control+Alt+Space", true)).toEqual(["⌃", "⌥", "Space"]);
    expect(keycaps("Control+Alt+Shift+Space", false)).toEqual(["Ctrl", "Alt", "Shift", "Space"]);
    expect(formatAccelerator("Control+Alt+Shift+Space", true)).toBe("⌃⌥⇧Space");
    expect(formatAccelerator("Control+Alt+Space", false)).toBe("Ctrl+Alt+Space");
    expect(formatAccelerator("Super+K", false)).toBe("Win+K");
    expect(firstRunText("Control+Alt+Shift+Space", true)).toBe(
      "按 ⌃⌥⇧Space 试试能不能收起；不行就去设置里换一个",
    );
  });

  it("round-trips through toAccelerator", () => {
    const p = parseAccelerator("shift+alt+ctrl+cmd+f2", true);
    expect(p && toAccelerator(p)).toBe("Control+Alt+Shift+Super+F2");
  });
});

describe("copy", () => {
  it("explains the input-source conflict with the current combo", () => {
    expect(conflictText("input-source-next", "Control+Alt+Space", true)).toBe(
      "⌃⌥Space 正被系统用于切换输入法。到 系统设置 → 键盘 → 键盘快捷键 → 输入法 关掉『选择输入法菜单中的下一个输入法』，或在这里换一个快捷键",
    );
    expect(conflictText("input-source-previous", "Control+Space", true)).toContain(
      "『选择上一个输入法』",
    );
    expect(conflictText("system-36", "F11", true)).toContain("系统快捷键占用");
    expect(conflictText(null, "Control+Alt+Space", true)).toBeNull();
  });

  it("maps Rust error words to Chinese status lines", () => {
    expect(shortcutErrorText(null)).toBeNull();
    expect(shortcutErrorText("reserved system shortcut: Super+Space")).toBe(RESERVED_TEXT);
    expect(shortcutErrorText("registration failed: HotKey already registered")).toBe(TAKEN_TEXT);
    expect(shortcutErrorText('invalid accelerator: ""')).toBe("这个组合不能用，换一个试试");
    expect(recordErrorText({ kind: "reserved", accelerator: "Super+Space" }, true)).toBe(
      RESERVED_TEXT,
    );
    expect(recordErrorText({ kind: "ok", accelerator: "Alt+K" }, true)).toBeNull();
    expect(recordErrorText({ kind: "invalid", reason: "noModifier" }, true)).toBe(
      "要带上 ⌃ / ⌥ / ⌘ 之一，换一个试试",
    );
    expect(recordErrorText({ kind: "invalid", reason: "noModifier" }, false)).toBe(
      "要带上 Ctrl / Alt 之一，换一个试试",
    );
  });

  it("every conflict id has its own guidance", () => {
    expect(conflictText("spotlight", "Super+Space", true)).toBe(
      "⌘Space 正被系统用于聚焦搜索。到 系统设置 → 键盘 → 键盘快捷键 → 聚焦 关掉『显示聚焦搜索』，或在这里换一个快捷键",
    );
    expect(conflictText("spotlight-window", "Alt+Super+Space", true)).toContain(
      "『显示“访达”搜索窗口』",
    );
    expect(conflictText("system-36", "F11", true)).toBe(
      "F11 正被一个系统快捷键占用。到 系统设置 → 键盘 → 键盘快捷键 里关掉它，或在这里换一个快捷键",
    );
  });

  it("follows the active language (English)", () => {
    setLang("en");
    expect(firstRunText("Control+Alt+Space", true)).toBe(
      "Press ⌃⌥Space to check that it hides the window. If it doesn't, pick another one in Settings.",
    );
    expect(conflictText("input-source-next", "Control+Alt+Space", true)).toBe(
      "macOS uses ⌃⌥Space to switch input sources. Turn off “Select next source in Input menu” in System Settings → Keyboard → Keyboard Shortcuts → Input Sources, or pick another shortcut here.",
    );
    expect(shortcutErrorText("registration failed: HotKey already registered")).toBe(
      "Another app is using that shortcut. Try another one.",
    );
    expect(recordErrorText({ kind: "invalid", reason: "noModifier" }, false)).toBe(
      "Include Ctrl or Alt. Try another one.",
    );
  });
});
