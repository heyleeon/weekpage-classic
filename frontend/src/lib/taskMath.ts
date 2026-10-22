// Task status and time arithmetic (ui-spec §0.5, §8.4, §13.3, §20).
//
// Notation (ui-spec §20.1): today T, start S, due D (optional), done C. diff(a, b) = b − a in days.
// Texts come from the i18n `timeBar.*` keys (active language at call time; zh-Hans is the spec copy).

import { t } from "@/i18n";
import type {
  DetailTrackView,
  DisplayStatus,
  KeyPoint,
  MarkerKind,
  Task,
  TextTone,
  TimeBarLabel,
  TimeBarView,
} from "@/types/domain";
import { addDays, diffDays, formatMD, formatMDW } from "./dates";
import { keyPointCounts, markerOf, overdueDays } from "./keyPoint";

/** 推进中 / 等待中 / 已完成 / 逾期 / 未开始 (ui-spec §0.5). */
export function displayStatus(task: Task, today: string): DisplayStatus {
  if (task.status === "done") return "done";
  if (task.dueDate !== null && today > task.dueDate) return "overdue";
  if (today < task.startDate) return "upcoming";
  return task.status;
}

const label = (text: string, tone: TimeBarLabel["tone"], strong = false): TimeBarLabel => ({
  text,
  tone,
  strong,
});

/** Lower row 「9/29 开始」……「10/2 截止」, both muted: red is for what is urgent, and the
 *  headline already says that (ui-spec §8.4). */
function bottomRow(task: Task): { start: TimeBarLabel; end: TimeBarLabel } | null {
  if (task.dueDate === null) return null;
  return {
    start: label(t("timeBar.start", { date: formatMD(task.startDate) }), "muted"),
    end: label(t("timeBar.due", { date: formatMD(task.dueDate) }), "muted"),
  };
}

/** The due date is shown red only when it bites: due today or past, and not done (ui-spec §8.4,
 *  §10.1). */
export function dueUrgent(task: Pick<Task, "status" | "dueDate">, today: string): boolean {
  return task.status !== "done" && task.dueDate !== null && today >= task.dueDate;
}

const noDueText = (task: Task) => t("timeBar.noDue", { date: formatMD(task.startDate) });

/** 「今天完成」/「昨天完成」/「9/28 完成」. */
function doneWhen(done: string, today: string): string {
  const d = diffDays(done, today);
  if (d === 0) return t("timeBar.doneToday");
  if (d === 1) return t("timeBar.doneYesterday");
  return t("timeBar.doneOn", { date: formatMD(done) });
}

/** Card time bar texts and fill (ui-spec §8.4, §20). */
export function timeBar(task: Task, kps: KeyPoint[], today: string): TimeBarView {
  const view = timeBarTexts(task, kps, today);
  return {
    ...view,
    ends: {
      start: formatMD(task.startDate),
      due: task.dueDate === null ? null : formatMD(task.dueDate),
    },
    ...headlineOf(view, displayStatus(task, today), task.dueDate !== null),
  };
}

/**
 * Which of the two sentences leads (ui-spec §8.4, §10.2): the one that counts days left / past /
 * to go, set large; the other one is the quiet aside (the detail shows it on the right; none
 * without a due date or when overdue — the chips already say 「不设截止」 / the due date).
 */
function headlineOf(
  view: Omit<TimeBarView, "ends" | "headline" | "aside">,
  status: DisplayStatus,
  hasDue: boolean,
): Pick<TimeBarView, "headline" | "aside"> {
  const bold = (l: TimeBarLabel, tone: TextTone = l.tone): TimeBarLabel => ({
    ...l,
    tone,
    strong: true,
  });
  const quiet = (l: TimeBarLabel): TimeBarLabel => ({ ...l, tone: "muted", strong: false });
  const { topLeft, topRight } = view;
  if (status === "upcoming" && topRight)
    return { headline: bold(topRight, "subtle"), aside: quiet(topLeft) };
  // No due date: 「已进行 N 天」 / 「今天完成 · 用时 N 天」 count from the start.
  if (!hasDue || !topRight) return { headline: bold(topLeft), aside: null };
  // 「还剩 X 天」 reads at the normal text colour; overdue / due today / late are red already.
  // Overdue's other sentence is only 「截止 9/28 周一」, which the due chip already says.
  return {
    headline: bold(topRight, topRight.tone === "muted" ? "text" : topRight.tone),
    aside: status === "overdue" ? null : quiet(topLeft),
  };
}

