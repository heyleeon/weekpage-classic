// Holidays, adjusted workdays and solar terms (ui-spec §2.4).
// Neither throws: the shell calls `initHolidays()` at startup and day heads call `dayLabel`.
//
// Data:
// - Statutory holidays / adjusted workdays: chinese-days' `chinese-days.json` (follows the State
//   Council notices). A copy from 2025-01-01 on is bundled in holidays-data/ (chinese-days 1.5.9,
//   data up to 2026-10-10). Regenerate after bumping the package:
//     node -e 'const d=require("chinese-days/dist/chinese-days.json");const o={};for(const k of ["holidays","workdays","inLieuDays"])o[k]=Object.fromEntries(Object.entries(d[k]).filter(([x])=>x>="2025-01-01").sort());require("fs").writeFileSync("src/lib/holidays-data/chinese-days.json",JSON.stringify(o,null,1)+"\n")'
// - Online update: the same file from jsDelivr, fetched in the background at most once a week and
//   kept in settings key 'cache:holidays' ({ fetchedAt, data }). Failures are silent.
// - Solar terms: computed by chinese-days' getSolarTerms (astronomical, no data file).

import { getSolarTerms, type SolarTerm } from "chinese-days";
import { currentLang, type Translation, t } from "@/i18n";
import type { DayLabel } from "@/types/domain";
import { api } from "./api";
import { nowMs } from "./clock";
import { addDays, diffDays } from "./dates";
import bundled from "./holidays-data/chinese-days.json";

/** date → "English name,中文名,天数" (chinese-days format). */
export type HolidayMap = Record<string, string>;
export type HolidayData = { holidays: HolidayMap; workdays: HolidayMap; inLieuDays: HolidayMap };

export const HOLIDAYS_CACHE_KEY = "cache:holidays";
export const HOLIDAYS_URL = "https://cdn.jsdelivr.net/npm/chinese-days/dist/chinese-days.json";
const WEEK_MS = 7 * 86_400_000;
/** After a failed fetch, wait this long before trying again in the same session. */
const RETRY_MS = 6 * 3_600_000;
const FETCH_TIMEOUT_MS = 15_000;
const KEEP_FROM = "2025-01-01";

const BUNDLED = bundled as HolidayData;
let data: HolidayData = BUNDLED;
let fetchedAt = 0;
let lastAttempt = 0;
let initialized = false;
let refreshing: Promise<void> | null = null;

// ── names ────────────────────────────────────────────────────────────────────────────────────
// Texts come from the i18n `holidays` section and follow the active language at call time.

type FestivalKey = keyof Translation["holidays"]["festival"];
type TermKey = keyof Translation["holidays"]["term"];

/** chinese-days' English holiday names → `holidays.festival.*` (full name for the first day of a
 *  break, short name for 「国庆 · 2」). */
const FESTIVALS = new Map<string, FestivalKey>([
  ["New Year's Day", "newYear"],
  ["Spring Festival", "springFestival"],
  ["Tomb-sweeping Day", "qingming"],
  ["Labour Day", "labourDay"],
  ["Dragon Boat Festival", "dragonBoat"],
  ["Mid-autumn Festival", "midAutumn"],
  ["National Day", "nationalDay"],
]);

/** chinese-days' solar term ids → `holidays.term.*`. Typed against the library, so a renamed id
 *  fails tsc on upgrade ("code_dew" is upstream's spelling of cold dew). */
