import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscDispatcher } from "@/hooks/useEscLayer";
import { resetTrackpad, setTrackpadTouching } from "@/lib/trackpad";
import {
  closeOpenSwipeRow,
  PEEK_DELAY_MS,
  PEEK_PX,
  PEEK_STEP_MS,
  SWIPE_IDLE_MS,
  SwipeRow,
  type SwipeRowProps,
} from "./SwipeRow";

function EscRoot() {
  useEscDispatcher();
  return null;
}

function Row(props: Partial<SwipeRowProps>) {
  return (
    <>
      <EscRoot />
      <SwipeRow
        right={{ label: "完成", icon: null, tone: "st", run: () => undefined }}
        onDelete={() => undefined}
        deleteLabel="删除"
        {...props}
      >
        <button type="button">勾掉</button>
        <input aria-label="文字" defaultValue="abc" />
        <input type="checkbox" aria-label="选中" />
        <span data-swipe-ignore>
          <button type="button">日历里的一天</button>
        </span>
      </SwipeRow>
      <button type="button">外面</button>
    </>
  );
}

/** The sliding surface (the children's parent) and the row root around it. */
const surface = () => screen.getByRole("button", { name: "勾掉" }).parentElement as HTMLElement;
const root = () => surface().parentElement as HTMLElement;
const deleteButton = () => document.querySelector<HTMLElement>("[data-swipe-delete]");

afterEach(() => {
  resetTrackpad();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SwipeRow at rest", () => {
  it("paints like a plain row: no side shown, no transform", () => {
    render(<Row />);
    expect(root().dataset.swiped).toBeUndefined();
    expect(surface().style.transform).toBe("");
    expect(deleteButton()).toBeNull();
  });

  it("a row with an action claims sideways swipes from the page switch; one without does not", () => {
    const { rerender } = render(<Row />);
    expect(root().dataset.swipeRow).toBe("true");
    rerender(<Row right={null} onDelete={null} />);
    expect(root().dataset.swipeRow).toBeUndefined();
  });
});

describe("SwipeRow keyboard delete (ui-spec §10.14)", () => {
  it("Delete on a control in the row opens 删除 and focuses it; Esc closes and gives focus back", () => {
    render(<Row />);
    const tick = screen.getByRole("button", { name: "勾掉" });
    tick.focus();
    fireEvent.keyDown(tick, { key: "Delete" });
    expect(root().dataset.swiped).toBe("true");
    expect(document.activeElement).toBe(deleteButton());
    expect(screen.getByRole("button", { name: "删除" })).toBe(deleteButton());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(tick);
    expect(surface().style.transform).toBe("");
  });

  it("Enter / click on the focused button deletes", () => {
    const onDelete = vi.fn();
    render(<Row onDelete={onDelete} />);
    const tick = screen.getByRole("button", { name: "勾掉" });
    tick.focus();
    fireEvent.keyDown(tick, { key: "Backspace" });
    fireEvent.click(deleteButton() as HTMLElement);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("a checkbox counts as the row; a text field, a popover part or no onDelete do not", () => {
    const { unmount } = render(<Row />);
    fireEvent.keyDown(screen.getByLabelText("文字"), { key: "Backspace" });
    expect(deleteButton()).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "日历里的一天" }), { key: "Delete" });
    expect(deleteButton()).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("选中"), { key: "Delete" });
    expect(deleteButton()).not.toBeNull();
    unmount();
    render(<Row onDelete={null} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "勾掉" }), { key: "Delete" });
    expect(deleteButton()).toBeNull();
  });

  it("the control focus came from is gone by Esc: the row's first control takes focus", () => {
    // Like a hover-only button: it goes away once focus leaves it for 删除.
    function Vanishing() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <EscRoot />
          <SwipeRow onDelete={() => undefined} deleteLabel="删除">
            <button type="button">勾掉</button>
            {shown && (
              <button type="button" onBlur={() => setShown(false)}>
                设提醒
              </button>
            )}
          </SwipeRow>
        </>
      );
    }
    render(<Vanishing />);
    const remind = screen.getByRole("button", { name: "设提醒" });
    remind.focus();
    fireEvent.keyDown(remind, { key: "Backspace" });
    expect(document.activeElement).toBe(deleteButton());
    expect(screen.queryByRole("button", { name: "设提醒" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "勾掉" }));
  });

  it("onSwipeStart runs as the row starts to slide; onFocusChange counts 删除 as in the row", () => {
    const onSwipeStart = vi.fn();
    const onFocusChange = vi.fn();
    render(<Row onSwipeStart={onSwipeStart} onFocusChange={onFocusChange} />);
    const tick = screen.getByRole("button", { name: "勾掉" });
    tick.focus();
    expect(onFocusChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(tick, { key: "Delete" });
    expect(onSwipeStart).toHaveBeenCalledOnce();
    expect(onFocusChange).not.toHaveBeenCalledWith(false);
    (screen.getByRole("button", { name: "外面" }) as HTMLElement).focus();
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
  });

  it("closeOpenSwipeRow closes the open row (an overlay or popover opening over it)", () => {
    render(<Row />);
    fireEvent.keyDown(screen.getByRole("button", { name: "勾掉" }), { key: "Delete" });
    expect(surface().style.transform).not.toBe("");
    act(() => closeOpenSwipeRow());
    expect(surface().style.transform).toBe("");
  });

  it("tabbing out of the open button closes the row", () => {
    render(<Row />);
    const tick = screen.getByRole("button", { name: "勾掉" });
    fireEvent.keyDown(tick, { key: "Delete" });
    fireEvent.blur(deleteButton() as HTMLElement, {
      relatedTarget: screen.getByRole("button", { name: "外面" }),
    });
    expect(surface().style.transform).toBe("");
  });
});

