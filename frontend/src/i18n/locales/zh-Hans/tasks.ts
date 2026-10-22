// zh-Hans · tasks — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// The tasks page (ui-spec §4–§9, §12): left column (待办 / 收件箱), date picker, task grid and
// cards, plus the shared status / key point type / marker names (StatusTag, KindBadge,
// KeyPointMarker) and the calendar title of a dated key point (lib/keyPoint.ts calendarLabel).
// English glossary: 待办 = to-do, 收件箱 = Inbox, 任务 = task, 关键点 = step.

const tasks = {
  /** Accessible name of the whole page. */
  page: "任务页",
  /** Right column title row (§4.4): 「任务」 9 件 · 1 件逾期 …… 「+ 新任务」. */
  header: {
    title: "任务",
    count_one: "{{count}} 件",
    count_other: "{{count}} 件",
    overdue_one: "{{count}} 件逾期",
    overdue_other: "{{count}} 件逾期",
    newTask: "新任务",
  },
  /** Left column head (§5.2, §5.3). */
  panel: {
    label: "待办与收件箱",
    tabs: "左栏页签",
    /** The to-do tab: every open to-do, whatever its reminder day (2026-10-02, was 「今天」). */
    today: "待办",
    inbox: "收件箱",
    addTodo: "添加待办",
    addInbox: "写进收件箱",
  },
  /** 「待办」 tab (§5.4–§5.8). */
  todo: {
    allDone: "都做完了",
    empty: "还没有待办",
    add: "添加待办",
    doneSection: "今天完成",
    /** 「今天完成 2」. Values: n. */
    doneCount: "今天完成 {{n}}",
    doneHint: "明早自动归档",
    remind: "设提醒",
    changeReminder: "改提醒",
    menu: "待办菜单",
    edit: "改待办",
    /** Swipe right on a row (§10.14); a ticked row unticks. */
    swipeDone: "完成",
    swipeUndo: "取消完成",
    /** Toast after deleting a todo. Values: title. */
    deleted: "已删除「{{title}}」",
  },
  /** Reminder tag of a todo row (lib/todos.ts todoTag, §5.4). */
  tag: {
    today: "今天",
    tomorrow: "明天",
  },
  /** 「收件箱」 tab (§6). */
  inbox: {
    placeholder: "想到什么先丢这里，回车就行",
    input: "收件箱输入",
    empty: "收件箱空了",
    edit: "改收件",
    /** Swipe right on a row (§10.14): into today's to-dos. */
    today: "今天",
    schedule: "定日期",
    toTask: "变任务",
    tip: {
      schedule: "进待办，并在那天的日历格子里出现",
      toTask: "选开始（截止可不选），关键点可加可不加",
    },
  },
  /** Date picker popover (§12) and its footer summary (lib/todos.ts reminderSummary). */
  picker: {
    label: "选日期",
    titleReminder: "哪天提醒？",
    titleSchedule: "排到哪天？",
    quick: {
      today: "今天",
      tomorrow: "明天",
      friday: "周五",
      nextFriday: "下周五",
      nextMonday: "下周一",
    },
    time: "具体时间",
    timeOptional: "具体时间（可选）",
    timeInput: "提醒时间",
    timeOff: "不设",
    noReminder: "不提醒",
    pickDay: "选一天",
    /** Day words inside the summary (lower case in English, unlike the chips). */
    today: "今天",
    tomorrow: "明天",
    /** 「10/9 周五 18:00 提醒」. Values: when (day + optional time). */
    summaryReminder: "{{when}} 提醒",
    /** 「10/5 周一 · 进待办 + 日历」. Values: when. */
    summarySchedule: "{{when}} · 进待办 + 日历",
  },
  /** Screen-reader texts of the drag surfaces (dnd-kit): to-do rows (§5.6), task cards (§7.2),
   *  detail key points (§10.14). */
  drag: {
    pickedUp: "已拿起",
    dropped: "已放下",
    cancelled: "已取消拖动",
    todoInstructions: "按住拖动可调整顺序，越靠上越重要",
    cardInstructions: "拖动任务卡可调整顺序，或拖到别的列",
    stepInstructions: "没写日期的关键点可以上下拖动调整顺序",
  },
  /** Task grid empty state (§7.3). */
  grid: {
    emptyTitle: "还没有任务",
    emptyHint: "从收件箱「变任务」，或者点右上角「+ 新任务」",
  },
  /** Task card (§8). */
  card: {
    archive: "归档",
    statusMenu: "改状态",
    /** Swipe actions on a key point row (§10.14). */
    swipeDone: "完成",
    swipeUndo: "取消",
    delete: "删除",
    /** Tips of the card's footer icons (§8.1): the inbox tray, ✓ a/b. */
    fromInbox: "新 · 刚从收件箱变来",
    /** Values: done, total. */
    allDone: "{{done}} / {{total}} 全部完成 · 点「归档」确认一次",
    progress: "已完成 {{done}} / {{total}}",
    /** Tip of the title row's 「⚠ N」 when steps are overdue (ui-spec §9.3). */
    overdue_one: "{{count}} 步逾期",
    overdue_other: "{{count}} 步逾期",
    /** Tip of an overdue step row (its end shows the date in red): days past its date. */
    late_one: "逾期 {{count}} 天",
    late_other: "逾期 {{count}} 天",
    /** Marker button names. Values: text (the key point). */
    tick: "勾掉 {{text}}",
    untick: "取消勾 {{text}}",
  },
  /** 「+ 关键点」 inline input (§8.7). */
  addStep: {
    placeholder: "写一步，回车加上",
    label: "加关键点",
  },
  /** Display status (StatusTag, status menus; §0.5, §8.3). */
  status: {
    active: "推进中",
    waiting: "等待中",
    upcoming: "未开始",
    overdue: "逾期",
    done: "已完成",
  },
  /** Key point type badge (KindBadge, §8.7). */
  kind: {
    do: "我来做",
    wait: "等别人",
    check: "检查点",
    cycle: "点一下换类型",
  },
  /** Accessible names of the key point / note markers (KeyPointMarker, §9). */
  marker: {
    done: "已完成",
    overdue: "逾期",
    wait: "等别人",
    check: "检查点",
    idle: "没开始",
    noteThem: "对方",
    noteMe: "我",
  },
  /** Calendar title of a dated wait (lib/keyPoint.ts calendarLabel): 「注册美卡 · 去查审批」. */
  calendar: {
    /** Values: task, what. */
    checkOn: "{{task}} · 去查{{what}}",
    /** Nothing left after stripping dates and 「等」/「查」. Values: task. */
    checkBare: "{{task}} · 去查",
  },
};

export default tasks;