const TERMS: Record<SolarTerm["term"], TermKey> = {
  lesser_cold: "minorCold",
  greater_cold: "majorCold",
  the_beginning_of_spring: "springBegins",
  rain_water: "rainWater",
  the_waking_of_insects: "insectsAwaken",
  the_spring_equinox: "springEquinox",
  pure_brightness: "pureBrightness",
  grain_rain: "grainRain",
  the_beginning_of_summer: "summerBegins",
  lesser_fullness_of_grain: "grainBuds",
  grain_in_beard: "grainInEar",
  the_summer_solstice: "summerSolstice",
  lesser_heat: "minorHeat",
  greater_heat: "majorHeat",
  the_beginning_of_autumn: "autumnBegins",
  the_end_of_heat: "endOfHeat",
  white_dew: "whiteDew",
  the_autumn_equinox: "autumnEquinox",
  code_dew: "coldDew",
  frost_descent: "frostDescent",
  the_beginning_of_winter: "winterBegins",
  lesser_snow: "minorSnow",
  greater_snow: "majorSnow",
  the_winter_solstice: "winterSolstice",
};

function nameOf(value: string): { key: string; full: string; short: string } {
  const [en = "", zh = ""] = value.split(",");
  const known = FESTIVALS.get(en);
  if (known) {
    return {
      key: en,
      full: t(`holidays.festival.${known}.full`),
      short: t(`holidays.festival.${known}.short`),
    };
  }
  // A festival this build has no text for (newer data): the data's own name in that language.
  if (currentLang() === "en") return { key: en, full: en, short: en };
  return { key: en, full: zh, short: zh.endsWith("节") && zh.length > 2 ? zh.slice(0, -1) : zh };
}

/** 「国庆节」 on the first day of a break, 「国庆 · N」 after (weekends inside the break count). A
 *  festival that starts inside another break (2025: 中秋 10/6 inside 国庆) gets its full name. */
function holidayText(date: string): string | null {
  const value = data.holidays[date];
  if (value === undefined) return null;
  let start = date;
  while (data.holidays[addDays(start, -1)] !== undefined) start = addDays(start, -1);
  const run = nameOf(data.holidays[start]);
  const own = nameOf(value);
  const n = diffDays(start, date) + 1;
  if (n === 1) return run.full;
  if (own.key !== run.key) {
    const prev = data.holidays[addDays(date, -1)];
    if (prev === undefined || nameOf(prev).key !== own.key) return own.full;
  }
  return t("holidays.nthDay", { name: run.short, n });
}

// ── solar terms ──────────────────────────────────────────────────────────────────────────────

/** year → date → the library's term (id + Chinese name). Language-independent, so it is cached. */
const termsByYear = new Map<string, Map<string, SolarTerm>>();

function termOf(date: string): SolarTerm | null {
  const year = date.slice(0, 4);
  let terms = termsByYear.get(year);
  if (!terms) {
    terms = new Map();
    try {
      for (const term of getSolarTerms(`${year}-01-01`, `${year}-12-31`))
        terms.set(term.date, term);
    } catch {
      // Out of the library's range: no terms for that year.
    }
    termsByYear.set(year, terms);
  }
  return terms.get(date) ?? null;
}

/** 「寒露」 / "Cold Dew" for a date, or null. An id this build does not know keeps the library's
 *  (Chinese) name. */
function termText(date: string): string | null {
  const term = termOf(date);
  if (!term) return null;
  const key = Object.hasOwn(TERMS, term.term) ? TERMS[term.term] : undefined;
  return key ? t(`holidays.term.${key}`) : term.name;
}

// ── public API ───────────────────────────────────────────────────────────────────────────────

/** 「国庆 · 2」/「寒露」/「补班」 for a date in the active language, or null. Holiday and term on the
 *  same day are joined with 「 · 」, holiday first. Other festivals (七夕, 圣诞…) are not shown. */
export function dayLabel(date: string): DayLabel | null {
  if (initialized) maybeRefresh();
  const holiday = holidayText(date);
  const workday = data.workdays[date] !== undefined ? t("holidays.workday") : null;
  const term = termText(date);
  const head = holiday ?? workday;
  if (head) {
    return {
      text: term ? t("holidays.withTerm", { head, term }) : head,
      kind: holiday ? "holiday" : "workday",
    };
  }
  return term ? { text: term, kind: "term" } : null;
}

