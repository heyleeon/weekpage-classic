import { afterEach, describe, expect, it } from "vitest";
import {
  clockOffset,
  dateStrAt,
  initClockFromUrl,
  isValidTimezone,
  nowMs,
  parseLocal,
  setClockOffset,
  setTimezone,
  todayStr,
  wallTime,
} from "./clock";

afterEach(() => {
  setClockOffset(0);
  setTimezone("system");
});

describe("clock", () => {
  it("parses local date-times", () => {
    expect(parseLocal("2026-09-30T10:00")).toBe(new Date(2026, 8, 30, 10, 0).getTime());
    expect(parseLocal("2026-02-30T10:00")).toBeNull();
    expect(parseLocal("2026-09-30 10:00")).toBeNull();
  });

  it("?now= sets the offset and today", () => {
    expect(initClockFromUrl("?now=2026-09-30T10:00")).toBe(true);
    expect(todayStr()).toBe("2026-09-30");
    expect(Math.abs(nowMs() - new Date(2026, 8, 30, 10, 0).getTime())).toBeLessThan(5_000);
  });

  it("ignores missing or bad ?now=", () => {
    expect(initClockFromUrl("")).toBe(false);
    expect(initClockFromUrl("?now=soon")).toBe(false);
    expect(clockOffset()).toBe(0);
  });

  it("the date follows the chosen zone, not the OS", () => {
    const instant = Date.UTC(2026, 8, 30, 20, 0); // 2026-09-30 20:00 UTC
    setTimezone("Asia/Tokyo");
    expect(dateStrAt(instant)).toBe("2026-10-01"); // 05:00 next day
    expect(wallTime(instant)).toEqual({ y: 2026, mo: 10, d: 1, h: 5, mi: 0 });
    setTimezone("America/Los_Angeles");
    expect(dateStrAt(instant)).toBe("2026-09-30"); // 13:00 (PDT)
    expect(wallTime(instant).h).toBe(13);
  });

  it("midnight is 0, not 24, and parseLocal reads wall time in the zone", () => {
    setTimezone("Asia/Tokyo");
    const ms = parseLocal("2026-10-01T00:30");
    expect(ms).toBe(Date.UTC(2026, 8, 30, 15, 30));
    expect(wallTime(ms ?? 0).h).toBe(0);
  });

  it("an unknown zone falls back to the system", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    setTimezone("Mars/Olympus");
    const now = Date.now();
    expect(wallTime(now).d).toBe(new Date(now).getDate());
    expect(wallTime(now).h).toBe(new Date(now).getHours());
  });
});
