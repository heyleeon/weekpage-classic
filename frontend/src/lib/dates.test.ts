import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n";
import {
  addDays,
  calendarTitle,
  diffDays,
  formatMD,
  formatMDW,
  homeAnchor,
  homeDirection,
  isoFromDate,
  isoFromParts,
  mondayOf,
  monthDayLabel,
  monthName,
  monthShortName,
  todayTitle,
  visibleRange,
  weekdayNames,
  weekdayNarrowNames,
  weekdayShort,
} from "./dates";

describe("dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("diffDays is b − a", () => {
    expect(diffDays("2026-09-30", "2026-09-30")).toBe(0);
    expect(diffDays("2026-09-29", "2026-10-02")).toBe(3);
    expect(diffDays("2026-10-31", "2026-09-20")).toBe(-41);
    // across a DST change in many zones
    expect(diffDays("2026-03-01", "2026-04-01")).toBe(31);
  });

  it.each([
    ["2026-09-28", "周一"],
    ["2026-09-29", "周二"],
    ["2026-09-30", "周三"],
    ["2026-10-05", "周一"],
    ["2026-10-09", "周五"],
    ["2026-10-31", "周六"],
    ["2026-10-04", "周日"],
  ])("weekday of %s is %s", (d, w) => {
    expect(weekdayShort(d)).toBe(w);
  });

  it("formats M/D without padding", () => {
    expect(formatMD("2026-10-09")).toBe("10/9");
    expect(formatMDW("2026-10-09")).toBe("10/9 周五");
    expect(formatMDW("2026-09-28")).toBe("9/28 周一");
  });

  it("mondayOf returns the Monday of the week", () => {
    expect(mondayOf("2026-09-30")).toBe("2026-09-28");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
  });

  it("isoFromParts validates", () => {
    expect(isoFromParts(2026, 10, 9)).toBe("2026-10-09");
    expect(isoFromParts(2026, 2, 30)).toBeNull();
    expect(isoFromParts(2026, 13, 1)).toBeNull();
    expect(isoFromParts(2026, 0, 1)).toBeNull();
    expect(isoFromParts(2026.5, 1, 1)).toBeNull();
  });

  it("visibleRange spans whole weeks from the anchor", () => {
    const r = visibleRange("2026-09-28", 3);
    expect(r.from).toBe("2026-09-28");
    expect(r.to).toBe("2026-10-18");
    expect(r.days).toHaveLength(21);
    expect(visibleRange("2026-09-28", 2).to).toBe("2026-10-11");
    expect(visibleRange("2026-09-28", 4).days).toHaveLength(28);
  });

  it("calendarTitle uses the first visible day", () => {
    expect(calendarTitle("2026-09-28")).toEqual({ main: "9月", sub: "2026" });
    expect(calendarTitle("2026-12-28")).toEqual({ main: "12月", sub: "2026" });
  });

  it("todayTitle", () => {
    expect(todayTitle("2026-09-30")).toEqual({ main: "9月30日", sub: "周三" });
  });

  it("isoFromDate uses local time", () => {
    expect(isoFromDate(new Date(2026, 8, 30, 23, 59))).toBe("2026-09-30");
  });

  it("weekday rows and month words (zh-Hans)", () => {
    expect(weekdayNames()).toEqual(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);
    expect(weekdayNarrowNames()).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
    expect(monthName(9)).toBe("9月");
    expect(monthShortName(12)).toBe("12月");
    expect(monthDayLabel("2026-10-01")).toBe("10月1日");
  });
});

describe("dates · English text", () => {
  afterEach(() => {
    void i18n.changeLanguage("zh-Hans");
  });

  it("switches every text helper to English", () => {
    void i18n.changeLanguage("en");
    expect(weekdayShort("2026-09-30")).toBe("Wed");
    expect(weekdayNames()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayNarrowNames()).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(monthName(9)).toBe("September");
    expect(monthShortName(9)).toBe("Sep");
    expect(monthDayLabel("2026-10-01")).toBe("Oct 1");
    expect(formatMD("2026-10-09")).toBe("10/9");
    expect(formatMDW("2026-10-09")).toBe("10/9 Fri");
    expect(calendarTitle("2026-09-28")).toEqual({ main: "September", sub: "2026" });
    expect(todayTitle("2026-09-30")).toEqual({ main: "Sep 30", sub: "Wed" });
  });

  it("switching back restores the Chinese copy", () => {
    void i18n.changeLanguage("en");
    void i18n.changeLanguage("zh-Hans");
    expect(todayTitle("2026-09-30")).toEqual({ main: "9月30日", sub: "周三" });
  });
});

describe("dates · calendar home", () => {
  it("homeAnchor: this week's Monday, or the one before for lastWeek", () => {
    expect(homeAnchor("2026-09-30", "thisWeek")).toBe("2026-09-28");
    expect(homeAnchor("2026-09-30", "lastWeek")).toBe("2026-09-21");
    expect(homeAnchor("2026-10-04", "thisWeek")).toBe("2026-09-28"); // Sunday
    expect(homeAnchor("2026-10-05", "lastWeek")).toBe("2026-09-28"); // Monday
    expect(homeAnchor("2027-01-01", "lastWeek")).toBe("2026-12-21");
  });

  it("homeDirection points from the view to home", () => {
    const home = "2026-09-28";
    expect(homeDirection("2026-09-28", home)).toBeNull();
    expect(homeDirection("2026-09-21", home)).toBe("down");
    expect(homeDirection("2026-08-03", home)).toBe("down");
    expect(homeDirection("2026-10-05", home)).toBe("up");
    // A non-Monday anchor is compared by its week.
    expect(homeDirection("2026-09-30", home)).toBeNull();
  });
});