/**
 * The headline split around its day count, so the card can set the number large: 「还剩 25 天」 →
 * ["还剩 ", "25", " 天"], 「Day 25」 → ["Day ", "25", ""]. The last whole number that is not
 * part of a date (「9/28 完成 · 用时 11 天」 → 11); null when there is none (「今天截止」).
 */
export function countParts(text: string): [string, string, string] | null {
  const runs = [...text.matchAll(/(?<![\d/.:])\d+(?![\d/.:])/g)];
  const last = runs.at(-1);
  if (last?.index === undefined) return null;
  const end = last.index + last[0].length;
  return [text.slice(0, last.index), last[0], text.slice(end)];
}

function timeBarTexts(
  task: Task,
  kps: KeyPoint[],
  today: string,
): Omit<TimeBarView, "ends" | "headline" | "aside"> {
  const S = task.startDate;
  const D = task.dueDate;
  const status = displayStatus(task, today);

  if (status === "done") {
    const C = task.doneDate ?? today;
    const delta = dueDelta(task);
    let topRight: TimeBarLabel;
    if (delta === null) topRight = label(noDueText(task), "muted");
    else if (delta.kind === "early")
      topRight = label(t("timeBar.early", { count: delta.days }), "st");
    else if (delta.kind === "onTime") topRight = label(t("timeBar.onTime"), "st");
    else topRight = label(t("timeBar.late", { count: delta.days }), "du");
    const used = t("timeBar.used", { when: doneWhen(C, today), count: usedDays(task) });
    return {
      topLeft: label(used, "st", true),
      topRight,
      fill: 1,
      fillTone: "done",
      bottom: bottomRow(task),
    };
  }

  if (status === "overdue" && D !== null) {
    return {
      topLeft: label(t("timeBar.dueOn", { date: formatMDW(D) }), "du", true),
      topRight: label(t("timeBar.overdue", { count: diffDays(D, today) }), "du", true),
      fill: 1,
      fillTone: "du",
      bottom: bottomRow(task),
    };
  }

  if (status === "upcoming") {
    const left =
      D === null
        ? noDueText(task)
        : t("timeBar.span", { date: formatMD(S), count: diffDays(S, D) + 1 });
    return {
      topLeft: label(left, "subtle", true),
      topRight: label(t("timeBar.startsIn", { count: diffDays(today, S) }), "muted"),
      fill: 0,
      fillTone: "none",
      bottom: bottomRow(task),
    };
  }

  // Active / waiting.
  const tone = status === "waiting" ? "rm" : "st";
  const N = diffDays(S, today) + 1;
  if (D === null) {
    const { total, done } = keyPointCounts(kps.filter((k) => k.taskId === task.id));
    return {
      topLeft: label(t("timeBar.elapsed", { n: N }), "text", true),
      topRight: label(noDueText(task), "muted"),
      fill: total === 0 ? 0 : done / total,
      fillTone: total === 0 ? "none" : tone,
      bottom: null,
    };
  }
  const M = diffDays(S, D) + 1;
  const X = diffDays(today, D);
  return {
    topLeft: label(t("timeBar.dayOf", { n: N, m: M }), "text", true),
    topRight:
      X === 0
        ? label(t("timeBar.dueToday"), "du")
        : label(t("timeBar.left", { count: X }), "muted"),
    fill: Math.min(1, Math.max(0, N / M)),
    fillTone: tone,
    bottom: bottomRow(task),
  };
}

