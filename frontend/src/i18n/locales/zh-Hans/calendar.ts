// zh-Hans · calendar — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// The calendar page (components/calendar): grid, day heads, items, double-click input, drag (same
// day = reorder, another day = move) and the today pill. Weekday / month words come from lib/dates.ts (common.date.*);
// holiday, solar term and 补班 labels from the `holidays` section.
// `pill.*` strings are rendered with <Trans>: <b>…</b> = the bold number, <task/> = the task title
// (user text, never interpolated into the string).

const calendar = {
  /** Screen-reader name of the calendar page. */
  pageLabel: "日历",
  /** Tooltip on today's date circle in the day head. */
  today: "今天",
  /** Drop placeholder while an item is dragged (ui-spec §2.7). */
  dropHere: "放到这里",
  /** Screen-reader announcements of a drag (dnd-kit). */
  drag: {
    pickedUp: "已拿起条目",
    dropped: "已放下",
    cancelled: "已取消拖动",
    instructions: "拖动条目可调整顺序，或拖到别的日子；拖到网格上下边缘停一下会翻周",
  },
  /** Toast after dropping an item on another day: 「已移到 10月3日」 (day = monthDayLabel). */
  movedToast: "已移到 {{day}}",
  /** Toast when a drop on another day is refused (the item goes back). */
  moveRejected: {
    startAfterDue: "开始日不能晚于截止日",
    dueBeforeStart: "截止日不能早于开始日",
    locked: "已归档任务的日期不能改",
  },
  /** Double-click input (ui-spec §2.6). */
  input: {
    /** Accessible name for a new event: 「10/6 新日程」. md = formatMD, monthDay = monthDayLabel. */
    newLabel: "{{md}} 新日程",
    /** Accessible name when an item is edited in place: 「修改「看房」」. */
    editLabel: "修改「{{title}}」",
    /** Preview line 「↳ …」 states. */
    previewEmpty: "打字，时间会自动识别",
    previewUntimed: "不带时间",
    previewNoTitle: "还差个标题",
  },
  /** Toast after deleting an event (ui-spec §15.3). */
  deletedToast: "已删除「{{title}}」",
  /** Today pill (ui-spec §3). */
  pill: {
    /** One overdue step (ui-spec §9.3). */
    overdue: "<task/> 有 <b>1</b> 步逾期",
    /** Several overdue steps: the first one's task; count = all of them. */
    overdueMore_one: "<task/> 等 <b>{{count}}</b> 步逾期",
    overdueMore_other: "<task/> 等 <b>{{count}}</b> 步逾期",
    todos_one: "<b>{{count}}</b> 件待办",
    todos_other: "<b>{{count}}</b> 件待办",
    dueToday: "<task/> <b>今天截止</b>",
    /** count = days left. */
    dueIn_one: "<task/> 还剩 <b>{{count}}</b> 天",
    dueIn_other: "<task/> 还剩 <b>{{count}}</b> 天",
    check: "<task/> <b>明天</b> 去查",
    /** Several tasks to check tomorrow: count = the others, total = all of them. */
    checkMore_one: "<task/> 等 {{total}} 项 <b>明天</b> 去查",
    checkMore_other: "<task/> 等 {{total}} 项 <b>明天</b> 去查",
    inbox_one: "收件箱 <b>{{count}}</b> 件没整理",
    inbox_other: "收件箱 <b>{{count}}</b> 件没整理",
    empty: "今天没有要紧的事",
    goToTasks: "去任务页",
  },
};

export default calendar;
