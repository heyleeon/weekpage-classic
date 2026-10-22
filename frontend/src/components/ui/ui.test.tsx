import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Capsule, CapsuleSegment } from "./Capsule";
import { Checkbox } from "./Checkbox";
import { Chip } from "./Chip";
import { IconButton } from "./IconButton";
import { KeyPointMarker } from "./KeyPointMarker";
import { KindBadge, nextKind } from "./KindBadge";
import { Menu } from "./Menu";
import { MiniCalendar } from "./MiniCalendar";
import { Modal } from "./Modal";
import { Popover } from "./Popover";
import { ScrollFade } from "./ScrollFade";
import { StatusTag } from "./StatusTag";
import { TIP_DELAY_MS, Tip } from "./Tip";
import { Toggle } from "./Toggle";

describe("Capsule", () => {
  it("renders a labelled group with pressed state, hint and count", async () => {
    const onClick = vi.fn();
    render(
      <Capsule label="页面">
        <CapsuleSegment selected hint="⌘1">
          日历
        </CapsuleSegment>
        <CapsuleSegment count={7} onClick={onClick}>
          待办
        </CapsuleSegment>
      </Capsule>,
    );
    expect(screen.getByRole("group", { name: "页面" })).toBeTruthy();
    const cal = screen.getByRole("button", { name: /日历/ });
    expect(cal.getAttribute("aria-pressed")).toBe("true");
    expect(cal.textContent).toBe("日历⌘1");
    const todo = screen.getByRole("button", { name: /待办/ });
    expect(todo.textContent).toBe("待办7");
    await userEvent.click(todo);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Button / IconButton", () => {
  it("Button fires onClick and respects disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>确定</Button>);
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <Button onClick={onClick} disabled variant="accent">
        确定
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("IconButton has an accessible name", () => {
    render(<IconButton label="关闭" icon={<span>×</span>} />);
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });
});

describe("Chip", () => {
  it("is static text or a button", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Chip tone="rm">今天 18:00</Chip>);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <Chip tone="rm" onClick={onClick}>
        今天 18:00
      </Chip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "今天 18:00" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Toggle / Checkbox", () => {
  it("Toggle is a switch that reports the next value", async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="失焦时自动隐藏" />);
    const sw = screen.getByRole("switch", { name: "失焦时自动隐藏" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Checkbox is a native checkbox", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="回复房东" />);
    await userEvent.click(screen.getByRole("checkbox", { name: "回复房东" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("StatusTag", () => {
  it.each([
    ["active", "推进中"],
    ["waiting", "等待中"],
    ["upcoming", "未开始"],
    ["overdue", "逾期"],
    ["done", "已完成"],
  ] as const)("%s → %s", (status, text) => {
    render(<StatusTag status={status} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("is a menu button when clickable", async () => {
    const onClick = vi.fn();
    render(<StatusTag status="waiting" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "等待中" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("KeyPointMarker / KindBadge", () => {
  it("markers have names; clickable ones are buttons", async () => {
    const onClick = vi.fn();
    render(
      <>
        <KeyPointMarker kind="check" />
        <KeyPointMarker kind="idle" onClick={onClick} label="勾掉 做 10 页初稿" />
        <KeyPointMarker kind="noteThem" size={16} />
      </>,
    );
    expect(screen.getByRole("img", { name: "检查点" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "对方" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "勾掉 做 10 页初稿" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("KindBadge shows the kind and the date; the cycle is do → wait → check", () => {
    render(<KindBadge kind="wait" date="2026-10-01" />);
    expect(screen.getByText("等别人 · 10/1")).toBeTruthy();
    expect(nextKind("do")).toBe("wait");
    expect(nextKind("wait")).toBe("check");
    expect(nextKind("check")).toBe("do");
  });
});

describe("Modal", () => {
  it("is a labelled dialog, focuses inside and closes", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="设置" onClose={onClose} width="narrow">
        <input aria-label="name" />
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "设置" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("name"));
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps Tab inside the panel", () => {
    render(
      <Modal title="t" onClose={() => undefined}>
        <input aria-label="a" />
      </Modal>,
    );
    const close = screen.getByRole("button", { name: "关闭" });
    const input = screen.getByLabelText("a");
    input.focus();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(input);
  });
});

describe("Popover / Menu", () => {
  it("Popover is a labelled dialog with width", () => {
    render(
      <Popover label="选日期" width={280}>
        x
      </Popover>,
    );
    expect(screen.getByRole("dialog", { name: "选日期" }).style.width).toBe("280px");
  });

  it("Menu selects items and moves with arrows", async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <Menu
        label="状态"
        autoFocus
        items={[
          { key: "a", label: "推进中", onSelect: first, checked: true },
          { key: "b", label: "等待中", onSelect: second, checked: false },
        ]}
      />,
    );
    const items = screen.getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    await userEvent.click(items[1]);
    expect(second).toHaveBeenCalledOnce();
  });
});

describe("MiniCalendar", () => {
  it("shows 3 weeks from Monday, disables the past and picks a day", async () => {
    const onPick = vi.fn();
    render(<MiniCalendar today="2026-09-30" value="2026-10-09" onPick={onPick} />);
    const days = screen.getAllByRole("button").filter((b) => b.dataset.date);
    expect(days).toHaveLength(21);
    expect(days[0].dataset.date).toBe("2026-09-28");
    expect((days[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("10/1")).toBeTruthy();
    const picked = screen.getByRole("button", { name: "2026-10-09" });
    expect(picked.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "2026-10-05" }));
    expect(onPick).toHaveBeenCalledWith("2026-10-05");
    await userEvent.click(days[0]);
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("allowPast: past days and earlier pages can be picked", async () => {
    const onPick = vi.fn();
    render(<MiniCalendar today="2026-09-30" onPick={onPick} allowPast />);
    const past = screen.getByRole("button", { name: "2026-09-28" }) as HTMLButtonElement;
    expect(past.disabled).toBe(false);
    await userEvent.click(past);
    expect(onPick).toHaveBeenCalledWith("2026-09-28");
    await userEvent.click(screen.getByRole("button", { name: "往前 3 周" }));
    await userEvent.click(screen.getByRole("button", { name: "2026-09-07" }));
    expect(onPick).toHaveBeenLastCalledWith("2026-09-07");
  });

  it("pages by 3 weeks and marks a range", async () => {
    render(
      <MiniCalendar
        today="2026-09-30"
        mode="range"
        shape="cell"
        color="st"
        range={{ start: "2026-10-19", end: "2026-10-22" }}
        onPick={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "2026-10-19" })).toBeNull();
    expect(screen.getByRole("button", { name: "往前 3 周" })).toBeTruthy();
    expect(screen.getByText("9月 – 10月")).toBeTruthy();
    expect(screen.getByText("一")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "往后 3 周" }));
    expect(screen.getByRole("button", { name: "2026-10-19" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "2026-10-20" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});

describe("ScrollFade", () => {
  it("renders its content in a scroller", () => {
    render(
      <ScrollFade surface="elevated" maxHeight={120}>
        <p>row</p>
      </ScrollFade>,
    );
    expect(screen.getByText("row")).toBeTruthy();
  });
});

describe("Tip", () => {
  it("shows its words after a short rest, hides on leave and on a press", () => {
    vi.useFakeTimers();
    try {
      render(
        <Tip text={"今天 · 第 2 / 4 天\n还剩 2 天"}>
          <button type="button">bar</button>
        </Tip>,
      );
      const trigger = screen.getByRole("button", { name: "bar" });
      fireEvent.pointerOver(trigger);
      expect(screen.queryByTestId("tip")).toBeNull();
      act(() => vi.advanceTimersByTime(TIP_DELAY_MS));
      expect(screen.getByTestId("tip").textContent).toBe("今天 · 第 2 / 4 天\n还剩 2 天");
      expect(screen.getByTestId("tip").getAttribute("aria-hidden")).toBe("true");
      fireEvent.pointerOut(trigger);
      expect(screen.queryByTestId("tip")).toBeNull();
      // A pass that does not rest never shows it; a press hides it.
      fireEvent.pointerOver(trigger);
      fireEvent.pointerOut(trigger);
      act(() => vi.advanceTimersByTime(TIP_DELAY_MS));
      expect(screen.queryByTestId("tip")).toBeNull();
      fireEvent.focus(trigger);
      act(() => vi.advanceTimersByTime(TIP_DELAY_MS));
      expect(screen.getByTestId("tip")).toBeTruthy();
      fireEvent.pointerDown(window);
      expect(screen.queryByTestId("tip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
