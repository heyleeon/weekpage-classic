// en · toasts — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/toasts";

const toasts: Messages<typeof zh> = {
  undone: "Undone",
  undoFailed: "Couldn't undo",
  mutateFailed: "That didn't work. Try again.",
  inbox: {
    todo: "Added to To-dos",
    scheduled: "Added to To-dos · reminder {{date}}",
    task: "Turned into a task",
    deleted: "Deleted",
    merged_one: "Sorted {{count}} inbox item: {{parts}}",
    merged_other: "Sorted {{count}} inbox items: {{parts}}",
    partTodo_one: "{{count}} to To-dos",
    partTodo_other: "{{count}} to To-dos",
    partTask_one: "{{count}} became a task",
    partTask_other: "{{count}} became tasks",
    partDeleted_one: "{{count}} deleted",
    partDeleted_other: "{{count}} deleted",
    partSeparator: " · ",
  },
};

export default toasts;
