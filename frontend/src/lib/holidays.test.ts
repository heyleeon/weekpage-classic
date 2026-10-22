import { getSolarTerms } from "chinese-days";
import upstream from "chinese-days/dist/chinese-days.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "@/i18n";
import { nowMs } from "./clock";
import {
  dayLabel,
  HOLIDAYS_CACHE_KEY,
  HOLIDAYS_URL,
  type HolidayData,
  initHolidays,
  mergeData,
  pendingHolidayRefresh,
  resetHolidays,
  validateData,
} from "./holidays";
import bundled from "./holidays-data/chinese-days.json";
import { mockApi, resetMockBackend } from "./mockBackend";

const WEEK = 7 * 86_400_000;

beforeEach(async () => {
  await resetHolidays();
  resetMockBackend();
});

afterEach(async () => {
  await resetHolidays();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dayLabel · ui-spec §2.4 (2026)", () => {
  it.each<[string, string | null, string | null]>([
    ["2026-09-20", "补班", "workday"],
    ["2026-09-23", "秋分", "term"],
    ["2026-09-25", "中秋节", "holiday"],
    ["2026-09-26", "中秋 · 2", "holiday"],
    ["2026-09-27", "中秋 · 3", "holiday"],
    ["2026-10-01", "国庆节", "holiday"],
    ["2026-10-02", "国庆 · 2", "holiday"],
    ["2026-10-03", "国庆 · 3", "holiday"],
    ["2026-10-04", "国庆 · 4", "holiday"],
    ["2026-10-05", "国庆 · 5", "holiday"],
    ["2026-10-06", "国庆 · 6", "holiday"],
    ["2026-10-07", "国庆 · 7", "holiday"],
    ["2026-10-08", "寒露", "term"],
    ["2026-10-10", "补班", "workday"],
    ["2026-10-23", "霜降", "term"],
    ["2026-09-30", null, null],
    ["2026-10-09", null, null],
    // 七夕 2026-08-19, 圣诞: not shown.
    ["2026-08-19", null, null],
    ["2026-12-25", null, null],
  ])("%s → %s", (date, text, kind) => {
    expect(dayLabel(date)).toEqual(text === null ? null : { text, kind });
  });

  it("other breaks: full name on day 1, short name after", () => {
    expect(dayLabel("2026-02-15")).toEqual({ text: "春节", kind: "holiday" });
    expect(dayLabel("2026-02-23")).toEqual({ text: "春节 · 9", kind: "holiday" });
    expect(dayLabel("2026-01-01")?.text).toBe("元旦");
    expect(dayLabel("2026-01-02")?.text).toBe("元旦 · 2");
    expect(dayLabel("2025-05-01")?.text).toBe("劳动节");
    expect(dayLabel("2025-05-02")?.text).toBe("五一 · 2");
  });

  it("2025: 中秋 inside 国庆 gets its full name; holiday + term joined, holiday first", () => {
    expect(dayLabel("2025-10-05")?.text).toBe("国庆 · 5");
    expect(dayLabel("2025-10-06")).toEqual({ text: "中秋节", kind: "holiday" });
    expect(dayLabel("2025-10-07")?.text).toBe("国庆 · 7");
    expect(dayLabel("2025-10-08")).toEqual({ text: "国庆 · 8 · 寒露", kind: "holiday" });
    expect(dayLabel("2025-09-28")).toEqual({ text: "补班", kind: "workday" });
  });

  it("years without holiday data still get solar terms", () => {
    expect(dayLabel("2027-10-08")).toEqual({ text: "寒露", kind: "term" });
    expect(dayLabel("2027-10-01")).toBeNull();
  });
});

