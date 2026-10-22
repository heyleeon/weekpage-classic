// Time recognition for typed input (ui-spec §18).
// Must stay synchronous and pure: it runs on every keystroke for the live preview line.
//
// Pipeline (ui-spec §18):
//   1. normalise a copy for matching (full-width → half-width, 「：」→「:」, 一…十二 / 两 → digits,
//      A–Z → a–z, "o'clock" → 「点钟」, "noon" / "midnight" → 12pm / 12am), remembering for every
//      normalised char where it came from in the raw text;
//   2. collect candidates of every pattern (range, colon, dot, am/pm, 「点」, bare 「中午」) and take
//      the leftmost valid one (same start → the pattern with the higher priority);
//   3. resolve morning / afternoon;
//   4. cut the matched fragment out of the raw text and tidy the title.
//
// English input is read whatever the UI language is: "8pm", "8:30 am", "3-5pm" / "3 to 5pm" (a
// bare start takes the end's am / pm, "11-1pm" = 11:00–13:00), "noon" / "midnight", "8 o'clock",
// period words before or after the hour ("tonight at 8", "3 in the afternoon", "10 at night"),
// and "at 8" (bare hour after at / @, read like 「8点」). A leading "at" / "@" / "from" goes with
// the time. Like 「明天」, date words ("today", "tomorrow", "next fri") are not read: the date
// comes from the day cell (ui-spec §18), so they stay in the title.

export type ParsedTime = { time: string | null; endTime: string | null; title: string };

// ── 1. normalisation ─────────────────────────────────────────────────────────────────────────

type Norm = {
  /** Normalised text, used for matching only. */
  s: string;
  /** For every char of `s`: the [from, to) range in the raw text it came from. */
  from: number[];
  to: number[];
  /** The char came from a Chinese numeral (「一点」 needs more context to be a time). */
  cjk: boolean[];
};

const CJK_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function isCjkNumeral(ch: string): boolean {
  return ch === "十" || ch in CJK_DIGIT;
}

/** 「三」→ 3, 「十」→ 10, 「十二」→ 12, 「二十五」→ 25; null for anything else (「一二三」). */
function cjkNumber(run: string): number | null {
  if (run.length === 1) return run === "十" ? 10 : (CJK_DIGIT[run] ?? null);
  const m = /^([一二两三四五]?)十([一二三四五六七八九]?)$/.exec(run);
  if (!m) return null;
  return (m[1] ? CJK_DIGIT[m[1]] : 1) * 10 + (m[2] ? CJK_DIGIT[m[2]] : 0);
}

