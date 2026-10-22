import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { KeyPointMarker, MARKER_LABEL, markerLabel } from "./KeyPointMarker";

describe("KeyPointMarker i18n (tasks.marker.*)", () => {
  it("zh-Hans accessible names (ui-spec §9)", () => {
    expect([MARKER_LABEL.done, MARKER_LABEL.idle, MARKER_LABEL.noteThem]).toEqual([
      "已完成",
      "没开始",
      "对方",
    ]);
    render(<KeyPointMarker kind="wait" />);
    expect(screen.getByRole("img", { name: "等别人" })).toBeTruthy();
  });

  it("follows the active language; an explicit label wins", () => {
    setLang("en");
    expect(markerLabel("check")).toBe("Checkpoint");
    expect(MARKER_LABEL.noteMe).toBe("Me");
    render(
      <>
        <KeyPointMarker kind="overdue" />
        <KeyPointMarker kind="idle" onClick={() => undefined} label="Check off draft" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Overdue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check off draft" })).toBeTruthy();
  });
});
