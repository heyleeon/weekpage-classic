import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverlayHost } from "@/components/shell/OverlayHost";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { useLanguage } from "@/hooks/useLanguage";
import { useUiStore } from "@/hooks/useUiStore";
import { setLang } from "@/i18n";
import { type Api, setApiBackend } from "@/lib/api";
import { mockApi, mockSnapshot, resetMockBackend } from "@/lib/mockBackend";
import type { AppInfo, SettingsApplied, SettingsPatch, ShortcutStatus } from "@/types/domain";
import FirstRunHint from "./FirstRunHint";
import SettingsPanel from "./SettingsPanel";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();
const DEV = "Control+Alt+Shift+Space";
const RESERVED_TEXT = "这是系统快捷键，换一个吧";
const TAKEN_TEXT = "这个组合被别的应用占用了，换一个试试";

const appInfo: AppInfo = {
  version: "0.1.0",
  platform: "macos",
  isDev: true,
  clockOffsetMs: 0,
  vibrancy: true,
  shortcut: { accelerator: DEV, registered: true, error: null, conflict: null },
};

function okStatus(accelerator: string): ShortcutStatus {
  return { accelerator, registered: true, error: null, conflict: null };
}

let fake: Api & {
  setBlurGuard: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
  quitApp: ReturnType<typeof vi.fn>;
  loadSnapshot: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  resetMockBackend();
  const base = mockSnapshot();
  base.settings.shortcut = DEV;
  resetMockBackend(base);
  fake = {
    ...mockApi,
    setBlurGuard: vi.fn(async () => undefined),
    quitApp: vi.fn(async () => undefined),
    loadSnapshot: vi.fn(() => mockApi.loadSnapshot()),
    updateSettings: vi.fn(async (patch: SettingsPatch): Promise<SettingsApplied> => {
      const r = await mockApi.updateSettings(patch);
      return { ...r, shortcut: okStatus(r.settings.shortcut) };
    }),
  };
  setApiBackend(fake);
  useUiStore.setState(
    { ...initialUi, today: "2026-09-30", calendarAnchor: "2026-09-28", page: "calendar" },
    true,
  );
  useUiStore.getState().setShortcutStatus(okStatus(DEV));
  useDataStore.setState({ ...initialData, snap: base, status: "ready", appInfo }, true);
});

afterEach(() => {
  setApiBackend(null);
  vi.restoreAllMocks();
});

function EscRoot() {
  useEscDispatcher();
  return null;
}

function renderPanel() {
  useUiStore.getState().openOverlay({ kind: "settings" });
  return render(
    <>
      <EscRoot />
      <OverlayHost />
    </>,
  );
}

/** Like App: the overlay subtree is keyed by the active language, so a switch re-mounts it. */
function LangRoot() {
  const lang = useLanguage();
  return (
    <div key={lang}>
      <EscRoot />
      <OverlayHost />
    </div>
  );
}

/** The capsule of one choice row (a fieldset named after the row). */
function choices(name: string) {
  return within(screen.getByRole("group", { name }));
}

function pressed(name: string): string[] {
  return choices(name)
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent ?? "");
}

function caps(): string {
  return screen.getByTestId("keycaps").textContent ?? "";
}

