// en · calendar — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/calendar";

const calendar: Messages<typeof zh> = {
  pageLabel: "Calendar",
  today: "Today",
  dropHere: "Drop here",
  drag: {
    pickedUp: "Picked up item",
    dropped: "Dropped",
    cancelled: "Drag canceled",
    instructions:
      "Drag an item to reorder it or move it to another day; hold it at the top or bottom edge of the grid to change weeks",
  },
  movedToast: "Moved to {{day}}",
  moveRejected: {
    startAfterDue: "The start can't be after the due date",
    dueBeforeStart: "The due date can't be before the start",
    locked: "Archived tasks keep their dates",
  },
  input: {
    newLabel: "New event on {{monthDay}}",
    editLabel: "Edit “{{title}}”",
    previewEmpty: "Type — times are detected automatically",
    previewUntimed: "No time",
    previewNoTitle: "Needs a title",
  },
  deletedToast: "Deleted “{{title}}”",
  pill: {
    overdue: "<b>1</b> step overdue in <task/>",
    overdueMore_one: "<b>{{count}}</b> steps overdue, first in <task/>",
    overdueMore_other: "<b>{{count}}</b> steps overdue, first in <task/>",
    todos_one: "<b>{{count}}</b> to-do",
    todos_other: "<b>{{count}}</b> to-dos",
    dueToday: "<task/> <b>due today</b>",
    dueIn_one: "<task/> due in <b>{{count}}</b> day",
    dueIn_other: "<task/> due in <b>{{count}}</b> days",
    check: "Check <task/> <b>tomorrow</b>",
    checkMore_one: "Check <task/> and {{count}} more <b>tomorrow</b>",
    checkMore_other: "Check <task/> and {{count}} more <b>tomorrow</b>",
    inbox_one: "<b>{{count}}</b> unsorted in Inbox",
    inbox_other: "<b>{{count}}</b> unsorted in Inbox",
    empty: "Nothing pressing today",
    goToTasks: "Go to Tasks",
  },
};

export default calendar;
