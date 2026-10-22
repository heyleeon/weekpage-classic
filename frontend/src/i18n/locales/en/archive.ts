// en · archive — typed against the zh-Hans twin: a missing or extra key fails tsc.
// Words follow the glossary in ./tasks.ts (关键点 = step, …).

import type { Messages } from "../../types";
import type zh from "../zh-Hans/archive";

const archive: Messages<typeof zh> = {
  toolbar: {
    label: "Archive",
    back: "Back to Tasks",
    open: "Open Archive",
  },
  page: {
    label: "Archive",
    filterLabel: "Filter the archive",
    all: "All",
    todo: "To-dos",
    task: "Tasks",
    searchLabel: "Search the archive",
    searchPlaceholder: "Search the archive",
    clearSearch: "Clear search",
    emptyTitle: "Nothing here yet",
    emptyText: "Done to-dos move here the next day; tasks move here when you archive them",
    notFound: "No results for “{{q}}”",
    emptyFilter: "Nothing archived here yet",
  },
  row: {
    task: "Task",
    todo: "To-do",
    restore: "Restore",
    viewAll: "View full history",
    restoreToTasks: "Restore to Tasks",
    note: "{{who}}: {{text}}",
  },
  sidebar: {
    title: "Done this month",
    todos: "To-dos",
    tasks: "Tasks",
    rulesTitle: "Archive rules",
    rules: {
      todos: "To-dos: archived automatically the morning after you check them off",
      tasks: "Tasks: archive them by hand; overdue ones turn red until you do",
      keyPoints: "With steps: confirm once when archiving",
    },
  },
  group: {
    today: "Today · {{date}}",
    yesterday: "Yesterday · {{date}}",
    thisWeekDay: "This week · {{date}}",
    thisWeek: "This week · {{from}} – {{to}}",
    lastWeek: "Last week · {{from}} – {{to}}",
    early: "Early {{monthName}}",
    mid: "Mid-{{monthName}}",
    late: "Late {{monthName}}",
    earlyYear: "Early {{monthName}} {{year}}",
    midYear: "Mid-{{monthName}} {{year}}",
    lateYear: "Late {{monthName}} {{year}}",
    earlier_one: "Earlier · {{period}} · {{count}} item",
    earlier_other: "Earlier · {{period}} · {{count}} items",
  },
  meta: {
    done: "Done {{date}}",
    overdue_one: "{{count}} day overdue",
    overdue_other: "{{count}} days overdue",
    unfinished: "Not finished",
    used_one: "Took {{count}} day",
    used_other: "Took {{count}} days",
    early_one: "{{count}} day early",
    early_other: "{{count}} days early",
    onTime: "On time",
    late_one: "{{count}} day late",
    late_other: "{{count}} days late",
    keyPoints_one: "{{count}} step",
    keyPoints_other: "{{count}} steps",
  },
  insight: {
    early_one: "{{early}} of {{count}} task finished early",
    early_other: "{{early}} of {{count}} tasks finished early",
    avgDays_one: "Tasks with steps took {{count}} day on average",
    avgDays_other: "Tasks with steps took {{count}} days on average",
    waitingHalf: ", half of it waiting on others",
    waitingPct: ", {{pct}}% of it waiting on others",
    noOverdue: "Nothing overdue this month",
    overdueMany_one: "{{count}} item overdue",
    overdueMany_other: "{{count}} items overdue",
    overdueFew_one: "Only {{count}} overdue ({{titles}})",
    overdueFew_other: "Only {{count}} overdue ({{titles}})",
    titleSeparator: ", ",
  },
};

export default archive;