describe("SettingsPanel", () => {
  it("shows every section with the current settings", () => {
    renderPanel();
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
    // Sections in order: 呼出 / 日历 / 外观 / 语言与时区 / 窗口.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "呼出",
      "日历",
      "外观",
      "语言与时区",
      "窗口",
    ]);
    for (const t of [
      "呼出 WeekPage",
      "显示几周",
      "第一行",
      "打开窗口和回到今天时，日历第一行显示哪一周",
      "主题",
      "语言",
      "失焦时自动隐藏",
      "开机自动启动",
    ]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(caps()).toBe("⌃⌥⇧Space");
    expect(screen.getByText("WeekPage Dev 0.1.0")).toBeTruthy();
    expect(pressed("显示几周")).toEqual(["3周"]);
    expect(pressed("第一行")).toEqual(["本周"]);
    expect(pressed("主题")).toEqual(["跟随系统"]);
    expect(pressed("语言")).toEqual(["跟随系统"]);
    expect(
      choices("显示几周")
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["2周", "3周", "4周"]);
    expect(
      choices("第一行")
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["本周", "上周"]);
    // Both languages are always named in their own script.
    expect(
      choices("语言")
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["跟随系统", "简体中文", "English"]);
  });

  it("显示几周 sets the calendar weeks and saves only that field", async () => {
    renderPanel();
    fireEvent.click(choices("显示几周").getByRole("button", { name: "4周" }));
    expect(useUiStore.getState().calendarWeeks).toBe(4);
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledWith({ calendarWeeks: 4 }));
    expect(pressed("显示几周")).toEqual(["4周"]);
    // The selected option again writes nothing.
    const before = fake.updateSettings.mock.calls.length;
    fireEvent.click(choices("显示几周").getByRole("button", { name: "4周" }));
    expect(fake.updateSettings.mock.calls.length).toBe(before);
  });

  it("第一行 = 上周 saves calendarFirstRow and moves the view to the new home", async () => {
    renderPanel();
    fireEvent.click(choices("第一行").getByRole("button", { name: "上周" }));
    expect(useUiStore.getState().calendarFirstRow).toBe("lastWeek");
    // today 2026-09-30 (Wed): last week's Monday.
    expect(useUiStore.getState().calendarAnchor).toBe("2026-09-21");
    await waitFor(() =>
      expect(fake.updateSettings).toHaveBeenCalledWith({ calendarFirstRow: "lastWeek" }),
    );
    expect(pressed("第一行")).toEqual(["上周"]);
    fireEvent.click(choices("第一行").getByRole("button", { name: "本周" }));
    expect(useUiStore.getState().calendarAnchor).toBe("2026-09-28");
    await waitFor(() =>
      expect(fake.updateSettings).toHaveBeenLastCalledWith({ calendarFirstRow: "thisWeek" }),
    );
  });

  it("时区 defaults to following the system and saves the chosen zone", async () => {
    renderPanel();
    const select = screen.getByLabelText("时区") as HTMLSelectElement;
    expect(select.value).toBe("system");
    expect(select.selectedOptions[0].textContent).toMatch(/^跟随系统（.+）$/);
    fireEvent.change(select, { target: { value: "Asia/Tokyo" } });
    await waitFor(() =>
      expect(fake.updateSettings).toHaveBeenCalledWith({ timezone: "Asia/Tokyo" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("时区") as HTMLSelectElement).value).toBe("Asia/Tokyo"),
    );
  });

  it("语言 saves the language; the re-mounted panel keeps focus on it", async () => {
    render(<LangRoot />);
    act(() => useUiStore.getState().openOverlay({ kind: "settings" }));
    const english = choices("语言").getByRole("button", { name: "English" });
    expect(english.querySelector("[lang]")?.getAttribute("lang")).toBe("en");
    english.focus();
    fireEvent.click(english);
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledWith({ language: "en" }));
    // The whole panel switched to English (re-mounted) and focus is back on the language row.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy());
    const selected = choices("Language").getByRole("button", { name: "English" });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(selected);

    // 简体中文 switches back.
    fireEvent.click(choices("Language").getByRole("button", { name: "简体中文" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy());
    expect(fake.updateSettings).toHaveBeenLastCalledWith({ language: "zh-Hans" });
    expect(document.activeElement?.textContent).toBe("简体中文");
  });

  it("a language choice that renders the same language does not steal focus later", async () => {
    // 跟随系统 resolves to zh-Hans here (test-setup: navigator.languages = ["zh-CN"]).
    useDataStore.getState().patchLocal((s) => ({
      ...s,
      settings: { ...s.settings, language: "zh-Hans" },
    }));
    const { unmount } = render(<LangRoot />);
    act(() => useUiStore.getState().openOverlay({ kind: "settings" }));
    fireEvent.click(choices("语言").getByRole("button", { name: "跟随系统" }));
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledWith({ language: "system" }));
    act(() => useUiStore.getState().closeOverlay());
    unmount();
    // Opened again later: the default focus (first control), not the language row.
    renderPanel();
    expect(document.activeElement?.textContent).toBe("录制");
  });

  it("records a new combo: blur guard up, update_settings, guard down, toast", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "录制" }));
    expect(screen.getByRole("button", { name: "按下新的组合… Esc 取消" })).toBeTruthy();
    await waitFor(() => expect(fake.setBlurGuard).toHaveBeenCalledWith(true));

    // A lone modifier keeps waiting.
    fireEvent.keyDown(window, { key: "Control", code: "ControlLeft", ctrlKey: true });
    expect(fake.updateSettings).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "˚", code: "KeyK", ctrlKey: true, altKey: true });
    await waitFor(() =>
      expect(fake.updateSettings).toHaveBeenCalledWith({ shortcut: "Control+Alt+K" }),
    );
    expect(fake.updateSettings).toHaveBeenCalledTimes(1);
    expect(fake.setBlurGuard).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(useUiStore.getState().toast?.text).toBe("快捷键已改成 ⌃⌥K"));
    expect(caps()).toBe("⌃⌥K");
    expect(useDataStore.getState().snap?.settings.shortcut).toBe("Control+Alt+K");
  });

  it("Esc while recording cancels the recording, not the panel", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "录制" }));
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "录制" })).toBeTruthy();
    expect(fake.updateSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(fake.setBlurGuard).toHaveBeenLastCalledWith(false));
    // A second Esc (not recording) closes the panel.
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses a reserved combo without calling Rust", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "录制" }));
    fireEvent.keyDown(window, { key: " ", code: "Space", metaKey: true });
    expect(screen.getByRole("alert").textContent).toBe(RESERVED_TEXT);
    expect(fake.updateSettings).not.toHaveBeenCalled();
    expect(caps()).toBe("⌃⌥⇧Space");
  });

  it("shows the red line and keeps the old combo when Rust rolls back", async () => {
    fake.updateSettings.mockImplementationOnce(async (patch: SettingsPatch) => {
      const r = await mockApi.updateSettings(patch);
      return {
        ...r,
        shortcut: {
          accelerator: DEV,
          registered: true,
          error: "registration failed: HotKey already registered",
          conflict: null,
        },
      };
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "录制" }));
    fireEvent.keyDown(window, { key: "j", code: "KeyJ", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(TAKEN_TEXT));
    expect(caps()).toBe("⌃⌥⇧Space");
    // The stored setting is re-read (Rust restored it).
    expect(fake.loadSnapshot).toHaveBeenCalled();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it("explains a macOS system-shortcut conflict with the current combo", () => {
    useUiStore.getState().setShortcutStatus({
      accelerator: "Control+Alt+Space",
      registered: true,
      error: null,
      conflict: "input-source-next",
    });
    renderPanel();
    expect(caps()).toBe("⌃⌥Space");
    expect(screen.getByTestId("shortcut-conflict").textContent).toBe(
      "⌃⌥Space 正被系统用于切换输入法。到 系统设置 → 键盘 → 键盘快捷键 → 输入法 关掉『选择输入法菜单中的下一个输入法』，或在这里换一个快捷键",
    );
  });

  it("theme and toggles save only the changed field", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "黑夜" }));
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledWith({ theme: "dark" }));
    fireEvent.click(screen.getByRole("switch", { name: "失焦时自动隐藏" }));
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledWith({ hideOnBlur: false }));
    fireEvent.click(screen.getByRole("switch", { name: "开机自动启动" }));
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledWith({ autostart: true }));
    // Clicking the selected theme again writes nothing.
    const before = fake.updateSettings.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "黑夜" }));
    expect(fake.updateSettings.mock.calls.length).toBe(before);
  });

  it("quit button quits without confirmation", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "退出 WeekPage" }));
    expect(fake.quitApp).toHaveBeenCalledTimes(1);
  });

  it("dev builds explain why autostart does nothing", () => {
    renderPanel();
    expect(
      screen.getByText(
        "关掉后重启电脑，快捷键和提醒都要等你手动打开 WeekPage（开发版不会真的注册开机启动）",
      ),
    ).toBeTruthy();
    expect(screen.getByText("关掉后窗口会一直浮在最上层")).toBeTruthy();
  });

  it("renders in English, including the recorder and its toast", async () => {
    act(() => setLang("en"));
    renderPanel();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    for (const t of [
      "Shortcut",
      "Appearance",
      "Window",
      "Show WeekPage",
      "Theme",
      "Hide when you click away",
      "Open at login",
    ]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getByText("WeekPage Dev 0.1.0")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Shortcut",
      "Calendar",
      "Appearance",
      "Language & time zone",
      "Window",
    ]);
    expect(pressed("Theme")).toEqual(["System"]);
    expect(choices("Theme").getByRole("button", { name: "Light" })).toBeTruthy();
    expect(choices("Theme").getByRole("button", { name: "Dark" })).toBeTruthy();
    expect(pressed("Weeks shown")).toEqual(["3 weeks"]);
    expect(
      choices("Top row")
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["This week", "Last week"]);
    expect(
      screen.getByText(
        "The week the calendar starts with when the window opens and when you go back to today",
      ),
    ).toBeTruthy();
    expect(
      choices("Language")
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["System", "简体中文", "English"]);
    expect(
      choices("Language").getByRole("button", { name: "简体中文" }).querySelector("[lang]"),
    ).toHaveProperty("lang", "zh-Hans");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quit WeekPage" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(screen.getByRole("button", { name: "Press keys… Esc to cancel" })).toBeTruthy();
    fireEvent.keyDown(window, { key: " ", code: "Space", metaKey: true });
    expect(screen.getByRole("alert").textContent).toBe(
      "That's a system shortcut. Pick another one.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    fireEvent.keyDown(window, { key: "˚", code: "KeyK", ctrlKey: true, altKey: true });
    await waitFor(() => expect(useUiStore.getState().toast?.text).toBe("Shortcut changed to ⌃⌥K"));
  });

  it("unmounting while recording releases the blur guard", async () => {
    const { unmount } = render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "录制" }));
    await waitFor(() => expect(fake.setBlurGuard).toHaveBeenCalledWith(true));
    unmount();
    expect(fake.setBlurGuard).toHaveBeenLastCalledWith(false);
  });
});

