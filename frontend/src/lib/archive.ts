// Archive page derivations (ui-spec §14.4–§14.7).
// Text (group heads, row meta, insights) comes from the i18n `archive.*` keys and follows the
// language active at call time; the zh-Hans output is the ui-spec copy.

import { t } from "@/i18n";
import type { ArchiveEntry, ArchiveGroup, KeyPoint, Snapshot } from "@/types/domain";
import { todayStr } from "./clock";
import { addDays, diffDays, formatMD, formatMDW, mondayOf, monthName } from "./dates";
import { keyPointCounts } from "./keyPoint";
import { dueDelta, usedDays, waitingDays } from "./taskMath";

const bySortKey = (a: KeyPoint, b: KeyPoint) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;

/** Newest first: completion date, then completion moment. */
function newestFirst(a: ArchiveEntry, b: ArchiveEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.at - a.at;
}

/**
 * Every archived item as of `today`: archived tasks + todos done before today, newest first.
 * `archiveEntries(snap)` (the contract) uses the app clock's today; tests and callers that already
 * hold `today` use this one.
 */
export function archiveEntriesAt(snap: Snapshot, today: string): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  for (const todo of snap.todos) {
    if (todo.doneDate === null || todo.doneDate >= today) continue;
    out.push({
      kind: "todo",
      id: todo.id,
      title: todo.title,
      date: todo.doneDate,
      at: todo.doneAt ?? 0,
      todo,
    });
  }
  const kpsByTask = new Map<string, KeyPoint[]>();
  for (const k of snap.keyPoints) {
    const list = kpsByTask.get(k.taskId) ?? [];
    list.push(k);
    kpsByTask.set(k.taskId, list);
  }
  for (const task of snap.tasks) {
    if (task.archivedDate === null) continue;
    const unfinished = task.status !== "done" || task.doneDate === null;
    out.push({
      kind: "task",
      id: task.id,
      title: task.title,
      date: unfinished ? task.archivedDate : (task.doneDate as string),
      at: (unfinished ? task.archivedAt : task.doneAt) ?? task.archivedAt ?? 0,
      task,
      keyPoints: (kpsByTask.get(task.id) ?? []).sort(bySortKey),
      unfinished,
    });
  }
  return out.sort(newestFirst);
}

/** Every archived item: archived tasks + todos done before today (the app clock's today). */
export function archiveEntries(snap: Snapshot): ArchiveEntry[] {
  return archiveEntriesAt(snap, todayStr());
}

/** Thirds of a month (旬): days 1–10, 11–20, 21–end → `archive.group.<xun>`. */
const XUN = ["early", "mid", "late"] as const;

/** 今天 / 昨天 / 本周 / 上周 / 更早（旬） groups, newest first. 「更早」 starts collapsed. */
export function groupArchive(entries: ArchiveEntry[], today: string): ArchiveGroup[] {
  const yesterday = addDays(today, -1);
  const monday = mondayOf(today);
  const lastMonday = addDays(monday, -7);
  const lastSunday = addDays(monday, -1);
  const thisYear = today.slice(0, 4);
  const groups = new Map<string, ArchiveGroup>();

  for (const e of [...entries].sort(newestFirst)) {
    let key: string;
    let label: string;
    let collapsed = false;
    if (e.date >= today) {
      key = "today";
      label = t("archive.group.today", { date: formatMDW(today) });
    } else if (e.date === yesterday) {
      key = "yesterday";
      label = t("archive.group.yesterday", { date: formatMDW(yesterday) });
    } else if (e.date >= monday) {
      const end = addDays(today, -2);
      key = "thisWeek";
      label =
        monday === end
          ? t("archive.group.thisWeekDay", { date: formatMD(monday) })
          : t("archive.group.thisWeek", { from: formatMD(monday), to: formatMD(end) });
    } else if (e.date >= lastMonday) {
      key = "lastWeek";
      label = t("archive.group.lastWeek", { from: formatMD(lastMonday), to: formatMD(lastSunday) });
    } else {
      const [y, m, d] = e.date.split("-");
      const xun = Number(d) <= 10 ? 0 : Number(d) <= 20 ? 1 : 2;
      key = `${y}-${m}-${xun}`;
      const vars = { year: Number(y), month: Number(m), monthName: monthName(Number(m)) };
      label =
        y === thisYear
          ? t(`archive.group.${XUN[xun]}`, vars)
          : t(`archive.group.${XUN[xun]}Year`, vars);
      collapsed = true;
    }
    let g = groups.get(key);
    if (!g) {
      g = { key, label, collapsed, entries: [] };
      groups.set(key, g);
    }
    g.entries.push(e);
  }
  for (const g of groups.values()) {
    if (g.collapsed) {
      g.label = t("archive.group.earlier", { period: g.label, count: g.entries.length });
    }
  }
  return [...groups.values()];
}