describe("SwipeRow trackpad (horizontal wheel)", () => {
  const wheel = (deltaX: number, deltaY: number) =>
    fireEvent.wheel(root(), { deltaX, deltaY, cancelable: true });

  it("a scroll that starts a little sideways stays a scroll: the axis waits for 6 px", () => {
    render(<Row />);
    expect(wheel(-1, 0)).toBe(true);
    expect(wheel(0, 8)).toBe(true);
    expect(wheel(-2, 12)).toBe(true);
    expect(surface().style.transform).toBe("");
    expect(root().dataset.swiped).toBeUndefined();
  });

  it("a swipe that starts a little vertically still swipes; quiet settles it", () => {
    vi.useFakeTimers();
    const onSwipeStart = vi.fn();
    render(<Row onSwipeStart={onSwipeStart} />);
    expect(wheel(0, 1)).toBe(true);
    expect(wheel(20, 1)).toBe(false);
    expect(onSwipeStart).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) wheel(20, 0);
    expect(surface().style.transform).toMatch(/translateX\(-/);
    act(() => vi.advanceTimersByTime(SWIPE_IDLE_MS + 10));
    // Past half the button: 删除 stays open.
    expect(deleteButton()?.getAttribute("tabindex")).toBe("0");
  });

  it("with the fingers reported down it never settles; the lift settles at once, momentum after it is swallowed", () => {
    vi.useFakeTimers();
    render(<Row />);
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 4; i++) wheel(20, 0);
    act(() => vi.advanceTimersByTime(SWIPE_IDLE_MS * 4));
    expect(deleteButton()?.getAttribute("tabindex")).toBe("-1");
    act(() => setTrackpadTouching(false));
    expect(deleteButton()?.getAttribute("tabindex")).toBe("0");
    const open = surface().style.transform;
    expect(wheel(12, 0)).toBe(false);
    expect(wheel(8, 0)).toBe(false);
    expect(surface().style.transform).toBe(open);
  });

  it("a swipe right on an open row stops at rest; 完成 takes a swipe of its own after the lift", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<Row right={{ label: "完成", icon: null, tone: "st", run }} />);
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 4; i++) wheel(20, 0);
    act(() => setTrackpadTouching(false));
    expect(deleteButton()?.getAttribute("tabindex")).toBe("0");
    // Fingers back, a big swipe right: the row closes and stops there.
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 12; i++) wheel(-40, 0);
    expect(surface().style.transform).toBe("");
    // No travel piled up past rest: back left moves at once.
    wheel(10, 0);
    expect(surface().style.transform).toBe("translateX(-10px)");
    wheel(-10, 0);
    act(() => setTrackpadTouching(false));
    expect(run).not.toHaveBeenCalled();
    expect(deleteButton()?.getAttribute("tabindex")).toBe("-1");
    // Lifted, a new swipe right ticks.
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 4; i++) wheel(-40, 0);
    act(() => setTrackpadTouching(false));
    expect(run).toHaveBeenCalledOnce();
  });

  it("one gesture works one side: back from 删除 under the fingers it stops at rest, and the other way round", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<Row overlay right={{ label: "完成", icon: null, tone: "st", run }} />);
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 6; i++) wheel(20, 0);
    expect(deleteButton()).not.toBeNull();
    for (let i = 0; i < 15; i++) wheel(-40, 0);
    expect(screen.queryByText("完成")).toBeNull();
    act(() => setTrackpadTouching(false));
    expect(run).not.toHaveBeenCalled();
    expect(deleteButton()?.getAttribute("tabindex")).toBe("-1");
    // Started right: back left stops at rest too, 删除 stays shut.
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 2; i++) wheel(-40, 0);
    expect(screen.queryByText("完成")).not.toBeNull();
    for (let i = 0; i < 10; i++) wheel(40, 0);
    expect(deleteButton()).toBeNull();
    act(() => setTrackpadTouching(false));
    expect(run).not.toHaveBeenCalled();
  });

  it("overlay rows (the detail timeline) too: closing stops at rest, 完成 never slides in", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<Row overlay right={{ label: "完成", icon: null, tone: "st", run }} />);
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 4; i++) wheel(20, 0);
    act(() => setTrackpadTouching(false));
    expect(deleteButton()?.getAttribute("tabindex")).toBe("0");
    act(() => setTrackpadTouching(true));
    for (let i = 0; i < 12; i++) wheel(-40, 0);
    expect(screen.queryByText("完成")).toBeNull();
    act(() => setTrackpadTouching(false));
    expect(run).not.toHaveBeenCalled();
    expect(deleteButton()?.getAttribute("tabindex")).toBe("-1");
  });

  it("past the threshold the row gives way: a long pull never stretches the strip much", () => {
    render(<Row />);
    for (let i = 0; i < 12; i++) wheel(-40, 0);
    const x = Number(surface().style.transform.match(/translateX\((.+)px\)/)?.[1]);
    expect(x).toBeGreaterThan(72);
    expect(x).toBeLessThan(72 + 20);
  });
});

