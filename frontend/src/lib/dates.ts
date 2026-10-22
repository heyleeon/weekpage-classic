// Floating local dates as 'YYYY-MM-DD' strings and integer day differences (no date library,
// see docs/memory/decisions.md「选型与命名的理由迁入」). All arithmetic runs on UTC midnights, so DST never shifts a day.
//
// Locale-aware date TEXT lives here too (words come from the i18n `common.date.*` keys and follow
// the active language at call time; zh-Hans output is the original copy):
//   weekdayShort(d)        「周三」 / "Wed"
//   weekdayNames()         Monday-first 「周一」…「周日」 / "Mon"…"Sun"   (calendar weekday row)
//   weekdayNarrowNames()   Monday-first 「一」…「日」 / "M"…"S"           (mini calendar)
//   monthName(m)           「9月」 / "September"
//   monthShortName(m)      「9月」 / "Sep"
//   monthDayLabel(d)       「10月1日」 / "Oct 1"
//   formatMD(d)            「10/9」 (numeric, same in every language)
//   formatMDW(d)           「10/9 周五」 / "10/9 Fri"
//   calendarTitle(anchor)  { main: 「9月」 / "September", sub: "2026" }
//   todayTitle(today)      { main: 「9月30日」 / "Sep 30", sub: 「周三」 / "Wed" }
// Calendar navigation math: homeAnchor(today, firstRow), homeDirection(anchor, home).

import { t } from "@/i18n";
import type { CalendarFirstRow, HomeDirection } from "@/types/domain";

const DAY_MS = 86_400_000;
/** i18n keys by JS getUTCDay() (0 = Sunday). */
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
/** Monday-first, the order of every week row in the app. */
const WEEKDAY_KEYS_MONDAY_FIRST = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** i18n keys by month number − 1. */
const MONTH_KEYS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

function monthKey(m: number): (typeof MONTH_KEYS)[number] {
  return MONTH_KEYS[Math.min(12, Math.max(1, Math.trunc(m))) - 1];
}

function toUtc(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUtc(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parts(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
}

/** `YYYY-MM-DD` of a JS Date in local time. */
export function isoFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** d + n days. */
export function addDays(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * DAY_MS);
}

/** b − a in whole days (same day = 0). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 「周三」 / "Wed". */
export function weekdayShort(d: string): string {
  return t(`common.date.weekday.${WEEKDAY_KEYS[new Date(toUtc(d)).getUTCDay()]}`);
}

/** Monday-first weekday names: 「周一」…「周日」 / "Mon"…"Sun". */
export function weekdayNames(): string[] {
  return WEEKDAY_KEYS_MONDAY_FIRST.map((k) => t(`common.date.weekday.${k}`));
}

/** Monday-first one-letter heads: 「一」…「日」 / "M"…"S". */
export function weekdayNarrowNames(): string[] {
  return WEEKDAY_KEYS_MONDAY_FIRST.map((k) => t(`common.date.weekdayNarrow.${k}`));
}

/** Month 1–12 → 「9月」 / "September". */
export function monthName(m: number): string {
  return t(`common.date.month.${monthKey(m)}`);
}

/** Month 1–12 → 「9月」 / "Sep". */
export function monthShortName(m: number): string {
  return t(`common.date.monthShort.${monthKey(m)}`);
}

/** 「10月1日」 / "Oct 1". */
export function monthDayLabel(d: string): string {
  const { m, day } = parts(d);
  return t("common.date.monthDay", { month: m, monthShort: monthShortName(m), day });
}

/** 「10/9」 (no zero padding). */
export function formatMD(d: string): string {
  const { m, day } = parts(d);
  return `${m}/${day}`;
}

/** 「10/9 周五」 / "10/9 Fri". */
export function formatMDW(d: string): string {
  return `${formatMD(d)} ${weekdayShort(d)}`;
}

/** Monday of the week containing d (weeks start on Monday). */
export function mondayOf(d: string): string {
  const dow = new Date(toUtc(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, dow === 0 ? -6 : 1 - dow);
}

/** Validated date from numeric parts; null for impossible dates (2026-02-30). */
export function isoFromParts(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = fromUtc(Date.UTC(y, m - 1, d));
  const back = parts(iso);
  return back.y === y && back.m === m && back.day === d ? iso : null;
}

/** Calendar range: `weeks` full weeks starting at `anchorMonday`. */
export function visibleRange(
  anchorMonday: string,
  weeks: 2 | 3 | 4,
): { from: string; to: string; days: string[] } {
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(anchorMonday, i));
  return { from: days[0], to: days[days.length - 1], days };
}

/** Calendar page title from the first visible day: { main: "9月", sub: "2026" } (ui-spec §1.3);
 *  English { main: "September", sub: "2026" }. */
export function calendarTitle(anchorMonday: string): { main: string; sub: string } {
  const { y, m } = parts(anchorMonday);
  return { main: monthName(m), sub: String(y) };
}

/** Tasks / archive page title: { main: "9月30日", sub: "周三" }; English { "Sep 30", "Wed" }. */
export function todayTitle(today: string): { main: string; sub: string } {
  return { main: monthDayLabel(today), sub: weekdayShort(today) };
}

// ── Calendar navigation (components/calendar/calendarNav.ts builds on these) ──────────────────

/**
 * The calendar's home position: the Monday its first row shows when the window opens and on
 * 「回到今天」. `thisWeek` → Monday of today's week; `lastWeek` → the Monday before that.
 */
export function homeAnchor(today: string, firstRow: CalendarFirstRow): string {
  const monday = mondayOf(today);
  return firstRow === "lastWeek" ? addDays(monday, -7) : monday;
}

/**
 * Where home is relative to the current view: `"down"` = home is later (the view shows earlier
 * weeks), `"up"` = home is earlier, `null` = the view is at home.
 */
export function homeDirection(anchor: string, home: string): HomeDirection {
  const d = diffDays(mondayOf(anchor), home);
  if (d === 0) return null;
  return d > 0 ? "down" : "up";
}