/** English words read as a canonical form ("12 noon" too); sticky, tried at each position. */
const ALIASES: { re: RegExp; to: string }[] = [
  { re: /(?<![a-z])o['’]?\s?clock(?![a-z])/iy, to: "点钟" },
  { re: /(?<![a-z\d.:])(?:12\s*)?(?:noon|midday)(?![a-z])/iy, to: "12pm" },
  { re: /(?<![a-z\d.:])(?:12\s*)?midnight(?![a-z])/iy, to: "12am" },
];

/** [canonical text, raw length] of the alias starting at `i`, or null. */
function aliasAt(raw: string, i: number): [string, number] | null {
  for (const { re, to } of ALIASES) {
    re.lastIndex = i;
    const m = re.exec(raw);
    if (m) return [to, m[0].length];
  }
  return null;
}

function normalize(raw: string): Norm {
  const n: Norm = { s: "", from: [], to: [], cjk: [] };
  const push = (text: string, from: number, to: number, cjk: boolean) => {
    for (const ch of text) {
      n.s += ch;
      n.from.push(from);
      n.to.push(to);
      n.cjk.push(cjk);
    }
  };
  let i = 0;
  while (i < raw.length) {
    if (isCjkNumeral(raw[i])) {
      let j = i;
      while (j < raw.length && isCjkNumeral(raw[j])) j++;
      const value = cjkNumber(raw.slice(i, j));
      if (value !== null) push(String(value), i, j, true);
      else for (let k = i; k < j; k++) push(raw[k], k, k + 1, false);
      i = j;
      continue;
    }
    const alias = aliasAt(raw, i);
    if (alias) {
      push(alias[0], i, i + alias[1], false);
      i += alias[1];
      continue;
    }
    const code = raw.charCodeAt(i);
    let c = raw[i];
    if (code >= 0xff01 && code <= 0xff5e) c = String.fromCharCode(code - 0xfee0);
    else if (code === 0x3000) c = " ";
    if (c >= "A" && c <= "Z") c = c.toLowerCase();
    push(c, i, i + 1, false);
    i++;
  }
  return n;
}

// ── 2. patterns ──────────────────────────────────────────────────────────────────────────────

/** Period words, longest first so 「今晚」 / 「傍晚」 win over 「晚」. */
const PERIOD = "凌晨|早上|早晨|上午|中午|下午|午后|傍晚|晚上|今晚|夜里|早|晚";
const PERIOD_PART = `(?:(${PERIOD})\\s*)?`;
const AMPM = "a\\.m\\.|p\\.m\\.|am|pm";
/** am / pm must not run into a word: 「3 amazing」 is not 3 am. */
const AMPM_END = "(?![a-z])";
/** No digit, 「.」 or 「:」 right before the hour. */
const NUM_START = "(?<![\\d.:])";
/** The dot form additionally refuses 「v」「¥」「$」 before the hour (「v2.10」「¥15.00」). */
const DOT_START = "(?<![\\dv¥$.:])";
/** Units after 「15.00」 that make it an amount, not a time (ui-spec §18 step 2.3). */
const DOT_UNIT =
  "(?!\\s*(?:元|块|%|万|千|百|亿|kg|斤|米|km|刀|公斤|公里|克|g\\b|磅|镑|欧|美元|倍|个|岁|w\\b|k\\b|m\\b))";
/** 「点」 tail: 半 | 一刻 / 三刻 | M 分 | M, then an optional 「钟」. */
const DIAN_TAIL = "(?:(半)|(1|3)刻|(\\d{1,2})\\s*分|(\\d{1,2})(?![\\d点:]))?(钟)?";

type Clock = {
  period: string | null;
  ampm: "am" | "pm" | null;
  hour: number;
  minute: number;
  /** Hour written with a leading zero (「06:00」「09.30」): read as 24-hour, never +12. */
  zeroPadded: boolean;
  /** The hour is a Chinese 「一」 (「一点」 is usually 「a little」, not a time). */
  cjkOne: boolean;
  /** Has minutes, 「钟」 or am / pm. */
  hasTail: boolean;
};

type Candidate = {
  start: number;
  end: number;
  priority: number;
  time: string;
  endTime: string | null;
};

type AtomKind = "colon" | "dotAmpm" | "dot" | "ampm" | "dian";

// Group 1 is always the period word, group 2 the hour.
const ATOMS: { kind: AtomKind; priority: number; re: RegExp }[] = [
  {
    kind: "colon",
    priority: 2,
    re: new RegExp(
      `${PERIOD_PART}${NUM_START}(\\d{1,2}):(\\d{2})(?!\\d)(?:\\s*(${AMPM})${AMPM_END})?`,
      "g",
    ),
  },
  {
    kind: "dotAmpm",
    priority: 3,
    re: new RegExp(`${PERIOD_PART}${DOT_START}(\\d{1,2})\\.(\\d{2})\\s*(${AMPM})${AMPM_END}`, "g"),
  },
  {
    kind: "dot",
    priority: 3,
    re: new RegExp(`${PERIOD_PART}${DOT_START}(\\d{2})\\.(\\d{2})(?![\\d.])${DOT_UNIT}`, "g"),
  },
  {
    kind: "ampm",
    priority: 4,
    re: new RegExp(`${PERIOD_PART}${NUM_START}(\\d{1,2})\\s*(${AMPM})${AMPM_END}`, "g"),
  },
  {
    kind: "dian",
    priority: 5,
    re: new RegExp(`${PERIOD_PART}(?<!第)${NUM_START}(\\d{1,2})\\s*点${DIAN_TAIL}`, "g"),
  },
];

function ampmOf(s: string | undefined): "am" | "pm" | null {
  if (!s) return null;
  return s[0] === "a" ? "am" : "pm";
}

function dianMinute(
  half: string | undefined,
  ke: string | undefined,
  fen: string | undefined,
  bare: string | undefined,
): number | null {
  if (half) return 30;
  if (ke) return ke === "1" ? 15 : 45;
  if (fen !== undefined) return Number(fen);
  if (bare !== undefined) return Number(bare);
  return null;
}

function clockFrom(kind: AtomKind, m: RegExpExecArray, cjkOne: boolean): Clock {
  const hourText = m[2];
  const base = {
    period: m[1] ?? null,
    hour: Number(hourText),
    zeroPadded: hourText.length === 2 && hourText[0] === "0",
    cjkOne,
  };
  switch (kind) {
    case "colon":
    case "dotAmpm":
      return { ...base, minute: Number(m[3]), ampm: ampmOf(m[4]), hasTail: true };
    case "dot":
      return { ...base, minute: Number(m[3]), ampm: null, hasTail: true };
    case "ampm":
      return { ...base, minute: 0, ampm: ampmOf(m[3]), hasTail: true };
    case "dian": {
      const minute = dianMinute(m[3], m[4], m[5], m[6]);
      return { ...base, minute: minute ?? 0, ampm: null, hasTail: minute !== null || !!m[7] };
    }
  }
}

// ── 3. morning / afternoon ───────────────────────────────────────────────────────────────────

const MORNING = new Set(["早上", "早晨", "早", "上午"]);
const AFTERNOON = new Set(["下午", "午后", "傍晚", "晚上", "晚", "今晚", "夜里"]);
/** 「晚上12点」 crosses midnight: ambiguous, not recognised (ui-spec §18 step 3). */
const EVENING = new Set(["傍晚", "晚上", "晚", "今晚", "夜里"]);

/** 24-hour value, or null when the expression is not a valid time. */
function resolveHour(c: Clock): number | null {
  const h = c.hour;
  if (h > 23 || c.minute > 59) return null;
  if (c.ampm) {
    if (h > 12) return h; // 「15:30pm」: already 24-hour, no +12
    if (c.ampm === "am") return h === 12 ? 0 : h;
    return h < 12 ? h + 12 : 12;
  }
  const p = c.period;
  if (p === "凌晨") return h === 12 ? 0 : h;
  if (p && MORNING.has(p)) return h;
  if (p === "中午") return h === 1 || h === 2 ? h + 12 : h;
  if (p && AFTERNOON.has(p)) {
    if (h === 12) return EVENING.has(p) ? null : 12;
    return h < 12 ? h + 12 : h;
  }
  if (c.zeroPadded) return h;
  return h >= 1 && h <= 6 ? h + 12 : h;
}

/** 「吃一点」「早一点」: a bare Chinese 「一点」 needs minutes / 「钟」 / a two-char period word. */
function isYiDian(c: Clock): boolean {
  return c.cjkOne && !c.hasTail && (c.period === null || c.period.length < 2);
}

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hourIndex(m: RegExpExecArray): number {
  return m.index + m[0].search(/\d/);
}

// ── 3b. English patterns ─────────────────────────────────────────────────────────────────────

/** English period word → the Chinese one with the same step-3 rule. */
const EN_PERIOD: Record<string, string> = {
  "in the morning": "早上",
  "this morning": "早上",
  morning: "早上",
  "in the afternoon": "下午",
  "this afternoon": "下午",
  afternoon: "下午",
  "in the evening": "晚上",
  "this evening": "晚上",
  evening: "晚上",
  "at night": "晚上",
  tonight: "今晚",
};

const enWords = (list: string[]) => list.map((w) => w.replace(/ /g, "\\s+")).join("|");
const enPeriod = (word: string) => EN_PERIOD[word.replace(/\s+/g, " ")] ?? null;

/** Before the hour: "tonight at 8", "this afternoon 3:30". A bare "morning" needs at / @. */
const EN_PERIOD_BEFORE = enWords([
  "this morning",
  "this afternoon",
  "this evening",
  "tonight",
  "morning",
  "afternoon",
  "evening",
]);
const EN_NEEDS_AT = new Set(["morning", "afternoon", "evening"]);
/** After the hour: "8 tonight", "3 in the afternoon", "10 at night". */
const EN_PERIOD_AFTER = enWords([
  "in the morning",
  "in the afternoon",
  "in the evening",
  "this morning",
  "this afternoon",
  "this evening",
  "at night",
  "tonight",
]);
/** Hour, optional :MM / .MM, am / pm, o'clock (「点钟」 after step 1). Groups: hour, minute, am/pm. */
const EN_CLOCK = `${NUM_START}(\\d{1,2})(?:[:.](\\d{2})(?!\\d))?(?:\\s*(${AMPM})${AMPM_END})?(?:\\s*点钟)?`;
/** A time that runs on into a range ("tonight 3-5pm") is left to the range. */
const NOT_RANGE = "(?!\\s*(?:-|~|–|—|到|至|(?:to|until|till)(?![a-z])))";
// Groups: word, at / @, hour, minute, am/pm.
const EN_BEFORE_RE = new RegExp(
  `(?<![a-z])(${EN_PERIOD_BEFORE})\\s*(?:(at|@)\\s*)?${EN_CLOCK}(?![\\d:a-z点]|\\.\\d)${NOT_RANGE}`,
  "g",
);
// Groups: hour, minute, am/pm, word.
const EN_AFTER_RE = new RegExp(`${EN_CLOCK}\\s*(${EN_PERIOD_AFTER})(?![a-z])`, "g");
/** A bare hour right after at / @ ("dinner at 8"): read like 「8点」. Groups: hour, minute. */
const EN_AT_RE = new RegExp(
  `(?<=(?:^|[^a-z])at\\s*|@\\s*)${NUM_START}(\\d{1,2})(?:\\.(\\d{2}))?(?![\\d:]|\\.\\d)`,
  "g",
);

/** "at" / "@" / "from" right before the time goes with it ("dinner at 8pm" → "dinner"). */
const LEAD_IN = /(?:(?<![a-z])(?:at|from)|@)\s*$/;

function enClock(
  period: string | null,
  hourText: string,
  mm: string | undefined,
  ap: string | undefined,
): Clock {
  return {
    period,
    ampm: ampmOf(ap),
    hour: Number(hourText),
    minute: mm === undefined ? 0 : Number(mm),
    zeroPadded: hourText.length === 2 && hourText[0] === "0",
    cjkOne: false,
    hasTail: true,
  };
}

function englishCandidates(n: Norm): Candidate[] {
  const out: Candidate[] = [];
  const add = (m: RegExpExecArray, priority: number, c: Clock) => {
    const h = resolveHour(c);
    if (h === null) return;
    const end = m.index + m[0].length;
    out.push({ start: m.index, end, priority, time: hhmm(h, c.minute), endTime: null });
  };
  for (const re of [EN_BEFORE_RE, EN_AFTER_RE, EN_AT_RE]) re.lastIndex = 0;
  for (let m = EN_BEFORE_RE.exec(n.s); m; m = EN_BEFORE_RE.exec(n.s)) {
    const word = m[1].replace(/\s+/g, " ");
    if (EN_NEEDS_AT.has(word) && !m[2]) continue;
    add(m, 1.5, enClock(enPeriod(word), m[3], m[4], m[5]));
  }
  for (let m = EN_AFTER_RE.exec(n.s); m; m = EN_AFTER_RE.exec(n.s)) {
    add(m, 1.5, enClock(enPeriod(m[4]), m[1], m[2], m[3]));
  }
  for (let m = EN_AT_RE.exec(n.s); m; m = EN_AT_RE.exec(n.s)) {
    add(m, 7, enClock(null, m[1], m[2], undefined));
  }
  return out;
}

function singleCandidates(n: Norm): Candidate[] {
  const out: Candidate[] = [];
  for (const atom of ATOMS) {
    atom.re.lastIndex = 0;
    for (let m = atom.re.exec(n.s); m; m = atom.re.exec(n.s)) {
      const c = clockFrom(atom.kind, m, n.cjk[hourIndex(m)] && m[2] === "1");
      if (isYiDian(c)) continue;
      const h = resolveHour(c);
      if (h === null) continue;
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        priority: atom.priority,
        time: hhmm(h, c.minute),
        endTime: null,
      });
    }
  }
  // 6. only 「中午」 → 12:00 (「中午1点」 is a 「点」 match above).
  const noon = /中午(?!\s*\d)/g;
  for (let m = noon.exec(n.s); m; m = noon.exec(n.s)) {
    out.push({ start: m.index, end: m.index + 2, priority: 6, time: "12:00", endTime: null });
  }
  return out;
}

