// Key point classification, date extraction and markers (ui-spec §19, §9, §2.5).
// The type rules match Chinese wording only (ui-spec §19.1); calendarLabel's 「去查」 is i18n
// (`tasks.calendar.*`, active language at call time).

import { t as tr } from "@/i18n";
import type { KeyPoint, MarkerKind, Task } from "@/types/domain";
import { diffDays, isoFromParts } from "./dates";

/** A date fragment inside a key point text: [start, end) offsets and the resolved date. */
export type DateToken = { start: number; end: number; date: string };

// ── dates (§19.1 step 0 / step 1) ────────────────────────────────────────────────────────────

/** Full-width digits / letters / 「／」 → half-width. Length-preserving, so offsets stay valid. */
export function halfWidth(text: string): string {
  return text.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// D1 「M/D」: no digit, letter or 「/」 on either side. D2 「M月D日」/「M月D号」.
const D1 = /(?<![0-9A-Za-z/])(\d{1,2})\/(\d{1,2})(?![0-9A-Za-z/])/g;
const D2 = /(?<!\d)(\d{1,2})月(\d{1,2})[日号]/g;
/** A count, not a date: 「做完 3/4 页」 (one optional space before the unit). */
const COUNT_UNIT = /^ ?[页份张个次%倍]/;

/** The occurrence of month/day nearest to `today` (a tie goes to the later one). */
export function nearestDate(month: number, day: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const y of [year - 1, year, year + 1]) {
    const iso = isoFromParts(y, month, day);
    if (!iso) continue;
    const dist = Math.abs(diffDays(today, iso));
    if (dist < bestDist || (dist === bestDist && best !== null && best < iso)) {
      best = iso;
      bestDist = dist;
    }
  }
  return best;
}

/** All date fragments in `text` (rules D1 / D2 of ui-spec §19.1), in text order. */
export function findDateTokens(text: string, today: string): DateToken[] {
  const s = halfWidth(text);
  const out: DateToken[] = [];
  for (const re of [D1, D2]) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const end = m.index + m[0].length;
      if (COUNT_UNIT.test(s.slice(end))) continue;
      const date = nearestDate(Number(m[1]), Number(m[2]), today);
      if (date) out.push({ start: m.index, end, date });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The first date mentioned in `text`, or null. */
export function extractDate(text: string, today: string): string | null {
  return findDateTokens(text, today)[0]?.date ?? null;
}

// ── type (§19.1 step 2) ──────────────────────────────────────────────────────────────────────

const WAIT_EXCLUDED = [
  "等于",
  "等级",
  "等比",
  "等同",
  "等号",
  "等分",
  "等宽",
  "等高",
  "等距",
  "等差",
  "等式",
  "等效",
  "等量",
  "等边",
];
const CHECK_WORDS = [
  "检查",
  "确认",
  "核对",
  "核实",
  "复查",
  "查一下",
  "查一遍",
  "查查",
  "去查",
  "再查",
  "看一下",
  "看一遍",
  "看看",
  "过目",
];
const CHECK_FOLLOWERS = /查(?:结果|进度|状态|邮件|有没有|是否)/;
const SEPARATORS = /^[\s·:：]+/;
const TRAILING_PUNCT = /[\s，,。.、;；!！?？)）\]】]+$/;

/** Auto type of a typed key point (ui-spec §19.1). */
export function classifyKeyPoint(
  text: string,
  today: string,
): { kind: "do" | "wait" | "check"; date: string | null } {
  const t = halfWidth(text).trim();
  const tokens = findDateTokens(t, today);
  const date = tokens[0]?.date ?? null;
  // Strip a leading date and the separators after it.
  let s = t;
  if (tokens[0]?.start === 0) s = s.slice(tokens[0].end);
  s = s.replace(SEPARATORS, "");
  if (s.startsWith("等") && !WAIT_EXCLUDED.some((w) => s.startsWith(w))) {
    return { kind: "wait", date };
  }
  const isCheck =
    CHECK_WORDS.some((w) => s.includes(w)) ||
    s.replace(TRAILING_PUNCT, "").endsWith("查") ||
    CHECK_FOLLOWERS.test(s);
  return { kind: isCheck ? "check" : "do", date };
}

