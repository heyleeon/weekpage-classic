// zh-Hans · detail — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Covers components/detail/**: task detail overlay (head, status menu, ⋯ menu, delete confirm,
// time block, key point timeline, AddBar, history view), 「新建任务 / 变成任务」 popover, archive
// confirmation, and the lifecycle toasts of detail/taskActions.ts.

const detail = {
  /** Task status names (status pill, status menu, history lines). */
  status: {
    active: "推进中",
    waiting: "等待中",
    done: "已完成",
    upcoming: "未开始",
    overdue: "逾期",
  },
  /** Key point types (timeline labels, AddBar type pill / menu). */
  kind: {
    do: "我来做",
    wait: "等别人",
    check: "检查点",
    note: "记一笔",
  },
  /** Who a note is from. */
  who: {
    me: "我",
    them: "对方",
  },
  head: {
    titleLabel: "任务标题",
    titleHint: "点一下改标题",
    statusMenu: "状态",
    archive: "归档",
    archived: "已归档",
    more: "更多",
    history: "查看历史",
    deleteTask: "删除任务",
  },
  deleteConfirm: {
    label: "删除任务",
    title: "删除「{{title}}」？",
    text: "关键点和记录都会一起删掉，不能恢复",
    keep: "先不删",
    delete: "删除",
  },
  missing: {
    title: "找不到这个任务",
    text: "它可能已经被删掉了。",
  },
  keyPoints: {
    title: "关键点",
    /** 「5 个 · 已完成 3」 (nothing with none). Values: count (total, notes excluded), done. */
    count_one: "{{count}} 个 · 已完成 {{done}}",
    count_other: "{{count}} 个 · 已完成 {{done}}",
  },
  restore: "恢复到任务页",
  time: {
    label: "时间",
    start: "开始",
    due: "截止",
    /** After a step lands past the due date: offer to move the due date there. */
    extendDue: "截止改到 {{date}}？",
    keepDue: "不改截止",
    noDue: "不设截止",
    remind: "截止前一天提醒我",
    /** Value: date (「10/30」). */
    remindOn: "截止前一天提醒我（{{date}}）",
  },
  timeline: {
    /** Marker button labels. Value: text (the key point). */
    check: "勾掉 {{text}}",
    uncheck: "取消勾 {{text}}",
    toggleWho: "点一下在「对方」和「我」之间切换",
    editLabel: "改关键点",
    /** Date cell: faint placeholder of an undated row (hover / focus) and its accessible name. */
    setDate: "设日期",
    /** Date cell of a dated row (accessible name). Value: date (「10/9」). */
    changeDate: "改日期（现在是 {{date}}）",
    clearDate: "清掉日期",
    /** Type chip at the row's end (accessible name). Value: kind (a `detail.kind.*` text). */
    kindLabel: "类型：{{kind}}，点一下改",
    kindMenu: "改类型",
    /** Chip of an overdue step (ui-spec §9.3): days past its date. */
    late_one: "逾期 {{count}} 天",
    late_other: "逾期 {{count}} 天",
    /** Drop slot while a step is dragged (same words as the calendar's). */
    dropHere: "放到这里",
    delete: "删除",
    /** Swipe actions (§10.14). */
    swipeDone: "完成",
    swipeUndo: "取消完成",
    deletedNote: "已删除这条记录",
    deleted: "已删除「{{text}}」",
  },
  addBar: {
    label: "加一个关键点",
    submit: "添加",
    placeholder: "加一个关键点，比如：补交地址证明",
    /** Type pill label. Value: kind (a `detail.kind.*` text). */
    kindLabel: "类型：{{kind}}",
    kindMenu: "类型",
    noteOption: "记一笔",
    date: "日期",
    /** Value: date (「10/9」). */
    dateLabel: "日期 {{date}}",
    clearDate: "清掉日期",
  },
  history: {
    back: "返回",
    failed: "历史没读出来，再试一次",
    empty: "还没有记录",
    created: "建立任务",
    createdFromInbox: "从收件箱变成任务",
    renamed: "改名「{{from}}」→「{{to}}」",
    status: "状态 {{from}} → {{to}}",
    start: "开始 {{from}} → {{to}}",
    due: "截止 {{from}} → {{to}}",
    noDue: "不设截止",
    datesChanged: "改日期",
    remindOn: "打开截止前一天提醒",
    remindOff: "关掉截止前一天提醒",
    kpAdded: "加关键点「{{text}}」",
    kpEdited: "改关键点「{{text}}」",
    kpRenamed: "改关键点「{{from}}」→「{{to}}」",
    kpDone: "勾掉「{{text}}」",
    kpUndone: "取消勾「{{text}}」",
    kpCurrent: "设为当前「{{text}}」",
    kpNotCurrent: "取消当前「{{text}}」",
    kpDeleted: "删掉「{{text}}」",
    noteDeleted: "删掉记一笔「{{text}}」",
    /** Values: who (a `detail.who.*` text), text. */
    noteAdded: "记一笔（{{who}}）：{{text}}",
    archived: "归档",
    archivedWithSummary: "归档：{{summary}}",
    restored: "恢复到任务页",
  },
  newTask: {
    heading: "新建任务",
    headingFromInbox: "变成任务",
    submit: "建好了",
    submitFromInbox: "变成任务",
    titleLabel: "任务标题",
    titlePlaceholder: "任务叫什么",
    start: "开始",
    due: "截止",
    noDue: "不设截止",
    kpLabel: "加关键点",
    kpPlaceholder: "加一个关键点…",
    kpRemove: "删掉 {{text}}",
    remindOn: "截止前一天提醒我（{{date}}）",
    created: "已新建任务「{{title}}」",
  },
  archiveConfirm: {
    title: "归档「{{title}}」？",
    subtitleDone: "做完了，收起来",
    subtitleUnfinished: "还没做完，也先收起来",
    keep: "先不归档",
    archive: "归档",
    after: "归档后",
    afterHidden: "从任务页收走，随时能在「归档」里找到",
    afterKept: "关键点、往来记录全部保留",
    afterCalendar: "日历上已经过去的标记保留；以后的提醒会取消",
    summaryLabel: "写一句总结（可选）",
    summaryPlaceholder: "一句话，比如：下次直接用 ITIN 申请",
    /** Stat tiles (value over label). */
    tile: {
      days_one: "{{count}} 天",
      days_other: "{{count}} 天",
      keyPoints_one: "{{count}} 个",
      keyPoints_other: "{{count}} 个",
      early_one: "提前 {{count}} 天",
      early_other: "提前 {{count}} 天",
      late_one: "晚了 {{count}} 天",
      late_other: "晚了 {{count}} 天",
      onTime: "当天完成",
      elapsed: "已进行",
      keyPointsLabel: "关键点",
      pastDue: "已过",
      used: "用时",
      waiting: "等别人",
      vsDue: "比截止",
    },
  },
  /** Toasts of detail/taskActions.ts and the new-task popover. */
  toasts: {
    archived: "已归档「{{title}}」",
    restoredTask: "已恢复到任务页",
    restoredTodo: "已恢复到待办",
  },
};

export default detail;
