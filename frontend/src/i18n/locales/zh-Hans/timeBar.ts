// zh-Hans · timeBar — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Task time bar texts (lib/taskMath.ts timeBar; formulas in ui-spec §20.1). Dates are already
// formatted by lib/dates.ts (formatMD 「9/29」, formatMDW 「9/28 周一」); counts are whole days.

const timeBar = {
  /** Lower row, left: 「9/29 开始」. Values: date. */
  start: "{{date}} 开始",
  /** Lower row, right: 「10/2 截止」. Values: date. */
  due: "{{date}} 截止",
  /** No due date: 「9/12 开始 · 不设截止」. Values: date. */
  noDue: "{{date}} 开始 · 不设截止",
  doneToday: "今天完成",
  doneYesterday: "昨天完成",
  /** Values: date. */
  doneOn: "{{date}} 完成",
  /** 「今天完成 · 用时 11 天」. Values: when (doneToday / doneYesterday / doneOn), count. */
  used_one: "{{when}} · 用时 {{count}} 天",
  used_other: "{{when}} · 用时 {{count}} 天",
  early_one: "提前 {{count}} 天",
  early_other: "提前 {{count}} 天",
  /** Done on the due date. */
  onTime: "当天完成",
  late_one: "晚了 {{count}} 天",
  late_other: "晚了 {{count}} 天",
  /** Overdue, upper left: 「截止 9/28 周一」. Values: date. */
  dueOn: "截止 {{date}}",
  overdue_one: "已过 {{count}} 天",
  overdue_other: "已过 {{count}} 天",
  /** Upcoming with a due date: 「10/8 开始 · 共 9 天」. Values: date, count. */
  span_one: "{{date}} 开始 · 共 {{count}} 天",
  span_other: "{{date}} 开始 · 共 {{count}} 天",
  /** Upcoming, upper right: 「还有 8 天」. */
  startsIn_one: "还有 {{count}} 天",
  startsIn_other: "还有 {{count}} 天",
  /** No due date, running: 「已进行 19 天」 (the start day is day 1). Values: n. */
  elapsed: "已进行 {{n}} 天",
  /** Running with a due date: 「今天 · 第 2 / 4 天」. Values: n, m. */
  dayOf: "今天 · 第 {{n}} / {{m}} 天",
  dueToday: "今天截止",
  left_one: "还剩 {{count}} 天",
  left_other: "还剩 {{count}} 天",
};

export default timeBar;