// Range: <start>(-|~|–|—|到|至|to|until|till)<end> [English period word]. At least one side
// carries 「点」 / 「:」 / am-pm; a bare side inherits 「点」 or am / pm from the other one (「3-5点」,
// "3-5pm", "3pm-5"); a period word after the range marks both sides ("3-5 in the afternoon").
const RANGE_SIDE =
  `${PERIOD_PART}${NUM_START}(\\d{1,2})` +
  `(?:(:)(\\d{2})(?!\\d)|\\s*(点)${DIAN_TAIL})?` +
  `(?:\\s*(${AMPM})${AMPM_END})?`;
const RANGE_SEP = "(?:-|~|–|—|到|至|(?<![a-z])(?:to|until|till)(?![a-z]))";
const RANGE_RE = new RegExp(
  `${RANGE_SIDE}\\s*${RANGE_SEP}\\s*${RANGE_SIDE.replace(NUM_START, "")}` +
    `(?:\\s*(${EN_PERIOD_AFTER})(?![a-z]))?`,
  "g",
);
const SIDE_GROUPS = 11;

type Side = Clock & { form: "colon" | "dian" | "bare" };

function sideFrom(g: (string | undefined)[], cjkOne: boolean): Side {
  const [period, hourText = "", colon, mm, dian, half, ke, fen, bare, zhong, ap] = g;
  const ampm = ampmOf(ap);
  let minute: number | null = null;
  let form: Side["form"] = "bare";
  if (colon) {
    form = "colon";
    minute = Number(mm);
  } else if (dian) {
    form = "dian";
    minute = dianMinute(half, ke, fen, bare);
  }
  return {
    period: period ?? null,
    ampm,
    hour: Number(hourText),
    minute: minute ?? 0,
    zeroPadded: hourText.length === 2 && hourText[0] === "0",
    cjkOne,
    hasTail: minute !== null || !!zhong || !!ampm,
    form,
  };
}

