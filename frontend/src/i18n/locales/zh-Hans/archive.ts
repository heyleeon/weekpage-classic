// zh-Hans · archive — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Covers components/archive/** (toolbar 「归档 N」, archive page, rows, month sidebar) and the
// derived text of lib/archive.ts (group heads, row meta, month insights).

const archive = {
  toolbar: {
    label: "归档",
    back: "回到任务页",
    open: "打开归档",
  },
  page: {
    label: "归档",
    filterLabel: "筛选归档",
    all: "全部",
    todo: "待办",
    task: "任务",
    searchLabel: "搜归档",
    searchPlaceholder: "搜归档，比如「美卡」",
    clearSearch: "清空搜索",
    emptyTitle: "这里还没有东西",
    emptyText: "做完的待办第二天会自动收进来，任务点「归档」收进来",
    /** Value: q (the search text). */
    notFound: "没找到「{{q}}」",
    emptyFilter: "这一类还没有归档",
  },
  row: {
    task: "任务",
    todo: "待办",
    restore: "恢复",
    viewAll: "查看全部记录",
    restoreToTasks: "恢复到任务页",
    /** A note node of the expanded timeline. Values: who (`detail.who.*`), text. */
    note: "{{who}}：{{text}}",
  },
  sidebar: {
    title: "这个月做完了",
    todos: "待办",
    tasks: "任务",
    rulesTitle: "归档规则",
    rules: {
      todos: "待办：勾掉后第二天早上自动归档",
      tasks: "任务：手动点归档，过期不收就变红",
      keyPoints: "有关键点的：归档时确认一次",
    },
  },
  /** Group heads (lib/archive.ts groupArchive). Dates are formatMD / formatMDW text. */
  group: {
    today: "今天 · {{date}}",
    yesterday: "昨天 · {{date}}",
    /** 本周 when Monday is the day before yesterday (a single day). */
    thisWeekDay: "本周 · {{date}}",
    thisWeek: "本周 · {{from}} – {{to}}",
    lastWeek: "上周 · {{from}} – {{to}}",
    /** Thirds of a month (旬). Values: month (number), monthName (`common.date.month.*`). */
    early: "{{month}} 月上旬",
    mid: "{{month}} 月中旬",
    late: "{{month}} 月下旬",
    /** Same, for another year. Extra value: year. */
    earlyYear: "{{year}} 年 {{month}} 月上旬",
    midYear: "{{year}} 年 {{month}} 月中旬",
    lateYear: "{{year}} 年 {{month}} 月下旬",
    /** 「更早 · 9 月上旬 4 条」. Values: period (one of the above), count. */
    earlier_one: "更早 · {{period}} {{count}} 条",
    earlier_other: "更早 · {{period}} {{count}} 条",
  },
  /** Row meta (lib/archive.ts archiveMeta), joined with 「 · 」. */
  meta: {
    done: "{{date}} 完成",
    overdue_one: "逾期 {{count}} 天",
    overdue_other: "逾期 {{count}} 天",
    unfinished: "没做完",
    used_one: "用时 {{count}} 天",
    used_other: "用时 {{count}} 天",
    early_one: "提前 {{count}} 天",
    early_other: "提前 {{count}} 天",
    onTime: "按时",
    late_one: "晚了 {{count}} 天",
    late_other: "晚了 {{count}} 天",
    keyPoints_one: "{{count}} 个关键点",
    keyPoints_other: "{{count}} 个关键点",
  },
  /** Month sidebar insights (lib/archive.ts monthStats). */
  insight: {
    /** Values: count (tasks), early. */
    early_one: "任务 {{count}} 件里 {{early}} 件提前完成",
    early_other: "任务 {{count}} 件里 {{early}} 件提前完成",
    /** Value: count (average days). Followed by waitingHalf / waitingPct when there was waiting. */
    avgDays_one: "有关键点的任务平均用时 {{count}} 天",
    avgDays_other: "有关键点的任务平均用时 {{count}} 天",
    waitingHalf: "，其中等别人占一半",
    /** Value: pct (0–100). */
    waitingPct: "，其中等别人占{{pct}}%",
    noOverdue: "这个月没有逾期",
    overdueMany_one: "逾期的有 {{count}} 件",
    overdueMany_other: "逾期的有 {{count}} 件",
    /** Values: count, titles (short titles joined with titleSeparator). */
    overdueFew_one: "逾期的只有 {{count}} 件（{{titles}}）",
    overdueFew_other: "逾期的只有 {{count}} 件（{{titles}}）",
    titleSeparator: "、",
  },
};

export default archive;
