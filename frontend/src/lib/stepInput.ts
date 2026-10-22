// What a typed step turns into (ui-spec §19.1): the date it names, cut out of the text the way
// the calendar input cuts out a time (§18), plus its auto type. Pure and synchronous: it runs on
// every keystroke for the preview line.
//
// Dates read here (the first, leftmost one wins; same start → the longer one):
//   D1 / D2   「10/9」「10月9日」 — findDateTokens (keyPoint.ts), also used on saved texts
//   D4        「12.2」 — only while typing, where the preview shows the result: in a saved text it
//             is too often a version or an amount (「Python 3.12」)
//   D3        「今天 / 明天 / 后天 / 大后天 / 昨天 / 前天」「周五 / 下周五 / 这周五 / 上周五」
//   English   today, tomorrow, yesterday, (next / this / last) friday, Dec 2, 2 Dec
// A leading "on" / "by" goes with the date ("renew on fri" → "renew").

import type { KeyPointKind, KeyPointStepKind } from "@/types/domain";
import { addDays, diffDays, mondayOf } from "./dates";
import { classifyKeyPoint, findDateTokens, halfWidth, nearestDate } from "./keyPoint";

type Hit = { start: number; end: number; date: string };

// ── D4 「M.D」 ────────────────────────────────────────────────────────────────────────────────

/** No digit, letter, 「.」「/」「¥」「$」 or 「第」 before; no digit, letter or 「.digit」 after. */
const D4 = /(?<![0-9A-Za-z./¥￥$第])(\d{1,2})\.(\d{1,2})(?![0-9A-Za-z]|\.\d)/g;
/** An amount / count / section, not a date: 「3.5 万」「1.5 倍」「2.1 版」 (one optional space). */
const D4_UNIT =
  /^ ?(?:[元块万千百亿%倍斤米克个岁页份张次节章条版分秒]|小时|公斤|公里|美元|刀|磅|镑|欧|kg|km|[kmhwx](?![a-z])|hrs?|hours?|mins?)/i;

function dotDates(s: string, today: string): Hit[] {
  const out: Hit[] = [];
  D4.lastIndex = 0;
  for (let m = D4.exec(s); m; m = D4.exec(s)) {
    const end = m.index + m[0].length;
    if (D4_UNIT.test(s.slice(end))) continue;
    const date = nearestDate(Number(m[1]), Number(m[2]), today);
    if (date) out.push({ start: m.index, end, date });
  }
  return out;
}

// ── D3 relative days and weekdays ──────────────────────────────────────────────────────────────

const ZH_DAY: Record<string, number> = {
  前天: -2,
  昨天: -1,
  昨日: -1,
  今天: 0,
  今日: 0,
  明天: 1,
  明日: 1,
  后天: 2,
  大后天: 3,
};
/** 「然后天亮」「提前天数」: 后天 / 前天 inside another word is not a date. */
const ZH_DAY_RE =
  /大后天|(?<![然最之以落往背稍随今])后天|明天|明日|今天|今日|昨天|昨日|(?<![提之以从目当眼面])前天/g;

/** Monday-first index (0 = Monday) of a weekday character / word. */
const ZH_WEEKDAY: Record<string, number> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6,
};
/** Week offset of the prefix: 「下周五」 = Friday of next week; none = the coming one. */
const ZH_WEEK: Record<string, number> = { 上: -1, 这: 0, 本: 0, 下: 1, 下下: 2 };
// 「每周五」 (every Friday) and counts 「一周三次」「两周五天」 are not dates.
const ZH_WEEKDAY_RE =
  /(?<![0-9一二两三四五六七八九十几每])(?:(下下|下|上|这|本)个?)?(?:周|星期|礼拜)([一二三四五六日天])(?![次遍回个])/g;