function rangeCandidates(n: Norm): Candidate[] {
  const out: Candidate[] = [];
  RANGE_RE.lastIndex = 0;
  for (let m = RANGE_RE.exec(n.s); m; m = RANGE_RE.exec(n.s)) {
    // Retry from the next char, so a failed range does not hide a later match.
    RANGE_RE.lastIndex = m.index + 1;
    const a = sideFrom(m.slice(1, 1 + SIDE_GROUPS), n.cjk[hourIndex(m)] && m[2] === "1");
    const b = sideFrom(m.slice(1 + SIDE_GROUPS, 1 + 2 * SIDE_GROUPS), false);
    // "3-5pm": a bare / colon start without a period word takes the end's am / pm.
    const inherit =
      b.ampm !== null && a.ampm === null && a.period === null && a.form !== "dian" && !a.zeroPadded;
    const tail = m[1 + 2 * SIDE_GROUPS];
    const period = tail ? enPeriod(tail) : null;
    if (period !== null) {
      if (b.period === null && b.ampm === null) b.period = period;
      if (!inherit && a.period === null && a.ampm === null) a.period = period;
    }
    const aMarked =
      a.form !== "bare" || a.ampm !== null || b.form === "dian" || inherit || period !== null;
    const bMarked =
      b.form !== "bare" ||
      b.ampm !== null ||
      a.form === "dian" ||
      a.ampm !== null ||
      period !== null;
    if (!aMarked || !bMarked) continue;
    let startH = resolveHour(inherit ? { ...a, ampm: b.ampm } : a);
    if (startH === null) continue;
    let endH: number | null;
    if (b.period || b.ampm) {
      endH = resolveHour(b);
    } else if (b.hour > 23 || b.minute > 59) {
      endH = null;
    } else {
      // Inherit the start's half of the day: a start moved to the afternoon moves the end too.
      const shifted = startH >= 12 && a.hour < 12;
      endH = shifted && b.hour < 12 ? b.hour + 12 : b.hour;
    }
    if (endH === null) continue;
    // "11-1pm" is 11:00–13:00: an inherited pm that lands after the end means am.
    if (inherit && b.ampm === "pm" && startH * 60 + a.minute >= endH * 60 + b.minute) {
      startH = resolveHour({ ...a, ampm: "am" });
      if (startH === null) continue;
    }
    if (endH * 60 + b.minute <= startH * 60 + a.minute) {
      // An end with its own am / pm that is not after the start crosses midnight ("10pm-1am").
      if (b.ampm) continue;
      endH += 12;
    }
    if (endH > 23) continue;
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      priority: 1,
      time: hhmm(startH, a.minute),
      endTime: hhmm(endH, b.minute),
    });
  }
  return out;
}

