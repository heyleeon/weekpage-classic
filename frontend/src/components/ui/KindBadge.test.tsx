import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { KIND_LABEL, KindBadge, kindLabel } from "./KindBadge";

describe("KindBadge i18n (tasks.kind.*)", () => {
  it("zh-Hans names and the date suffix (ui-spec §8.7)", () => {
    expect([KIND_LABEL.do, KIND_LABEL.wait, KIND_LABEL.check]).toEqual([
      "我来做",
      "等别人",
      "检查点",
    ]);
    render(<KindBadge kind="check" date="2026-10-01" onClick={() => undefined} />);
    const badge = screen.getByRole("button", { name: /检查点 · 10\/1/ });
    expect(badge.getAttribute("title")).toBe("点一下换类型");
  });

  it("follows the active language", () => {
    setLang("en");
    expect(kindLabel("do")).toBe("My move");
    expect(KIND_LABEL.wait).toBe("Waiting on");
    render(<KindBadge kind="check" date="2026-10-01" onClick={() => undefined} />);
    const badge = screen.getByRole("button", { name: /Checkpoint · 10\/1/ });
    expect(badge.getAttribute("title")).toBe("Click to change the type");
  });
});