describe("dayLabel · English (i18n holidays section)", () => {
  beforeEach(() => setLang("en"));

  it.each<[string, string | null, string | null]>([
    ["2026-09-20", "Workday", "workday"],
    ["2026-09-23", "Autumn Equinox", "term"],
    ["2026-09-25", "Mid-Autumn Festival", "holiday"],
    ["2026-09-26", "Mid-Autumn · 2", "holiday"],
    ["2026-10-01", "National Day", "holiday"],
    ["2026-10-02", "National Day · 2", "holiday"],
    ["2026-10-08", "Cold Dew", "term"],
    ["2026-10-10", "Workday", "workday"],
    ["2026-10-23", "Frost's Descent", "term"],
    ["2026-01-01", "New Year's Day", "holiday"],
    ["2026-01-02", "New Year · 2", "holiday"],
    ["2026-02-15", "Spring Festival", "holiday"],
    ["2026-02-23", "Spring Festival · 9", "holiday"],
    ["2025-05-01", "Labour Day", "holiday"],
    ["2025-05-02", "May Day · 2", "holiday"],
    ["2025-10-06", "Mid-Autumn Festival", "holiday"],
    ["2025-10-08", "National Day · 8 · Cold Dew", "holiday"],
    ["2026-09-30", null, null],
  ])("%s → %s", (date, text, kind) => {
    expect(dayLabel(date)).toEqual(text === null ? null : { text, kind });
  });

  it("every statutory holiday and solar term has an English name (no Chinese left)", () => {
    const cjk = /[\u3400-\u9fff]/;
    for (const date of Object.keys((bundled as HolidayData).holidays)) {
      expect(dayLabel(date)?.text, date).not.toMatch(cjk);
    }
    for (const year of ["2025", "2026", "2027"]) {
      for (const term of getSolarTerms(`${year}-01-01`, `${year}-12-31`)) {
        expect(dayLabel(term.date)?.text, term.date).not.toMatch(cjk);
      }
    }
  });

  it("follows the language at call time", () => {
    expect(dayLabel("2026-10-02")?.text).toBe("National Day · 2");
    setLang("zh-Hans");
    expect(dayLabel("2026-10-02")?.text).toBe("国庆 · 2");
  });

  it("a festival without a translation shows the data's own name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
    await mockApi.setCache(
      HOLIDAYS_CACHE_KEY,
      JSON.stringify({
        fetchedAt: nowMs(),
        data: {
          holidays: {
            "2027-08-01": "Some Festival,某某节,2",
            "2027-08-02": "Some Festival,某某节,2",
          },
          workdays: {},
          inLieuDays: {},
        },
      }),
    );
    await initHolidays();
    expect(dayLabel("2027-08-01")?.text).toBe("Some Festival");
    expect(dayLabel("2027-08-02")?.text).toBe("Some Festival · 2");
    setLang("zh-Hans");
    expect(dayLabel("2027-08-01")?.text).toBe("某某节");
    expect(dayLabel("2027-08-02")?.text).toBe("某某 · 2");
  });
});

describe("solar terms · zh-Hans text = chinese-days' names", () => {
  it("all 24 terms", () => {
    const terms = getSolarTerms("2026-01-01", "2026-12-31");
    expect(terms).toHaveLength(24);
    for (const term of terms) expect(dayLabel(term.date)?.text, term.date).toContain(term.name);
  });
});

describe("bundled data (holidays-data/)", () => {
  it("is chinese-days' data from 2025-01-01 to its end, unchanged", () => {
    const up = upstream as HolidayData;
    for (const k of ["holidays", "workdays", "inLieuDays"] as const) {
      const expected = Object.fromEntries(Object.entries(up[k]).filter(([d]) => d >= "2025-01-01"));
      expect((bundled as HolidayData)[k]).toEqual(expected);
    }
    expect(Object.keys(bundled.holidays).sort()[0]).toBe("2025-01-01");
  });
});