describe("FirstRunHint", () => {
  it("shows once with the current shortcut and closes for good", async () => {
    render(<FirstRunHint />);
    expect(screen.getByText("按 ⌃⌥⇧Space 试试能不能收起；不行就去设置里换一个")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    await waitFor(() =>
      expect(fake.updateSettings).toHaveBeenCalledWith({ onboardingShortcutHintSeen: true }),
    );
    await waitFor(() => expect(screen.queryByLabelText("快捷键提示")).toBeNull());
  });

  it("adds the conflict guidance and uses Windows labels on Windows", () => {
    act(() => {
      useDataStore.setState({ appInfo: { ...appInfo, platform: "windows" } });
      useUiStore.getState().setShortcutStatus({
        accelerator: "Control+Alt+Space",
        registered: true,
        error: null,
        conflict: null,
      });
    });
    render(<FirstRunHint />);
    expect(screen.getByText("按 Ctrl+Alt+Space 试试能不能收起；不行就去设置里换一个")).toBeTruthy();
  });

  it("macOS conflict line under the hint", () => {
    useUiStore.getState().setShortcutStatus({
      accelerator: "Control+Alt+Space",
      registered: true,
      error: null,
      conflict: "input-source-next",
    });
    render(<FirstRunHint />);
    expect(screen.getByText(/正被系统用于切换输入法/)).toBeTruthy();
  });

  it("hidden once seen", () => {
    const snap = useDataStore.getState().snap;
    if (!snap) throw new Error("no snapshot");
    useDataStore.setState({
      snap: { ...snap, settings: { ...snap.settings, onboardingShortcutHintSeen: true } },
    });
    render(<FirstRunHint />);
    expect(screen.queryByLabelText("快捷键提示")).toBeNull();
  });

  it("renders in English", () => {
    act(() => setLang("en"));
    render(<FirstRunHint />);
    expect(screen.getByLabelText("Shortcut tip")).toBeTruthy();
    expect(
      screen.getByText(
        "Press ⌃⌥⇧Space to check that it hides the window. If it doesn't, pick another one in Settings.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
  });

  it("去设置 opens the settings panel", () => {
    render(<FirstRunHint />);
    fireEvent.click(screen.getByRole("button", { name: "去设置" }));
    expect(useUiStore.getState().overlay).toEqual({ kind: "settings" });
  });
});