// ── calendar title (ui-spec §2.5) ──────────────────────────────────────────────────────────

const EDGES = /^[\s·:：,，\-–—]+|[\s·:：,，\-–—]+$/g;

function cleanEdges(s: string): string {
  return s.replace(/\s+/g, " ").replace(EDGES, "");
}

/** `text` without its date fragments, edges tidied. */
function withoutDates(text: string, today: string): string {
  let s = text;
  for (const t of findDateTokens(text, today).reverse()) s = s.slice(0, t.start) + s.slice(t.end);
  return cleanEdges(s);
}

/** Calendar title of a checkpoint / dated wait: 「注册美卡 · 去查审批」. */
export function calendarLabel(kp: KeyPoint, taskTitle: string, today: string): string {
  let s = withoutDates(kp.text, today);
  if (kp.kind === "wait") {
    if (s.startsWith("等")) s = cleanEdges(s.slice(1));
    if (s.endsWith("查")) s = cleanEdges(s.slice(0, -1));
    return s
      ? tr("tasks.calendar.checkOn", { task: taskTitle, what: s })
      : tr("tasks.calendar.checkBare", { task: taskTitle });
  }
  return s ? `${taskTitle} · ${s}` : taskTitle;
}

// ── overdue / markers / counts (ui-spec §9) ───────────────────────────────

/**
 * Days a step is past its date (ui-spec §9.3, 2026-10-02): a step with a date before today that
 * is not ticked, on a task that is neither done nor archived. 0 = not overdue (no date, today or
 * later, done, a note, or a closed task). There is no 「current」 step any more: time progress is
 * the track, step progress the ticks.
 */
export function overdueDays(kp: KeyPoint, task: Task, today: string): number {
  if (kp.kind === "note" || kp.date === null || kp.doneDate !== null) return 0;
  if (task.status === "done" || task.archivedDate !== null) return 0;
  return kp.date < today ? diffDays(kp.date, today) : 0;
}

/** Overdue steps of `task` by id → days past their date (overdueDays); only overdue ones. */
export function overdueByKp(task: Task, kps: KeyPoint[], today: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of kps) {
    if (k.taskId !== task.id) continue;
    const days = overdueDays(k, task, today);
    if (days > 0) out.set(k.id, days);
  }
  return out;
}

/**
 * Date at the end of a card row (ui-spec §8.6): a note's date; a dated step's date, unless the row
 * is overdue (「逾期 N 天」 says more) or its text already names that day (「等审批 · 10/1 查」,
 * typed before dates were cut out of the text).
 */
export function cardRowDate(kp: KeyPoint, overdue: boolean, today: string): string | null {
  if (kp.date === null) return null;
  if (kp.kind === "note") return kp.date;
  if (overdue) return null;
  return findDateTokens(kp.text, today).some((t) => t.date === kp.date) ? null : kp.date;
}

/** Marker for a key point (ui-spec §9.2): done → overdue → its type. Notes use their own markers;
 *  they get "idle" here. */
export function markerOf(kp: KeyPoint, overdue = false): MarkerKind {
  if (kp.kind === "note") return "idle";
  if (kp.doneDate !== null) return "done";
  if (overdue) return "overdue";
  if (kp.kind === "check") return "check";
  if (kp.kind === "wait") return "wait";
  return "idle";
}

/** Key point counts for a card footer; notes are not counted. */
export function keyPointCounts(kps: KeyPoint[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const k of kps) {
    if (k.kind === "note") continue;
    total++;
    if (k.doneDate !== null) done++;
  }
  return { total, done };
}
