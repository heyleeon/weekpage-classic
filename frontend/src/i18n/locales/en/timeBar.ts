// en · timeBar — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/timeBar";

const timeBar: Messages<typeof zh> = {
  start: "Start {{date}}",
  due: "Due {{date}}",
  noDue: "From {{date}} · No due date",
  doneToday: "Done today",
  doneYesterday: "Done yesterday",
  doneOn: "Done {{date}}",
  used_one: "{{when}} · Took {{count}} day",
  used_other: "{{when}} · Took {{count}} days",
  early_one: "{{count}} day early",
  early_other: "{{count}} days early",
  onTime: "On time",
  late_one: "{{count}} day late",
  late_other: "{{count}} days late",
  dueOn: "Due {{date}}",
  overdue_one: "{{count}} day overdue",
  overdue_other: "{{count}} days overdue",
  span_one: "Starts {{date}} · {{count}} day",
  span_other: "Starts {{date}} · {{count}} days",
  startsIn_one: "In {{count}} day",
  startsIn_other: "In {{count}} days",
  elapsed: "Day {{n}}",
  dayOf: "Today · Day {{n}} of {{m}}",
  dueToday: "Due today",
  left_one: "{{count}} day left",
  left_other: "{{count}} days left",
};

export default timeBar;