describe("validateData / mergeData", () => {
  it("accepts the chinese-days shape, keeps 2025+, rejects anything else", () => {
    expect(validateData(upstream)?.holidays["2026-10-01"]).toBe("National Day,国庆节,3");
    expect(validateData(upstream)?.holidays["2004-10-01"]).toBeUndefined();
    expect(validateData(null)).toBeNull();
    expect(validateData({ holidays: {}, workdays: {}, inLieuDays: {} })).toBeNull();
    expect(
      validateData({ holidays: { "2026-10-01": "x" }, workdays: {}, inLieuDays: {} }),
    ).toBeNull();
    expect(
      validateData({ holidays: { "10/1": "a,b,1" }, workdays: {}, inLieuDays: {} }),
    ).toBeNull();
    expect(validateData({ holidays: { "2026-10-01": "a,b,1" }, workdays: [] })).toBeNull();
  });

  it("newer data replaces whole years", () => {
    const base = bundled as HolidayData;
    const next: HolidayData = {
      holidays: { "2026-10-02": "National Day,国庆节,3" },
      workdays: {},
      inLieuDays: {},
    };
    const merged = mergeData(base, next);
    expect(merged.holidays["2026-10-01"]).toBeUndefined();
    expect(merged.holidays["2026-10-02"]).toBe("National Day,国庆节,3");
    expect(merged.workdays["2026-10-10"]).toBeUndefined();
    expect(merged.holidays["2025-10-01"]).toBe(base.holidays["2025-10-01"]);
  });
});

describe("initHolidays", () => {
  const extra: HolidayData = {
    holidays: { ...(bundled as HolidayData).holidays, "2027-01-01": "New Year's Day,元旦,1" },
    workdays: (bundled as HolidayData).workdays,
    inLieuDays: (bundled as HolidayData).inLieuDays,
  };

  it("uses a fresh cache and does not fetch", async () => {
    await mockApi.setCache(
      HOLIDAYS_CACHE_KEY,
      JSON.stringify({ fetchedAt: nowMs() - 1000, data: extra }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await initHolidays();
    expect(dayLabel("2027-01-01")?.text).toBe("元旦");
    expect(pendingHolidayRefresh()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stale or missing cache → background fetch, validated, cached", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => extra }));
    vi.stubGlobal("fetch", fetchSpy);
    const setCache = vi.spyOn(mockApi, "setCache");
    await initHolidays();
    expect(dayLabel("2027-01-01")).toBeNull(); // still the bundled data
    await pendingHolidayRefresh();
    expect(fetchSpy).toHaveBeenCalledWith(HOLIDAYS_URL, expect.anything());
    expect(dayLabel("2027-01-01")?.text).toBe("元旦");
    expect(setCache).toHaveBeenCalledTimes(1);
    const [key, value] = setCache.mock.calls[0];
    expect(key).toBe(HOLIDAYS_CACHE_KEY);
    const stored = JSON.parse(value) as { fetchedAt: number; data: HolidayData };
    expect(stored.data.holidays["2027-01-01"]).toBe("New Year's Day,元旦,1");
    expect(Math.abs(stored.fetchedAt - nowMs())).toBeLessThan(5000);
  });

  it("an old cache is used until the refresh lands", async () => {
    await mockApi.setCache(
      HOLIDAYS_CACHE_KEY,
      JSON.stringify({ fetchedAt: nowMs() - WEEK - 1, data: extra }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await initHolidays();
    expect(dayLabel("2027-01-01")?.text).toBe("元旦");
    await pendingHolidayRefresh();
    expect(dayLabel("2027-01-01")?.text).toBe("元旦");
  });

  it("failures are silent: bad JSON shape, HTTP error, offline, broken cache", async () => {
    await mockApi.setCache(HOLIDAYS_CACHE_KEY, "{not json");
    const setCache = vi.spyOn(mockApi, "setCache");
    for (const fetchImpl of [
      async () => ({ ok: true, json: async () => ({ holidays: [] }) }),
      async () => ({ ok: false, json: async () => extra }),
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ]) {
      await resetHolidays();
      vi.stubGlobal("fetch", vi.fn(fetchImpl));
      await expect(initHolidays()).resolves.toBeUndefined();
      await pendingHolidayRefresh();
      expect(dayLabel("2026-10-01")?.text).toBe("国庆节");
      expect(dayLabel("2027-01-01")).toBeNull();
    }
    expect(setCache).not.toHaveBeenCalled();
  });

  it("a failing getCache does not throw", async () => {
    vi.spyOn(mockApi, "getCache").mockRejectedValue(new Error("db"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => null })),
    );
    await expect(initHolidays()).resolves.toBeUndefined();
    await pendingHolidayRefresh();
    expect(dayLabel("2026-10-02")?.text).toBe("国庆 · 2");
  });
});
