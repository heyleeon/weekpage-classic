// Generic components in English (the Chinese copy is covered by ui.test.tsx).
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "@/i18n";
import { MiniCalendar } from "./MiniCalendar";
import { Modal } from "./Modal";

beforeEach(() => {
  act(() => setLang("en"));
});

describe("Modal (en)", () => {
  it("names the close button in English", async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose} width="narrow">
        <p>body</p>
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("MiniCalendar (en)", () => {
  it("English weekday heads, month names and pager labels with plurals", async () => {
    const { container } = render(
      <MiniCalendar today="2026-09-30" value={null} onPick={() => undefined} />,
    );
    const heads = Array.from(container.querySelectorAll("[aria-hidden='true']"))
      .map((el) => el.textContent)
      .filter((s) => s && s.length === 1);
    expect(heads).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    // Sep 28 – Oct 18 spans two months.
    expect(screen.getByText("Sep – Oct")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous 3 weeks" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next 3 weeks" }));
    // Oct 19 – Nov 8.
    expect(screen.getByText("Oct – Nov")).toBeTruthy();
  });

  it("a single month reads in full; one week pages say “week”", () => {
    render(<MiniCalendar today="2026-10-05" weeks={1} value={null} onPick={() => undefined} />);
    expect(screen.getByText("October")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next week" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy();
  });
});