/** Row meta (ui-spec §14.5): 「9/20 → 9/30 · 用时 11 天 · 提前 31 天」「9/27 完成 · 逾期 1 天」. */
export function archiveMeta(entry: ArchiveEntry): string {
  if (entry.kind === "todo") {
    const todo = entry.todo;
    const parts = [t("archive.meta.done", { date: formatMD(entry.date) })];
    if (todo.remindDate !== null && entry.date > todo.remindDate) {
      parts.push(t("archive.meta.overdue", { count: diffDays(todo.remindDate, entry.date) }));
    }
    return parts.join(" · ");
  }
  const task = entry.task;
  const parts = [`${formatMD(task.startDate)} → ${formatMD(entry.date)}`];
  if (entry.unfinished) {
    parts.push(t("archive.meta.unfinished"));
    return parts.join(" · ");
  }
  const steps = keyPointCounts(entry.keyPoints).total;
  if (steps > 0) parts.push(t("archive.meta.used", { count: usedDays(task) }));
  const delta = dueDelta(task);
  if (delta) {
    if (delta.kind === "early") parts.push(t("archive.meta.early", { count: delta.days }));
    else if (delta.kind === "onTime") parts.push(t("archive.meta.onTime"));
    else parts.push(t("archive.meta.late", { count: delta.days }));
  } else if (steps > 0) {
    parts.push(t("archive.meta.keyPoints", { count: steps }));
  }
  return parts.join(" · ");
}

/** Display width: CJK / full-width chars count 1, ASCII ½ (「续费 orbit」 = 5). */
function charWidth(ch: string): number {
  return ch.charCodeAt(0) < 0x2e80 ? 0.5 : 1;
}

/** Titles longer than 6 字 are cut: 「续费 orbit 域名」→「续费 orbit…」. */
function shortTitle(title: string, max = 6): string {
  let w = 0;
  for (const ch of title) w += charWidth(ch);
  if (w <= max) return title;
  let out = "";
  w = 0;
  for (const ch of title) {
    if (w + charWidth(ch) > max) break;
    w += charWidth(ch);
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/**
 * This month's archived counts and insights (ui-spec §14.7). 「这个月」 = the calendar month of
 * `today`, by completion date; counts = done and archived (archived-unfinished tasks are not
 * 「做完了」).
 */
export function monthStats(
  snap: Snapshot,
  today: string,
): { todos: number; tasks: number; insights: string[] } {
  const month = today.slice(0, 7);
  const entries = archiveEntriesAt(snap, today).filter(
    (e) => e.date.slice(0, 7) === month && !(e.kind === "task" && e.unfinished),
  );
  const todos = entries.filter((e) => e.kind === "todo");
  const tasks = entries.flatMap((e) => (e.kind === "task" ? [e] : []));
  const insights: string[] = [];

  // 1. 任务 n 件里 k 件提前完成
  const early = tasks.filter((e) => dueDelta(e.task)?.kind === "early").length;
  if (tasks.length > 0 && early > 0) {
    insights.push(t("archive.insight.early", { count: tasks.length, early }));
  }

  // 2. 有关键点的任务平均用时 avg 天，其中等别人占 p
  const withSteps = tasks.filter((e) => keyPointCounts(e.keyPoints).total > 0);
  if (withSteps.length > 0) {
    let used = 0;
    let waiting = 0;
    for (const e of withSteps) {
      used += usedDays(e.task);
      waiting += waitingDays(e.task, e.keyPoints, today);
    }
    const avg = Math.round(used / withSteps.length);
    let text = t("archive.insight.avgDays", { count: avg });
    if (waiting > 0 && used > 0) {
      const r = waiting / used;
      text +=
        r >= 0.45 && r <= 0.55
          ? t("archive.insight.waitingHalf")
          : t("archive.insight.waitingPct", { pct: Math.round(r * 100) });
    }
    insights.push(text);
  }

  // 3. 逾期的只有 m 件（标题）
  const late = entries.filter((e) =>
    e.kind === "todo"
      ? e.todo.remindDate !== null && e.date > e.todo.remindDate
      : dueDelta(e.task)?.kind === "late",
  );
  if (entries.length > 0) {
    if (late.length === 0) insights.push(t("archive.insight.noOverdue"));
    else if (late.length >= 3) {
      insights.push(t("archive.insight.overdueMany", { count: late.length }));
    } else {
      const titles = late.map((e) => shortTitle(e.title)).join(t("archive.insight.titleSeparator"));
      insights.push(t("archive.insight.overdueFew", { count: late.length, titles }));
    }
  }

  return { todos: todos.length, tasks: tasks.length, insights };
}

/** Case-insensitive search over titles, key points, notes and summaries. Empty query → all. */
export function searchArchive(entries: ArchiveEntry[], q: string): ArchiveEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return entries;
  const hit = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle);
  return entries.filter((e) =>
    e.kind === "todo"
      ? hit(e.title)
      : hit(e.title) || hit(e.task.summary) || e.keyPoints.some((k) => hit(k.text)),
  );
}

/** Toolbar 「归档 N」 = monthStats todos + tasks. */
export function archiveBadgeCount(snap: Snapshot, today: string): number {
  const { todos, tasks } = monthStats(snap, today);
  return todos + tasks;
}
