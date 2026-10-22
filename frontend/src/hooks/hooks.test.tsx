import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "@/i18n";
import { mondayOf } from "@/lib/dates";
import { mockApi, mockEmit, resetMockBackend } from "@/lib/mockBackend";
import { useDataStore } from "./useDataStore";
import {
  dispatchEscape,
  ESC_PRIORITY,
  escLayerCount,
  useEscDispatcher,
  useEscLayer,
} from "./useEscLayer";
import { handleUndoKey, isEditableTarget, matchCombo, useGlobalHotkeys } from "./useHotkeys";
import { isImeKey, useImeSafeEnter } from "./useImeSafeEnter";
import { useShellEvents } from "./useShellEvents";
import { applyTheme } from "./useTheme";
import { LAST_PAGE_SAVE_MS, useUiStore } from "./useUiStore";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

beforeEach(() => {
  resetMockBackend();
  useUiStore.setState({ ...initialUi, today: "2026-09-30", calendarAnchor: "2026-09-28" }, true);
  useDataStore.setState(initialData, true);
});

afterEach(() => vi.restoreAllMocks());

describe("useImeSafeEnter", () => {
  function Field({ onEnter }: { onEnter: () => void }) {
    const ime = useImeSafeEnter(onEnter);
    return <input aria-label="f" {...ime} />;
  }

  it("Enter while composing (or keyCode 229) does not submit; the next Enter does", () => {
    const onEnter = vi.fn();
    render(<Field onEnter={onEnter} />);
    const input = screen.getByLabelText("f");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onEnter).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" }); // within 30 ms of compositionend
    expect(onEnter).not.toHaveBeenCalled();
    const later = performance.now() + 100;
    vi.spyOn(performance, "now").mockReturnValue(later);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("Shift+Enter is ignored by default", () => {
    const onEnter = vi.fn();
    render(<Field onEnter={onEnter} />);
    fireEvent.keyDown(screen.getByLabelText("f"), { key: "Enter", shiftKey: true });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("isImeKey covers isComposing, 229 and the grace window", () => {
    expect(isImeKey({ key: "Enter", nativeEvent: { isComposing: true } }, -Infinity, 0)).toBe(true);
    expect(isImeKey({ key: "Enter", keyCode: 229 }, -Infinity, 0)).toBe(true);
    expect(isImeKey({ key: "Enter" }, 100, 120)).toBe(true);
    expect(isImeKey({ key: "Enter" }, 100, 200)).toBe(false);
  });
});

describe("useEscLayer", () => {
  function Layers({ a, b }: { a: () => void; b: () => void }) {
    useEscDispatcher();
    useEscLayer(true, a, ESC_PRIORITY.modal);
    useEscLayer(true, b, ESC_PRIORITY.inlineInput);
    return null;
  }

  it("the highest priority layer wins; empty stack hides the window", () => {
    const hide = vi.spyOn(mockApi, "windowHide");
    const a = vi.fn();
    const b = vi.fn();
    const { unmount } = render(<Layers a={a} b={b} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    unmount();
    expect(escLayerCount()).toBe(0);
    expect(dispatchEscape(new KeyboardEvent("keydown", { key: "Escape" }))).toBe("hide");
    expect(hide).toHaveBeenCalledOnce();
  });

  it("never interrupts IME composition", () => {
    const e = new KeyboardEvent("keydown", { key: "Escape", isComposing: true });
    expect(dispatchEscape(e)).toBe("ignored");
  });
});

describe("useHotkeys", () => {
  function Shell() {
    useGlobalHotkeys();
    return <input aria-label="text" />;
  }

  it("matches mod combos by key or physical code", () => {
    const e = new KeyboardEvent("keydown", {
      key: "!",
      code: "Digit1",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(matchCombo("mod+shift+1", e, false)).toBe(true);
    expect(
      matchCombo("mod+1", new KeyboardEvent("keydown", { key: "1", metaKey: true }), true),
    ).toBe(true);
    expect(
      matchCombo("mod+1", new KeyboardEvent("keydown", { key: "1", ctrlKey: true }), true),
    ).toBe(false);
  });

  it("mod+2 / mod+1 switch pages, mod+, opens settings", () => {
    render(<Shell />);
    fireEvent.keyDown(window, { key: "2", code: "Digit2", ctrlKey: true });
    expect(useUiStore.getState().page).toBe("tasks");
    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    expect(useUiStore.getState().overlay).toEqual({ kind: "settings" });
    fireEvent.keyDown(window, { key: "1", code: "Digit1", ctrlKey: true });
    expect(useUiStore.getState().page).toBe("calendar");
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it("mod+Z undoes the toast outside inputs but is left to the input inside one", () => {
    const undo = vi.spyOn(mockApi, "undo").mockResolvedValue(undefined);
    render(<Shell />);
    act(() => useUiStore.getState().showToast({ text: "已删掉", opIds: ["op1"] }));

    const input = screen.getByLabelText("text");
    const inInput = fireEvent.keyDown(input, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(inInput).toBe(true); // not prevented: native text undo
    expect(undo).not.toHaveBeenCalled();
    expect(isEditableTarget(input)).toBe(true);

    const outside = fireEvent.keyDown(document.body, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(outside).toBe(false); // prevented
    expect(undo).toHaveBeenCalledWith(["op1"]);
  });

  it("mod+Z without a toast is not consumed", () => {
    const e = new KeyboardEvent("keydown", { key: "z", ctrlKey: true });
    expect(handleUndoKey(e)).toBe(false);
  });
});

describe("useUiStore", () => {
  it("setPage saves lastPage (not archive) once the switching stops; weeks save at once", async () => {
    const update = vi.spyOn(mockApi, "updateSettings");
    useDataStore.setState({ snap: await mockApi.loadSnapshot(), status: "ready" });
    vi.useFakeTimers();
    useUiStore.getState().setPage("tasks");
    useUiStore.getState().setPage("calendar");
    useUiStore.getState().setPage("tasks");
    useUiStore.getState().setPage("archive");
    useUiStore.getState().setCalendarWeeks(4);
    expect(update.mock.calls.map((c) => c[0])).toEqual([{ calendarWeeks: 4 }]);
    vi.advanceTimersByTime(LAST_PAGE_SAVE_MS);
    vi.useRealTimers();
    expect(update.mock.calls.map((c) => c[0])).toEqual([
      { calendarWeeks: 4 },
      { lastPage: "tasks" },
    ]);
  });

  it("setPage closes an open overlay first", () => {
    useUiStore.getState().openOverlay({ kind: "settings" });
    useUiStore.getState().setPage("tasks");
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it("setDragging raises the blur guard", () => {
    const guard = vi.spyOn(mockApi, "setBlurGuard");
    useUiStore.getState().setDragging(true);
    useUiStore.getState().setDragging(false);
    expect(guard.mock.calls).toEqual([[true], [false]]);
  });
});

describe("useDataStore", () => {
  it("refresh loads the snapshot", async () => {
    await useDataStore.getState().refresh();
    expect(useDataStore.getState().status).toBe("ready");
    expect(useDataStore.getState().snap?.events).toHaveLength(11);
  });

  it("mutate refreshes, toasts with the op id and highlights", async () => {
    const m = { opId: "op-9", id: "new-id" };
    await useDataStore.getState().mutate(async () => m, {
      toast: { text: "已变成任务" },
      highlight: (r) => (r.id ? { id: r.id, reason: "fromInbox" } : null),
    });
    expect(useDataStore.getState().snap).not.toBeNull();
    expect(useUiStore.getState().toast?.opIds).toEqual(["op-9"]);
    expect(useUiStore.getState().highlight).toMatchObject({ id: "new-id", reason: "fromInbox" });
  });

  it("mutate failure shows the generic toast and returns null", async () => {
    const res = await useDataStore
      .getState()
      .mutate(() => Promise.reject(new Error("write failed")));
    expect(res).toBeNull();
    expect(useUiStore.getState().toast).toMatchObject({ text: "操作没成功，再试一次", opIds: [] });
    setLang("en");
    await useDataStore.getState().mutate(() => Promise.reject(new Error("write failed")));
    expect(useUiStore.getState().toast?.text).toBe("That didn't work. Try again.");
  });

  it("saveSettings replaces only snap.settings", async () => {
    await useDataStore.getState().refresh();
    const before = useDataStore.getState().snap;
    await useDataStore.getState().saveSettings({ theme: "dark" });
    const after = useDataStore.getState().snap;
    expect(after?.settings.theme).toBe("dark");
    expect(after?.events).toBe(before?.events);
  });
});

describe("useShellEvents", () => {
  it("shell://shown and shell://hidden reset anchor, popover and overlay; navigate and day-changed apply", async () => {
    renderHook(() => useShellEvents());
    await act(async () => undefined);
    useUiStore.setState({ calendarAnchor: "2026-10-12", today: "2026-09-30" });
    useUiStore.getState().openOverlay({ kind: "settings" });
    useUiStore.getState().openPopover({
      kind: "newTask",
      title: "",
      anchor: { top: 0, left: 0, width: 0, height: 0 },
    });
    act(() => mockEmit("shell://shown", { reason: "shortcut" }));
    const ui = useUiStore.getState();
    expect(ui.calendarAnchor).toBe(mondayOf(ui.today));
    expect(ui.overlay).toBeNull();
    expect(ui.popover).toBeNull();

    // shell://hidden resets the same things before the window comes back (no flash on show).
    useUiStore.setState({ calendarAnchor: "2026-10-12", page: "archive" });
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: "t" });
    act(() => mockEmit("shell://hidden", {}));
    const hidden = useUiStore.getState();
    expect(hidden.overlay).toBeNull();
    expect(hidden.page).toBe("tasks");
    expect(hidden.calendarAnchor).toBe(mondayOf(hidden.today));

    act(() => mockEmit("shell://navigate", { page: "settings" }));
    expect(useUiStore.getState().overlay).toEqual({ kind: "settings" });
    act(() => mockEmit("shell://navigate", { page: "tasks" }));
    expect(useUiStore.getState().page).toBe("tasks");

    act(() => mockEmit("clock://day-changed", { today: "2026-10-01" }));
    expect(useUiStore.getState().today).toBe("2026-10-01");

    act(() =>
      mockEmit("shell://shortcut-status", {
        accelerator: "Control+Alt+Space",
        registered: false,
        error: "taken",
      }),
    );
    expect(useUiStore.getState().shortcutStatus?.error).toBe("taken");
  });
});

describe("useTheme", () => {
  it("applies data-theme and no-vibrancy", () => {
    const root = document.createElement("html");
    applyTheme(root, "dark", false);
    expect(root.dataset.theme).toBe("dark");
    expect(root.classList.contains("no-vibrancy")).toBe(true);
    applyTheme(root, "system", true);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.classList.contains("no-vibrancy")).toBe(false);
  });
});
