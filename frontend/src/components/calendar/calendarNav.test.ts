import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDataStore } from "@/hooks/useDataStore";
import { handleShown } from "@/hooks/useShellEvents";
import { useUiStore } from "@/hooks/useUiStore";
import { homeAnchor } from "@/lib/dates";
import { mockApi, resetMockBackend } from "@/lib/mockBackend";
import type { Settings } from "@/types/domain";
import { backToToday, shiftWeek, useHomeDirection } from "./calendarNav";

const initialUi = useUiStore.getState();
const initialData = useDataStore.getState();

beforeEach(() => {
  resetMockBackend();
  vi.restoreAllMocks();
  useUiStore.setState(
    {
      ...initialUi,
      today: "2026-09-30",
      calendarAnchor: "2026-09-28",
      calendarFirstRow: "thisWeek",
      page: "calendar",
    },
    true,
  );
  useDataStore.setState(initialData, true);
});

const anchor = () => useUiStore.getState().calendarAnchor;

describe("calendarNav", () => {
  it("shiftWeek moves by whole weeks in both directions", () => {
    shiftWeek(1);
    expect(anchor()).toBe("2026-10-05");
    shiftWeek(-3);
    expect(anchor()).toBe("2026-09-14");
    shiftWeek(0);
    expect(anchor()).toBe("2026-09-14");
    shiftWeek(2.7);
    expect(anchor()).toBe("2026-09-28");
  });

  it("backToToday goes to this week, or last week when the setting says so", () => {
    shiftWeek(5);
    backToToday();
    expect(anchor()).toBe("2026-09-28");
    useUiStore.setState({ calendarFirstRow: "lastWeek" });
    shiftWeek(-4);
    backToToday();
    expect(anchor()).toBe("2026-09-21");
  });

  it("useHomeDirection: null at home, up / down towards home", () => {
    const { result } = renderHook(() => useHomeDirection());
    expect(result.current).toBeNull();
    act(() => shiftWeek(2));
    expect(result.current).toBe("up");
    act(() => shiftWeek(-3));
    expect(result.current).toBe("down");
    act(() => backToToday());
    expect(result.current).toBeNull();
    // With lastWeek, this week's Monday is one week past home.
    act(() => useUiStore.setState({ calendarFirstRow: "lastWeek" }));
    expect(result.current).toBe("up");
  });
});

describe("useUiStore · calendarFirstRow", () => {
  it("setCalendarFirstRow saves the setting and moves the view to the new home", async () => {
    const save = vi.spyOn(mockApi, "updateSettings");
    await useDataStore.getState().refresh();
    shiftWeek(3);
    useUiStore.getState().setCalendarFirstRow("lastWeek");
    expect(useUiStore.getState().calendarFirstRow).toBe("lastWeek");
    expect(anchor()).toBe("2026-09-21");
    expect(save).toHaveBeenCalledWith({ calendarFirstRow: "lastWeek" });
    await act(async () => undefined);
    expect(useDataStore.getState().snap?.settings.calendarFirstRow).toBe("lastWeek");
    save.mockClear();
    useUiStore.getState().setCalendarFirstRow("lastWeek");
    expect(save).not.toHaveBeenCalled();
  });

  it("hydrateFromSettings mirrors calendarFirstRow (unknown values → thisWeek)", () => {
    const settings = { calendarWeeks: 4, lastPage: "tasks", calendarFirstRow: "lastWeek" };
    useUiStore.getState().hydrateFromSettings(settings as Settings);
    expect(useUiStore.getState().calendarFirstRow).toBe("lastWeek");
    expect(useUiStore.getState().calendarWeeks).toBe(4);
    useUiStore
      .getState()
      .hydrateFromSettings({ ...settings, calendarFirstRow: "nextWeek" } as unknown as Settings);
    expect(useUiStore.getState().calendarFirstRow).toBe("thisWeek");
  });

  it("a new day keeps a calendar at home at the new home, but not one browsed away", () => {
    useUiStore.getState().setToday("2026-10-05");
    expect(anchor()).toBe("2026-10-05");
    shiftWeek(-2);
    useUiStore.getState().setToday("2026-10-12");
    expect(anchor()).toBe("2026-09-21");

    useUiStore.setState({
      today: "2026-10-04",
      calendarFirstRow: "lastWeek",
      calendarAnchor: "2026-09-21",
    });
    useUiStore.getState().setToday("2026-10-05");
    expect(anchor()).toBe("2026-09-28");
  });

  it("window show resets the view to home with the setting", () => {
    useUiStore.setState({ calendarFirstRow: "lastWeek", calendarAnchor: "2026-11-02" });
    handleShown();
    const ui = useUiStore.getState();
    // recomputeToday reads the clock; home is relative to whatever today is.
    expect(ui.calendarAnchor).toBe(homeAnchor(ui.today, "lastWeek"));
  });
});