describe("SwipeRow pointer drag", () => {
  const press = (x: number) =>
    fireEvent.pointerDown(screen.getByRole("button", { name: "勾掉" }), {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: 0,
    });
  const move = (x: number) =>
    fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: 0 });
  const up = (x: number) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: 0 });

  it("a drag that showed 删除 stops at rest on the way back and never ticks", () => {
    const run = vi.fn();
    render(<Row right={{ label: "完成", icon: null, tone: "st", run }} />);
    press(300);
    move(290);
    move(220);
    expect(surface().style.transform).toBe("translateX(-80px)");
    move(600);
    expect(surface().style.transform).toBe("");
    move(590);
    expect(surface().style.transform).toBe("translateX(-10px)");
    move(700);
    up(700);
    expect(run).not.toHaveBeenCalled();
  });

  it("dragging an open row right stops at rest and never ticks; a new drag does", () => {
    const run = vi.fn();
    render(<Row right={{ label: "完成", icon: null, tone: "st", run }} />);
    press(300);
    move(250);
    move(200);
    up(200);
    expect(surface().style.transform).toBe("translateX(-88px)");
    press(200);
    move(220);
    move(500);
    expect(surface().style.transform).toBe("");
    move(490);
    expect(surface().style.transform).toBe("translateX(-10px)");
    up(600);
    expect(run).not.toHaveBeenCalled();
    press(200);
    move(220);
    move(300);
    up(300);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("SwipeRow action layers", () => {
  const layer = () => deleteButton()?.parentElement as HTMLElement;

  it("a sliding row clips 删除 to the uncovered strip (plus a little under the surface)", () => {
    render(<Row />);
    const tick = screen.getByRole("button", { name: "勾掉" });
    tick.focus();
    fireEvent.keyDown(tick, { key: "Delete" });
    expect(surface().style.transform).toBe("translateX(-88px)");
    // Never the whole row: a full-width red under the surface leaks at the far rounded corners.
    expect(layer().style.clipPath).toBe("inset(0 0 0 calc(100% - 100px))");
  });

  it("overlay: the row stays put and 删除 slides in over its end as a rounded strip", () => {
    render(<Row overlay />);
    const tick = screen.getByRole("button", { name: "勾掉" });
    tick.focus();
    fireEvent.keyDown(tick, { key: "Delete" });
    expect(root().dataset.swiped).toBe("true");
    expect(surface().style.transform).toBe("");
    expect(layer().style.clipPath).toBe(
      "inset(0 0 0 calc(100% - 88px) round var(--swipe-overlay-radius, 0px))",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(layer().style.clipPath).toBe(
      "inset(0 0 0 calc(100% - 0px) round var(--swipe-overlay-radius, 0px))",
    );
  });
});

describe("SwipeRow hint peek", () => {
  it("slides left (删除 shows), back, right (the tick shows), back, then rests", () => {
    vi.useFakeTimers();
    render(<Row hint />);
    expect(root().dataset.swiped).toBeUndefined();
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
    expect(surface().style.transform).toBe(`translateX(${-PEEK_PX}px)`);
    expect(root().dataset.swiped).toBe("true");
    expect(deleteButton()).not.toBeNull();
    act(() => vi.advanceTimersByTime(PEEK_STEP_MS));
    expect(surface().style.transform).toBe("");
    act(() => vi.advanceTimersByTime(PEEK_STEP_MS));
    expect(surface().style.transform).toBe(`translateX(${PEEK_PX}px)`);
    expect(deleteButton()).toBeNull();
    expect(root().textContent).toContain("完成");
    act(() => vi.advanceTimersByTime(PEEK_STEP_MS));
    expect(surface().style.transform).toBe("");
    act(() => vi.advanceTimersByTime(PEEK_STEP_MS));
    expect(root().dataset.swiped).toBeUndefined();
  });

  it("a row with only one action peeks that side only", () => {
    vi.useFakeTimers();
    render(<Row onDelete={null} hint />);
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
    expect(surface().style.transform).toBe(`translateX(${PEEK_PX}px)`);
    act(() => vi.advanceTimersByTime(2 * PEEK_STEP_MS));
    expect(root().dataset.swiped).toBeUndefined();
  });

  it("turned off before it finished: the row springs back", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Row hint />);
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
    expect(surface().style.transform).toBe(`translateX(${-PEEK_PX}px)`);
    rerender(<Row hint={false} />);
    expect(surface().style.transform).toBe("");
    act(() => vi.advanceTimersByTime(4 * PEEK_STEP_MS));
    expect(surface().style.transform).toBe("");
    expect(root().dataset.swiped).toBeUndefined();
  });

  it("a press stops it; reduced motion skips it", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Row hint />);
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS));
    fireEvent.pointerDown(screen.getByRole("button", { name: "勾掉" }), {
      pointerId: 1,
      isPrimary: true,
      button: 0,
    });
    expect(surface().style.transform).toBe("");
    act(() => vi.advanceTimersByTime(4 * PEEK_STEP_MS));
    expect(surface().style.transform).toBe("");
    expect(root().dataset.swiped).toBeUndefined();
    unmount();

    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    render(<Row hint />);
    act(() => vi.advanceTimersByTime(PEEK_DELAY_MS + PEEK_STEP_MS));
    expect(root().dataset.swiped).toBeUndefined();
    expect(surface().style.transform).toBe("");
  });
});