/** Completion date: done date, else (archived unfinished) the archive date. */
function endDate(task: Task): string | null {
  return task.doneDate ?? task.archivedDate;
}

/** 「用时 N 天」 = diff(min(S, C), C) + 1 for a done task (archived unfinished: up to the archive
 *  date); 0 when neither exists. */
export function usedDays(task: Task): number {
  const C = endDate(task);
  if (C === null) return 0;
  const from = task.startDate < C ? task.startDate : C;
  return diffDays(from, C) + 1;
}

/** Done vs due: early / on time / late by N days; null without due or not done. */
export function dueDelta(task: Task): { kind: "early" | "onTime" | "late"; days: number } | null {
  const C = task.doneDate;
  const D = task.dueDate;
  if (C === null || D === null) return null;
  if (C < D) return { kind: "early", days: diffDays(C, D) };
  if (C > D) return { kind: "late", days: diffDays(D, C) };
  return { kind: "onTime", days: 0 };
}

/**
 * Days spent waiting on others (ui-spec §13.3): for every 「等别人」 key point
 * that is done or being waited on, from `currentSince` (only old rows have one: the removed
 * 「设为当前」 stamped it; else the previous key point's done date; else the task start) to its
 * done date or today. 「Being waited on」 = the first open step once the task has started: the
 * rule that used to pick the 「当前」 step, kept only for this count (2026-10-02, nothing shows it).
 */