/** Loads the bundled data + cached online update; refreshes in the background weekly. */
export async function initHolidays(): Promise<void> {
  try {
    const raw = await api.getCache(HOLIDAYS_CACHE_KEY);
    const cached = raw ? parseCache(raw) : null;
    if (cached) {
      data = mergeData(BUNDLED, cached.data);
      fetchedAt = cached.fetchedAt;
    }
  } catch {
    // No cache (or unreadable): the bundled data is enough.
  }
  initialized = true;
  maybeRefresh();
}

/** Starts a background fetch when the data is older than a week. Never throws. */
function maybeRefresh(): void {
  const now = nowMs();
  if (refreshing || now - fetchedAt < WEEK_MS || now - lastAttempt < RETRY_MS) return;
  lastAttempt = now;
  refreshing = refresh().finally(() => {
    refreshing = null;
  });
}

async function refresh(): Promise<void> {
  try {
    if (typeof fetch !== "function") return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let json: unknown;
    try {
      const res = await fetch(HOLIDAYS_URL, { signal: ctrl.signal, cache: "no-cache" });
      if (!res.ok) return;
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const fresh = validateData(json);
    if (!fresh) return;
    data = mergeData(BUNDLED, fresh);
    fetchedAt = nowMs();
    await api.setCache(HOLIDAYS_CACHE_KEY, JSON.stringify({ fetchedAt, data: fresh }));
  } catch {
    // Offline, blocked, bad JSON, cache write failed: keep what we have.
  }
}

// ── data helpers (exported for tests) ────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALUE_RE = /^[^,]+,[^,]+,\d+$/;

function validMap(v: unknown): HolidayMap | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: HolidayMap = {};
  for (const [k, val] of Object.entries(v)) {
    if (!DATE_RE.test(k) || typeof val !== "string" || !VALUE_RE.test(val)) return null;
    if (k >= KEEP_FROM) out[k] = val;
  }
  return out;
}

/** chinese-days.json shape check; keeps dates from 2025 on. null when the shape is wrong. */
export function validateData(v: unknown): HolidayData | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const holidays = validMap(o.holidays);
  const workdays = validMap(o.workdays);
  const inLieuDays = validMap(o.inLieuDays);
  if (!holidays || !workdays || !inLieuDays || Object.keys(holidays).length === 0) return null;
  return { holidays, workdays, inLieuDays };
}

function parseCache(raw: string): { fetchedAt: number; data: HolidayData } | null {
  try {
    const v = JSON.parse(raw) as { fetchedAt?: unknown; data?: unknown };
    const d = validateData(v.data);
    if (!d || typeof v.fetchedAt !== "number") return null;
    return { fetchedAt: v.fetchedAt, data: d };
  } catch {
    return null;
  }
}

/** Newer data replaces whole years (a changed notice can drop dates), older years stay bundled. */
export function mergeData(base: HolidayData, next: HolidayData): HolidayData {
  const years = new Set<string>();
  for (const m of [next.holidays, next.workdays, next.inLieuDays]) {
    for (const k of Object.keys(m)) years.add(k.slice(0, 4));
  }
  const merge = (a: HolidayMap, b: HolidayMap): HolidayMap => {
    const out: HolidayMap = {};
    for (const [k, v] of Object.entries(a)) if (!years.has(k.slice(0, 4))) out[k] = v;
    return Object.assign(out, b);
  };
  return {
    holidays: merge(base.holidays, next.holidays),
    workdays: merge(base.workdays, next.workdays),
    inLieuDays: merge(base.inLieuDays, next.inLieuDays),
  };
}

/** Tests only: back to the bundled data, not initialised; resolves when a pending fetch settled. */
export async function resetHolidays(): Promise<void> {
  if (refreshing) await refreshing;
  data = BUNDLED;
  fetchedAt = 0;
  lastAttempt = 0;
  initialized = false;
  refreshing = null;
}

/** Tests only: the pending background refresh, if any. */
export function pendingHolidayRefresh(): Promise<void> | null {
  return refreshing;
}
