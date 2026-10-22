// en · tasks — typed against the zh-Hans twin: a missing or extra key fails tsc.
// Glossary (shared by every en section): 待办 = to-do, 收件箱 = Inbox, 任务 = task, 关键点 = step;
// step types 我来做 / 等别人 / 检查点 = My move / Waiting on / Checkpoint; statuses 推进中 / 等待中 /
// 未开始 / 逾期 / 已完成 = Active / Waiting / Upcoming / Overdue / Done.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/tasks";

const tasks: Messages<typeof zh> = {
  page: "Tasks",
  header: {
    title: "Tasks",
    count_one: "{{count}} task",
    count_other: "{{count}} tasks",
    overdue_one: "{{count}} overdue",
    overdue_other: "{{count}} overdue",
    newTask: "New task",
  },
  panel: {
    label: "To-dos and Inbox",
    tabs: "Left column tabs",
    today: "To Do",
    inbox: "Inbox",
    addTodo: "Add to-do",
    addInbox: "Add to Inbox",
  },
  todo: {
    allDone: "All done",
    empty: "No to-dos yet",
    add: "Add to-do",
    doneSection: "Done today",
    doneCount: "Done today {{n}}",
    doneHint: "Archived tomorrow morning",
    remind: "Remind",
    changeReminder: "Change reminder",
    menu: "To-do menu",
    edit: "Edit to-do",
    swipeDone: "Done",
    swipeUndo: "Undo",
    deleted: "Deleted “{{title}}”",
  },
  tag: {
    today: "Today",
    tomorrow: "Tomorrow",
  },
  inbox: {
    placeholder: "Drop a thought here, press Return",
    input: "Add to Inbox",
    empty: "Inbox is empty",
    edit: "Edit Inbox item",
    today: "Today",
    schedule: "Date",
    toTask: "Task",
    tip: {
      schedule: "Add to to-dos and show it on that day in the calendar",
      toTask: "Make it a task: pick a start (due date and steps optional)",
    },
  },
  picker: {
    label: "Pick a date",
    titleReminder: "Remind me when?",
    titleSchedule: "Schedule for when?",
    quick: {
      today: "Today",
      tomorrow: "Tomorrow",
      friday: "Fri",
      nextFriday: "Next Fri",
      nextMonday: "Next Mon",
    },
    time: "Set a time",
    timeOptional: "Time (optional)",
    timeInput: "Reminder time",
    timeOff: "None",
    noReminder: "No reminder",
    pickDay: "Pick a day",
    today: "today",
    tomorrow: "tomorrow",
    summaryReminder: "Remind {{when}}",
    /** U+2011 non-breaking hyphen: the summary may wrap, never inside 「To‑dos」. */
    summarySchedule: "{{when}} · To\u2011dos + calendar",
  },
  drag: {
    pickedUp: "Picked up",
    dropped: "Dropped",
    cancelled: "Drag cancelled",
    todoInstructions: "Drag up or down to reorder; the top is the most important",
    cardInstructions: "Drag a card to reorder it or move it to another column",
    stepInstructions: "Drag a step without a date up or down to reorder it",
  },
  grid: {
    emptyTitle: "No tasks yet",
    emptyHint: "Turn an Inbox item into a task, or click “+ New task” at the top right",
  },
  card: {
    archive: "Archive",
    statusMenu: "Change status",
    swipeDone: "Done",
    swipeUndo: "Undo",
    delete: "Delete",
    fromInbox: "New · From the Inbox",
    allDone: "All {{total}} done · Click Archive to confirm",
    progress: "{{done}} / {{total}} done",
    overdue_one: "{{count}} step overdue",
    overdue_other: "{{count}} steps overdue",
    late_one: "{{count}} day late",
    late_other: "{{count}} days late",
    tick: "Check off {{text}}",
    untick: "Uncheck {{text}}",
  },
  addStep: {
    placeholder: "Add a step, press Return",
    label: "Add step",
  },
  status: {
    active: "Active",
    waiting: "Waiting",
    upcoming: "Upcoming",
    overdue: "Overdue",
    done: "Done",
  },
  kind: {
    do: "My move",
    wait: "Waiting on",
    check: "Checkpoint",
    cycle: "Click to change the type",
  },
  marker: {
    done: "Done",
    overdue: "Overdue",
    wait: "Waiting on others",
    check: "Checkpoint",
    idle: "Not started",
    noteThem: "Them",
    noteMe: "Me",
  },
  calendar: {
    checkOn: "{{task}} · Check on {{what}}",
    checkBare: "{{task}} · Check in",
  },
};

export default tasks;