const EN_DAY: Record<string, number> = {
  "day after tomorrow": 2,
  tomorrow: 1,
  tmrw: 1,
  tmr: 1,
  today: 0,
  yesterday: -1,
};
const EN_DAY_RE =
  /(?<![a-z'’])(?:the\s+)?(day\s+after\s+tomorrow|tomorrow|tmrw|tmr|today|yesterday)(?![a-z])/gi;

const EN_WEEKDAY: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tues: 1,
  tue: 1,
  wednesday: 2,
  weds: 2,
  wed: 2,
  thursday: 3,
  thurs: 3,
  thur: 3,
  thu: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
};
const EN_WEEK: Record<string, number> = { last: -1, this: 0, next: 1 };
const EN_WEEKDAY_RE =
  /(?<![a-z'’])(?:(next|this|last)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat|sun)(?![a-z])/gi;
/** Bare 「sat」「sun」 are everyday words; they need next / this / last. */
const EN_BARE_NOT = new Set(["sat", "sun"]);

/** `weekday` (0 = Monday) in the week `week` weeks from today's; null week = the coming one
 *  (today counts). */
function weekdayDate(today: string, weekday: number, week: number | null): string {
  if (week === null) {
    const todayIdx = diffDays(mondayOf(today), today);
    return addDays(today, (weekday - todayIdx + 7) % 7);
  }
  return addDays(mondayOf(today), week * 7 + weekday);
}

function relativeDates(s: string, today: string): Hit[] {
  const out: Hit[] = [];
  const push = (m: RegExpExecArray, date: string) =>
    out.push({ start: m.index, end: m.index + m[0].length, date });
  for (const re of [ZH_DAY_RE, ZH_WEEKDAY_RE, EN_DAY_RE, EN_WEEKDAY_RE]) re.lastIndex = 0;
  for (let m = ZH_DAY_RE.exec(s); m; m = ZH_DAY_RE.exec(s)) {
    push(m, addDays(today, ZH_DAY[m[0]]));
  }
  for (let m = ZH_WEEKDAY_RE.exec(s); m; m = ZH_WEEKDAY_RE.exec(s)) {
    push(m, weekdayDate(today, ZH_WEEKDAY[m[2]], m[1] ? ZH_WEEK[m[1]] : null));
  }
  for (let m = EN_DAY_RE.exec(s); m; m = EN_DAY_RE.exec(s)) {
    push(m, addDays(today, EN_DAY[m[1].toLowerCase().replace(/\s+/g, " ")]));
  }
  for (let m = EN_WEEKDAY_RE.exec(s); m; m = EN_WEEKDAY_RE.exec(s)) {
    const word = m[2].toLowerCase();
    if (!m[1] && EN_BARE_NOT.has(word)) continue;
    push(m, weekdayDate(today, EN_WEEKDAY[word], m[1] ? EN_WEEK[m[1].toLowerCase()] : null));
  }
  return out;
}

// ── English month names: 「Dec 2」「December 2nd」「2 Dec」「2nd of December」 ─────────────────

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const ORD = "(?:st|nd|rd|th)?";
const MONTH_DAY_RE = new RegExp(
  `(?<![a-z'’])(${MONTHS})\\.?\\s*(\\d{1,2})${ORD}(?![\\d:a-z])`,
  "gi",
);
const DAY_MONTH_RE = new RegExp(
  `(?<![\\d.:/])(\\d{1,2})${ORD}\\s*(?:of\\s+)?(${MONTHS})(?![a-z])`,
  "gi",
);

function monthNumber(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return (
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      w,
    ) + 1
  );
}

function monthNameDates(s: string, today: string): Hit[] {
  const out: Hit[] = [];
  for (const [re, mi, di] of [
    [MONTH_DAY_RE, 1, 2],
    [DAY_MONTH_RE, 2, 1],
  ] as const) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const date = nearestDate(monthNumber(m[mi]), Number(m[di]), today);
      if (date) out.push({ start: m.index, end: m.index + m[0].length, date });
    }
  }
  return out;
}

// ── cut and tidy ───────────────────────────────────────────────────────────────────────────────

/** "on" / "by" right before the date goes with it. */
const LEAD_IN = /(?<![a-z])(?:on|by)\s*$/i;
const EDGE_PUNCT = /^[\s，,。、:：;；·\-–—~]+|[\s，,。、:：;；·\-–—~]+$/g;
/** Brackets the cut left empty: 「去查结果（明天）」 → 「去查结果」. */
const EMPTY_BRACKETS = /[（(【[]\s*[）)】\]]/g;
/** A sentence-final 「.」「!」「?」 left alone by the cut ("Renew it on Friday." → "Renew it"). */
const STRAY_END = /(?:^|\s)[.!?]+$/;

function tidy(text: string): string {
  return text
    .replace(EMPTY_BRACKETS, "")
    .replace(/\s+/g, " ")
    .replace(EDGE_PUNCT, "")
    .replace(STRAY_END, "")
    .trim();
}

export type StepDate = { date: string | null; title: string };

/** 「12.2 cdn 证书过期，记得续签」→ { date: "2026-12-02", title: "cdn 证书过期，记得续签" }. */
export function parseStepDate(raw: string, today: string): StepDate {
  const text = raw.trim();
  const s = halfWidth(text);
  const hits: Hit[] = [
    ...findDateTokens(s, today),
    ...dotDates(s, today),
    ...relativeDates(s, today),
    ...monthNameDates(s, today),
  ];
  if (hits.length === 0) return { date: null, title: text };
  let best = hits[0];
  for (const h of hits) {
    if (h.start < best.start || (h.start === best.start && h.end > best.end)) best = h;
  }
  const lead = LEAD_IN.exec(s.slice(0, best.start));
  const start = lead ? lead.index : best.start;
  return { date: best.date, title: tidy(text.slice(0, start) + text.slice(best.end)) };
}

// ── the whole step ───────────────────────────────────────────────────────────────────────────

export type StepInput<K extends KeyPointKind = KeyPointKind> = {
  kind: K | KeyPointStepKind;
  date: string | null;
  /** Saved text: what was typed, minus the date fragment when that date is the one used. */
  text: string;
  /** The date fragment is cut out, so saving rewrites the typed text (the preview line shows it). */
  cut: boolean;
};

/**
 * What adding `raw` would write (ui-spec §19.1). `manualKind` / `manualDate` are picked by hand
 * (undefined date = follow the text, null = cleared). The type is judged on the words without the
 * date; a note (记一笔) without a date gets today. The fragment is cut only when its date is the one
 * saved: a date picked or cleared by hand leaves the text as typed.
 */
export function resolveStepInput<K extends KeyPointKind>(
  raw: string,
  today: string,
  manualKind: K | null,
  manualDate: string | null | undefined,
): StepInput<K> {
  const typed = raw.trim();
  const p = parseStepDate(typed, today);
  const kind = manualKind ?? classifyKeyPoint(p.date ? p.title : typed, today).kind;
  const autoDate = kind === "note" ? (p.date ?? today) : p.date;
  const date = manualDate !== undefined ? manualDate : autoDate;
  const cut = p.date !== null && date === p.date;
  return { kind, date, text: cut ? p.title : typed, cut };
}
