import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { DisplayStatus } from "@/types/domain";
import { STATUS_LABEL, StatusTag, statusLabel } from "./StatusTag";

describe("StatusTag i18n (tasks.status.*)", () => {
  it("zh-Hans names are the spec copy (ui-spec §8.3)", () => {
    const all: DisplayStatus[] = ["active", "waiting", "upcoming", "overdue", "done"];
    expect(all.map((s) => STATUS_LABEL[s])).toEqual([
      "推进中",
      "等待中",
      "未开始",
      "逾期",
      "已完成",
    ]);
    render(<StatusTag status="overdue" onClick={() => undefined} />);
    expect(screen.getByRole("button", { name: "逾期" }).getAttribute("aria-haspopup")).toBe("menu");
  });

  it("follows the active language, including the STATUS_LABEL record", () => {
    setLang("en");
    expect(statusLabel("active")).toBe("Active");
    expect(STATUS_LABEL.waiting).toBe("Waiting");
    expect(STATUS_LABEL.upcoming).toBe("Upcoming");
    render(<StatusTag status="done" />);
    expect(screen.getByText("Done")).toBeTruthy();
    setLang("zh-Hans");
    expect(STATUS_LABEL.waiting).toBe("等待中");
  });
});
