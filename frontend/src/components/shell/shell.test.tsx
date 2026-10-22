import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACK_TO_TODAY_EXIT_MS } from "@/components/calendar/BackToToday";
import { backToToday, shiftWeek } from "@/components/calendar/calendarNav";
import { SWIPE_IDLE_MS } from "@/components/ui/SwipeRow";
import { useDataStore } from "@/hooks/useDataStore";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { useUiStore } from "@/hooks/useUiStore";
import { setLang } from "@/i18n";
import { mockApi, resetMockBackend } from "@/lib/mockBackend";
import { inboxTriageToast } from "@/lib/toasts";
import { resetTrackpad, setTrackpadTouching } from "@/lib/trackpad";
import { AppFrame } from "./AppFrame";
import { OverlayHost } from "./OverlayHost";
import { PageStage } from "./PageStage";
import { PageSwitch } from "./PageSwitch";
import { PageTitle } from "./PageTitle";
import { Paper } from "./Paper";
import { PopoverHost, placePopover } from "./PopoverHost";
import { ToastHost } from "./ToastHost";
import { Toolbar } from "./Toolbar";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

beforeEach(() => {
  resetMockBackend();
  useUiStore.setState(
    { ...initialUi, today: "2026-09-30", calendarAnchor: "2026-09-28", page: "calendar" },
    true,
  );
  useDataStore.setState(initialData, true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function EscRoot() {
  useEscDispatcher();
  return null;
}

describe("AppFrame / Paper", () => {
  it("nests the paper inside the frame", () => {
    render(
      <AppFrame>
        <Paper>content</Paper>
      </AppFrame>,
    );
    expect(screen.getByRole("main").textContent).toBe("content");
  });
});

describe("Toolbar / PageTitle / PageSwitch", () => {
  it("calendar title is the month of the first visible day", () => {
    render(<PageTitle />);
    expect(screen.getByRole("heading").textContent).toBe("9月2026");
  });

  it("clicking 任务 switches page and title (ui-spec §1.3)", async () => {
    render(<Toolbar />);
    expect(screen.getByRole("heading").textContent).toBe("9月2026");
    // The old week-nav and weeks capsules are gone; at home there is no 「回到今天」 either.
    expect(screen.queryByRole("button", { name: "今天" })).toBeNull();
    expect(screen.queryByRole("button", { name: "3周" })).toBeNull();
    expect(screen.queryByRole("button", { name: "回到今天" })).toBeNull();
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /任务/ }));
    expect(useUiStore.getState().page).toBe("tasks");
    expect(screen.getByRole("heading").textContent).toBe("9月30日周三");
    // 「归档」 takes the calendar slot right away; the gear stays.
    expect(screen.getByRole("button", { name: /归档/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "设置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /任务/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("archive page keeps 任务 selected and the toolbar is a drag region", () => {
    useUiStore.setState({ page: "archive" });
    const { container } = render(<Toolbar />);
    expect(screen.getByRole("button", { name: /任务/ }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("header")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(screen.getByRole("group").hasAttribute("data-tauri-drag-region")).toBe(false);
  });

  it("right side order: calendar [回到今天] [设置] [页面], tasks [归档] [设置] [页面]", () => {
    useUiStore.setState({ calendarAnchor: "2026-10-12" });
    const { container, rerender } = render(<Toolbar />);
    const names = () =>
      Array.from(container.querySelectorAll("header > div > button, header > div > fieldset")).map(
        (el) => el.getAttribute("aria-label") ?? el.textContent,
      );
    expect(names()).toEqual(["回到今天", "设置", "页面"]);
    act(() => useUiStore.setState({ page: "tasks" }));
    rerender(<Toolbar />);
    expect(names()).toEqual(["归档", "设置", "页面"]);
  });

  it("the gear opens the settings panel; its tooltip names mod+,", async () => {
    render(
      <>
        <Toolbar />
        <OverlayHost />
      </>,
    );
    const gear = screen.getByRole("button", { name: "设置" });
    // jsdom's user agent is not a Mac: the Windows spelling.
    expect(gear.getAttribute("title")).toBe("设置 Ctrl+,");
    expect(gear.getAttribute("aria-keyshortcuts")).toBe("Control+,");
    await userEvent.click(gear);
    expect(useUiStore.getState().overlay).toEqual({ kind: "settings" });
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
  });

  it("PageSwitch shows the Windows-style hint off macOS", () => {
    render(<PageSwitch />);
    expect(screen.getByRole("button", { name: /日历/ }).textContent).toBe("日历Ctrl 1");
    expect(screen.getByRole("group", { name: "页面" })).toBeTruthy();
  });

  it("PageSwitch in English", () => {
    act(() => setLang("en"));
    render(<PageSwitch />);
    expect(screen.getByRole("group", { name: "Pages" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Calendar/ }).textContent).toBe("CalendarCtrl 1");
    expect(screen.getByRole("button", { name: /Tasks/ })).toBeTruthy();
  });
});

describe("BackToToday (toolbar, calendar page)", () => {
  const pill = () => screen.queryByRole("button", { name: "回到今天" });

  it("shows only away from home; the arrow points to where today is", () => {
    render(<Toolbar />);
    expect(pill()).toBeNull();
    // Scrolled into later weeks: today is above.
    act(() => shiftWeek(2));
    expect(pill()?.dataset.direction).toBe("up");
    expect(pill()?.getAttribute("title")).toBe("回到今天（T）");
    expect(pill()?.getAttribute("aria-keyshortcuts")).toBe("T");
    // Scrolled into earlier weeks: today is below.
    act(() => shiftWeek(-4));
    expect(useUiStore.getState().calendarAnchor).toBe("2026-09-14");
    expect(pill()?.dataset.direction).toBe("down");
  });

  it("click goes home, then the pill fades out and unmounts", () => {
    vi.useFakeTimers();
    useUiStore.setState({ calendarAnchor: "2026-10-12" });
    const { container } = render(<Toolbar />);
    fireEvent.click(pill() as HTMLElement);
    expect(useUiStore.getState().calendarAnchor).toBe("2026-09-28");
    // Fading out: already out of the accessibility tree and the tab order, still in the DOM.
    expect(pill()).toBeNull();
    const leaving = container.querySelector<HTMLElement>("[data-direction]");
    expect(leaving?.dataset.direction).toBe("up");
    expect(leaving?.getAttribute("tabindex")).toBe("-1");
    act(() => vi.advanceTimersByTime(BACK_TO_TODAY_EXIT_MS));
    expect(container.querySelector("[data-direction]")).toBeNull();
  });

  it("coming back during the fade-out keeps it", () => {
    vi.useFakeTimers();
    useUiStore.setState({ calendarAnchor: "2026-10-12" });
    render(<Toolbar />);
    act(() => backToToday());
    act(() => shiftWeek(-1));
    act(() => vi.advanceTimersByTime(BACK_TO_TODAY_EXIT_MS * 2));
    expect(pill()?.dataset.direction).toBe("down");
  });

  it("home follows the 第一行 setting (上周 = last week on the first row)", () => {
    useUiStore.setState({ calendarFirstRow: "lastWeek" });
    render(<Toolbar />);
    // This week on the first row is one week past home.
    expect(pill()?.dataset.direction).toBe("up");
    fireEvent.click(pill() as HTMLElement);
    expect(useUiStore.getState().calendarAnchor).toBe("2026-09-21");
  });

  it("not on the task page, even away from home", () => {
    useUiStore.setState({ page: "tasks", calendarAnchor: "2026-10-12" });
    render(<Toolbar />);
    expect(pill()).toBeNull();
  });

  it("English: 「Today」 pill and 「Settings」 gear", () => {
    act(() => setLang("en"));
    useUiStore.setState({ calendarAnchor: "2026-10-12" });
    render(<Toolbar />);
    const today = screen.getByRole("button", { name: "Today" });
    expect(today.getAttribute("title")).toBe("Back to today (T)");
    const gear = screen.getByRole("button", { name: "Settings" });
    expect(gear.getAttribute("title")).toBe("Settings Ctrl+,");
  });
});

describe("OverlayHost", () => {
  it("renders the overlay and closes it on scrim click", async () => {
    useUiStore.getState().openOverlay({ kind: "settings" });
    render(<OverlayHost />);
    expect(screen.getByRole("dialog", { name: "设置" })).toBeTruthy();
    expect(screen.getByTestId("overlay-scrim").getAttribute("aria-label")).toBe("关闭浮层");
    await userEvent.click(screen.getByTestId("overlay-scrim"));
    expect(useUiStore.getState().overlay).toBeNull();
  });

  it("an overlay already open at mount (language switch re-keys the paper) skips the entrance", () => {
    vi.useFakeTimers();
    useUiStore.getState().openOverlay({ kind: "settings" });
    render(<OverlayHost />);
    expect(screen.getByTestId("overlay-layer").className).toContain("instant");
    act(() => useUiStore.getState().closeOverlay());
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("overlay-layer")).toBeNull();
    // Opened while the host is mounted: the usual entrance.
    act(() => useUiStore.getState().openOverlay({ kind: "settings" }));
    expect(screen.getByTestId("overlay-layer").className).not.toContain("instant");
  });

  it("closing keeps one exit beat; a drop on window hide unmounts at once (ui-spec §1.1)", () => {
    vi.useFakeTimers();
    render(<OverlayHost />);
    act(() => useUiStore.getState().openOverlay({ kind: "settings" }));
    act(() => useUiStore.getState().closeOverlay());
    expect(screen.getByTestId("overlay-layer").className).toContain("leaving");
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("overlay-layer")).toBeNull();
    act(() => useUiStore.getState().openOverlay({ kind: "settings" }));
    act(() => useUiStore.getState().dropOverlay());
    expect(screen.queryByTestId("overlay-layer")).toBeNull();
  });

  it("Esc closes the overlay first, then hides the window (ui-spec §15.4)", () => {
    const hide = vi.spyOn(mockApi, "windowHide");
    useUiStore.getState().openOverlay({ kind: "taskDetail", taskId: "t1" });
    render(
      <>
        <EscRoot />
        <OverlayHost />
      </>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().overlay).toBeNull();
    expect(hide).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hide).toHaveBeenCalledOnce();
  });
});

describe("PopoverHost", () => {
  it("places right of the anchor, flips left, clamps into the viewport", () => {
    const vp = { width: 1280, height: 860 };
    const size = { width: 280, height: 300 };
    expect(placePopover({ top: 100, left: 300, width: 40, height: 20 }, size, vp)).toEqual({
      top: 100,
      left: 346,
      side: "right",
    });
    expect(placePopover({ top: 100, left: 1100, width: 40, height: 20 }, size, vp)).toEqual({
      top: 100,
      left: 814,
      side: "left",
    });
    expect(placePopover({ top: 800, left: 300, width: 40, height: 20 }, size, vp).top).toBe(552);
  });

  it("closes on outside click and on Esc before the overlay", () => {
    useUiStore.getState().openOverlay({ kind: "settings" });
    useUiStore.getState().openPopover({
      kind: "datePicker",
      purpose: "todoReminder",
      targetId: "x",
      anchor: { top: 10, left: 10, width: 10, height: 10 },
    });
    render(
      <>
        <EscRoot />
        <OverlayHost />
        <PopoverHost />
      </>,
    );
    expect(screen.getByRole("dialog", { name: "选日期" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().popover).toBeNull();
    expect(useUiStore.getState().overlay).not.toBeNull();

    act(() =>
      useUiStore.getState().openPopover({
        kind: "newTask",
        title: "",
        anchor: { top: 10, left: 10, width: 10, height: 10 },
      }),
    );
    fireEvent.mouseDown(document.body);
    expect(useUiStore.getState().popover).toBeNull();
  });
});

describe("ToastHost", () => {
  it("merges inbox triage toasts and undoes every op (ui-spec §6.4)", async () => {
    const undo = vi.spyOn(mockApi, "undo").mockResolvedValue(undefined);
    render(<ToastHost />);
    act(() => {
      const ui = useUiStore.getState();
      ui.showToast({ ...inboxTriageToast("scheduled", "2026-10-05"), opIds: ["op1"] });
      ui.showToast({ ...inboxTriageToast("task"), opIds: ["op2"] });
      ui.showToast({ ...inboxTriageToast("task"), opIds: ["op3"] });
    });
    expect(screen.getByRole("status").textContent).toContain(
      "收件箱整理完 3 条：1 条进待办 · 2 条变任务",
    );
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(undo).toHaveBeenCalledWith(["op1", "op2", "op3"]);
    expect(screen.getByRole("status").textContent).toBe("已撤销");
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
  });

  it("a different kind replaces the toast; it disappears after 6 s unless hovered", () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => {
      useUiStore.getState().showToast({ ...inboxTriageToast("task"), opIds: ["a"] });
      useUiStore.getState().showToast({ text: "已删除「看房」", opIds: ["b"] });
    });
    expect(useUiStore.getState().toast?.opIds).toEqual(["b"]);
    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(6_001));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("English undo button and texts", async () => {
    vi.spyOn(mockApi, "undo").mockResolvedValue(undefined);
    act(() => setLang("en"));
    render(<ToastHost />);
    act(() => {
      const ui = useUiStore.getState();
      ui.showToast({ ...inboxTriageToast("deleted"), opIds: ["op1"] });
    });
    expect(screen.getByRole("status").textContent).toContain("Deleted");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("status").textContent).toBe("Undone");
  });

  it("a notice (nothing happened: refused move, failed write) shows an info icon, not ✓", () => {
    render(<ToastHost />);
    act(() => useUiStore.getState().showToast({ text: "开始日不能晚于截止日", opIds: [] }));
    expect(screen.getByRole("status").querySelector("[data-tone=notice]")).toBeNull();
    act(() =>
      useUiStore.getState().showToast({ text: "开始日不能晚于截止日", opIds: [], tone: "notice" }),
    );
    expect(screen.getByRole("status").querySelector("[data-tone=notice]")).not.toBeNull();
  });

  it("sits higher on the calendar page", () => {
    useUiStore.getState().showToast({ text: "x", opIds: [] });
    const { rerender } = render(<ToastHost />);
    const onCalendar = screen.getByRole("status").className;
    act(() => useUiStore.setState({ page: "tasks" }));
    rerender(<ToastHost />);
    expect(screen.getByRole("status").className).not.toBe(onCalendar);
  });
});

describe("PageStage: sideways two-finger swipe switches pages (ui-spec §1.3)", () => {
  // No layout here (width 0): the stage switches at once instead of sliding.
  const stage = () => document.querySelector<HTMLElement>("[data-page-stage]") as HTMLElement;
  const slot = (p: string) => stage().querySelector<HTMLElement>(`[data-page-slot="${p}"]`);
  const slots = () =>
    Array.from(stage().querySelectorAll<HTMLElement>("[data-page-slot]")).map(
      (c) => `${c.dataset.pageSlot}${c.inert ? " (inert)" : ""}`,
    );
  const page = () => useUiStore.getState().page;
  /** One gesture: `n` wheel events; true when every one was left to the page underneath. */
  const swipe = (target: Element, deltaX: number, deltaY = 0, n = 6) => {
    let passed = true;
    for (let i = 0; i < n; i++) {
      passed = fireEvent.wheel(target, { deltaX, deltaY, cancelable: true }) && passed;
    }
    return passed;
  };
  /** The wheel goes quiet: the next event starts a new gesture. */
  const quiet = () => act(() => vi.advanceTimersByTime(SWIPE_IDLE_MS + 10));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => resetTrackpad());

  // With natural scrolling a positive deltaX is the fingers moving left.
  it("calendar left, tasks right: fingers left go to tasks, fingers right back to the calendar", () => {
    render(<PageStage />);
    expect(slots()).toEqual(["calendar"]);
    expect(swipe(stage(), 20)).toBe(false);
    expect(page()).toBe("tasks");
    expect(slots()).toEqual(["calendar (inert)", "tasks"]);
    expect(slot("tasks")?.style.transform).toBe("");
    // The page left waits off-screen on its own side.
    expect(slot("calendar")?.style.transform).toMatch(/^translate3d\(-/);
    quiet();
    swipe(stage(), -20);
    expect(page()).toBe("calendar");
    expect(slots()).toEqual(["calendar", "tasks (inert)"]);
  });

  it("never wraps around: towards the empty side nothing switches", () => {
    render(<PageStage />);
    swipe(stage(), -20);
    expect(page()).toBe("calendar");
    quiet();
    swipe(stage(), 20);
    expect(page()).toBe("tasks");
    quiet();
    swipe(stage(), 20);
    expect(page()).toBe("tasks");
  });

  it("the other page is mounted shortly after the first snapshot", async () => {
    useDataStore.setState({ snap: await mockApi.loadSnapshot(), status: "ready" });
    render(<PageStage />);
    expect(slots()).toEqual(["calendar"]);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(slots()).toEqual(["calendar", "tasks (inert)"]);
  });

  it("the rest of the swipe (momentum) never switches back or reaches the new page", () => {
    render(<PageStage />);
    swipe(stage(), 20);
    expect(page()).toBe("tasks");
    expect(swipe(stage(), 20, 0, 20)).toBe(false);
    expect(page()).toBe("tasks");
  });

  it("with the fingers reported down nothing happens, however long they rest; the lift acts", () => {
    render(<PageStage />);
    act(() => setTrackpadTouching(true));
    swipe(stage(), 20);
    quiet();
    quiet();
    expect(page()).toBe("calendar");
    act(() => setTrackpadTouching(false));
    expect(page()).toBe("tasks");
    // A lift after too short a swipe does nothing.
    quiet();
    act(() => setTrackpadTouching(true));
    swipe(stage(), 2, 0, 4);
    act(() => setTrackpadTouching(false));
    expect(page()).toBe("tasks");
  });

  it("a gesture that locks vertical is the page's (week scrolling, lists)", () => {
    render(<PageStage />);
    expect(swipe(stage(), 3, 12)).toBe(true);
    expect(page()).toBe("calendar");
  });

  it("not from a swipe row or a text field: those swipes are theirs", () => {
    render(<PageStage />);
    const live = slot("calendar") as HTMLElement;
    const row = document.createElement("div");
    row.dataset.swipeRow = "true";
    const input = document.createElement("input");
    live.append(row, input);
    expect(swipe(row, 20)).toBe(true);
    quiet();
    expect(swipe(input, 20)).toBe(true);
    expect(page()).toBe("calendar");
    row.remove();
    input.remove();
  });

  it("not with an overlay or popover open, and never on the archive page", () => {
    render(<PageStage />);
    act(() => useUiStore.setState({ overlay: { kind: "settings" } }));
    expect(swipe(stage(), 20)).toBe(true);
    quiet();
    act(() => useUiStore.setState({ overlay: null, page: "archive" }));
    expect(swipe(stage(), 20)).toBe(true);
    expect(page()).toBe("archive");
    expect(slots()).toEqual(["calendar (inert)", "archive"]);
  });

  it("page switches from elsewhere (mod+1 / mod+2, the page switch) land the new page", () => {
    render(<PageStage />);
    act(() => useUiStore.getState().setPage("tasks"));
    expect(slots()).toEqual(["calendar (inert)", "tasks"]);
    act(() => useUiStore.getState().setPage("archive"));
    expect(slots()).toEqual(["calendar (inert)", "tasks (inert)", "archive"]);
    act(() => useUiStore.getState().setPage("tasks"));
    expect(slots()).toEqual(["calendar (inert)", "tasks"]);
  });
});

describe("PageStage: sliding past an end (ui-spec §1.3)", () => {
  const W = 1000;
  const stage = () => document.querySelector<HTMLElement>("[data-page-stage]") as HTMLElement;
  /** Where the tasks page is drawn (px; 0 = in place). */
  const shown = () => {
    const t = document.querySelector<HTMLElement>('[data-page-slot="tasks"]')?.style.transform;
    return t ? Number.parseFloat(t.slice("translate3d(".length)) : 0;
  };
  const wheel = (deltaX: number) =>
    fireEvent.wheel(stage(), { deltaX, deltaY: 0, cancelable: true });
  const frames = (n: number) => {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      act(() => vi.advanceTimersByTime(16));
      xs.push(shown());
    }
    return xs;
  };
  /** Fingers down on tasks, `n` events moving left (natural scrolling: + deltaX). */
  const pull = (n: number, deltaX = 30) => {
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < n; i++) {
      wheel(deltaX);
      act(() => vi.advanceTimersByTime(8));
    }
    frames(1);
  };

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
        "Date",
      ],
    });
    useDataStore.setState({ snap: await mockApi.loadSnapshot(), status: "ready" });
    render(<PageStage />);
    Object.defineProperty(stage(), "clientWidth", { value: W, configurable: true });
    await act(async () => vi.advanceTimersByTime(1000));
    act(() => useUiStore.getState().setPage("tasks"));
    frames(60);
    expect(shown()).toBe(0);
  });

  afterEach(() => resetTrackpad());

  it("the lift while the fingers still move never flings the page further out", () => {
    pull(40);
    const out = shown();
    expect(out).toBeLessThan(-40); // given way towards the empty side…
    expect(out).toBeGreaterThan(-56); // …but never past OVERDRAG_PX
    act(() => setTrackpadTouching(false));
    const xs = frames(40);
    expect(Math.min(...xs)).toBeGreaterThan(out - 1);
    expect(xs[xs.length - 1]).toBe(0);
    expect(useUiStore.getState().page).toBe("tasks");
  });

  it("fingers back while it springs home take it from where it is", () => {
    pull(40);
    act(() => setTrackpadTouching(false));
    frames(4);
    const before = shown();
    expect(before).toBeLessThan(-20);
    act(() => setTrackpadTouching(true));
    wheel(1);
    frames(1);
    expect(Math.abs(shown() - before)).toBeLessThan(3);
  });

  it("after a reported lift, momentum stays swallowed even when merged into a bigger, later event", () => {
    pull(40);
    act(() => setTrackpadTouching(false));
    const xs: number[] = [];
    for (const [gap, dx] of [
      [16, 20],
      [16, 18],
      [60, 45], // a busy frame: two momentum events merged, late
      [16, 15],
    ]) {
      act(() => vi.advanceTimersByTime(gap));
      expect(wheel(dx)).toBe(false);
      xs.push(shown());
    }
    // Springing home all along: never pulled back out.
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
  });
});