export function waitingDays(task: Task, kps: KeyPoint[], today: string): number {
  const steps = kps
    .filter((k) => k.taskId === task.id && k.kind !== "note")
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  // A task marked done straight from the status menu leaves its open steps unticked: its first
  // open one was being waited on until the task's done date (§13.3).
  const done = task.status === "done";
  const waitedOn =
    done || today >= task.startDate ? (steps.find((k) => k.doneDate === null)?.id ?? null) : null;
  let total = 0;
  steps.forEach((k, i) => {
    if (k.kind !== "wait") return;
    if (k.doneDate === null && k.id !== waitedOn) return;
    const from = k.currentSince ?? steps[i - 1]?.doneDate ?? task.startDate;
    const to = k.doneDate ?? (done ? (task.doneDate ?? today) : today);
    total += Math.max(0, diffDays(from, to));
  });
  return total;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Loudest first: a cluster of markers on the track shows its top one. */
const MARKER_RANK: Record<MarkerKind, number> = { idle: 1, done: 0, wait: 2, check: 3, overdue: 4 };

/** Every dated step (notes are records, not plan: they stay off the track) as a marker on a track
 *  of `m` days from the start, with the step's own icon (✓ done, ! overdue, bell, hourglass).
 *  Markers merge only when they cannot sit apart: closer than `gap` (a share of the track width,
 *  0 = same day only). The loudest marker wins, the tip lists them all. */
function trackDots(task: Task, kps: KeyPoint[], today: string, m: number, gap: number) {
  const dots = kps
    .filter((k) => k.taskId === task.id && k.kind !== "note" && k.date !== null)
    .map((k) => ({
      k,
      at: clamp01((diffDays(task.startDate, k.date as string) + 1) / m),
      marker: markerOf(k, overdueDays(k, task, today) > 0),
    }))
    .sort((a, b) => a.at - b.at);
  const groups: (typeof dots)[] = [];
  for (const d of dots) {
    const g = groups[groups.length - 1];
    if (g && d.at - g[0].at <= gap) g.push(d);
    else groups.push([d]);
  }
  return groups
    .map((g) => {
      const top = g.reduce((a, b) => (MARKER_RANK[b.marker] > MARKER_RANK[a.marker] ? b : a));
      return {
        keyPointId: top.k.id,
        at: g[0].at,
        marker: top.marker,
        count: g.length,
        tip: g.map((d) => `${formatMD(d.k.date as string)} · ${d.k.text}`).join("\n"),
      };
    })
    .sort((a, b) => MARKER_RANK[a.marker] - MARKER_RANK[b.marker]);
}

/**
 * The today tick, unless a step marker sits on it (closer than half a marker): the marker, drawn
 * over the line, stands for today — a black line through a ✓ reads as a glitch (ui-spec §10.2).
 */
function tickAt(todayAt: number | null, dots: { at: number }[], gap: number): number | null {
  if (todayAt === null) return null;
  return dots.some((d) => Math.abs(d.at - todayAt) <= gap / 2 + 1e-9) ? null : todayAt;
}

/** Scale steps of the open-ended track (days). */
const HORIZONS = [7, 14, 30, 60, 90, 180, 365, 730];

/** Smallest scale that leaves ~20% free room after `days` (the track is open at the right). */
function horizon(days: number): number {
  const need = days * 1.25;
  return HORIZONS.find((h) => h >= need) ?? Math.ceil(need);
}

/** Detail view time block (ui-spec §10.2, §20.1 last rows). With a due date the track is the
 *  task's span; without one it is open-ended: a scale that grows with the days passed (and the
 *  latest dated step), today at its edge. Every dated step except notes gets a dot. */
export function detailTrack(
  task: Task,
  kps: KeyPoint[],
  today: string,
  /** Markers closer than this share of the track width merge (0 = only the same day). */
  gap = 0,
): DetailTrackView {
  const bar = timeBar(task, kps, today);
  const S = task.startDate;
  const D = task.dueDate;
  const dated = kps.filter((k) => k.taskId === task.id && k.kind !== "note" && k.date !== null);
  if (D === null) {
    const status = displayStatus(task, today);
    const upcoming = status === "upcoming";
    const end = status === "done" ? (task.doneDate ?? today) : today;
    const passed = upcoming ? 0 : Math.max(1, diffDays(S, end) + 1);
    const lastDated = dated.reduce((m, k) => Math.max(m, diffDays(S, k.date as string) + 1), 0);
    const M = horizon(Math.max(passed, lastDated, 1));
    const fillTone =
      status === "done" ? "done" : upcoming ? "none" : status === "waiting" ? "rm" : "st";
    const dots = trackDots(task, kps, today, M, gap);
    return {
      bar: { ...bar, fill: passed / M, fillTone },
      todayAt: tickAt(status === "done" || upcoming ? null : passed / M, dots, gap),
      dots,
      dueDot: false,
      dueAt: null,
      extendTo: null,
      lateCount: 0,
      remindDate: null,
    };
  }
  const M = diffDays(S, D) + 1;
  // Steps dated after the due date stretch the track to the latest one: the due dot moves to its
  // real day and the stretch after it is drawn as a dashed tail.
  const last = dated.reduce((m, k) => ((k.date as string) > m ? (k.date as string) : m), D);
  const span = diffDays(S, last) + 1;
  const dueAt = M / span;
  const todayAt = today >= S && today <= last ? (diffDays(S, today) + 1) / span : null;
  let fill = bar.fill;
  if (span > M) {
    const status = displayStatus(task, today);
    const end = status === "done" ? (task.doneDate ?? today) : today;
    fill = status === "upcoming" ? 0 : clamp01((diffDays(S, end) + 1) / span);
  }
  // An unfinished task with an open step after its due date: offer to move the due date there.
  const late =
    task.status === "done"
      ? []
      : dated.filter((k) => k.doneDate === null && (k.date as string) > D);
  const lateOpen = late.reduce<string | null>(
    (m, k) => (m === null || (k.date as string) > m ? (k.date as string) : m),
    null,
  );
  const dots = trackDots(task, kps, today, span, gap);
  return {
    bar: { ...bar, fill },
    todayAt: tickAt(todayAt, dots, gap),
    dots,
    dueDot: true,
    dueAt,
    extendTo: lateOpen,
    lateCount: late.length,
    remindDate: addDays(D, -1),
  };
}