// ── 4. title ─────────────────────────────────────────────────────────────────────────────────

const EDGE_PUNCT = /^[\s，,。、:：;；\-–—~]+|[\s，,。、:：;；\-–—~]+$/g;

/** A sentence-final 「.」「!」「?」 left alone by the cut ("Dinner tonight at 8." → "Dinner ."). */
const STRAY_END = /(?:^|\s)[.!?]+$/;

function tidy(title: string): string {
  return title.replace(/\s+/g, " ").replace(EDGE_PUNCT, "").replace(STRAY_END, "").trim();
}

// ── public API ───────────────────────────────────────────────────────────────────────────────

/** 「下午3点半和 A 喝咖啡」→ { time: "15:30", endTime: null, title: "和 A 喝咖啡" } (ui-spec §18). */
export function parseTime(raw: string): ParsedTime {
  const n = normalize(raw);
  const all = [...rangeCandidates(n), ...singleCandidates(n), ...englishCandidates(n)];
  if (all.length === 0) {
    return { time: null, endTime: null, title: raw.replace(/\s+/g, " ").trim() };
  }
  let best = all[0];
  for (const c of all) {
    if (c.start < best.start || (c.start === best.start && c.priority < best.priority)) best = c;
  }
  const lead = LEAD_IN.exec(n.s.slice(0, best.start));
  const start = lead ? lead.index : best.start;
  const title = tidy(raw.slice(0, n.from[start]) + raw.slice(n.to[best.end - 1]));
  return { time: best.time, endTime: best.endTime, title };
}

/** Time box of the date picker: 「6点」→ "18:00"; null when nothing is recognised. */
export function parseTimeOnly(raw: string): string | null {
  const parsed = parseTime(raw);
  if (parsed.time) return parsed.time;
  // The box only takes times, so a bare hour 「6」 reads as 「6点」.
  const digits = normalize(raw.trim()).s;
  if (/^\d{1,2}$/.test(digits)) return parseTime(`${digits}点`).time;
  return null;
}
