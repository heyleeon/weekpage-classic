// en · common — typed against the zh-Hans twin: a missing or extra key fails tsc.

import type { Messages } from "../../types";
import type zh from "../zh-Hans/common";

const common: Messages<typeof zh> = {
  appName: "WeekPage",
  actions: {
    ok: "OK",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    undo: "Undo",
    close: "Close",
    save: "Save",
    edit: "Edit",
    add: "Add",
    done: "Done",
    back: "Back",
    retry: "Try again",
  },
  weeks_one: "{{count}} week",
  weeks_other: "{{count}} weeks",
  languageNames: {
    system: "System",
    zhHans: "简体中文",
    en: "English",
  },
  date: {
    weekday: {
      mon: "Mon",
      tue: "Tue",
      wed: "Wed",
      thu: "Thu",
      fri: "Fri",
      sat: "Sat",
      sun: "Sun",
    },
    weekdayNarrow: {
      mon: "M",
      tue: "T",
      wed: "W",
      thu: "T",
      fri: "F",
      sat: "S",
      sun: "S",
    },
    month: {
      jan: "January",
      feb: "February",
      mar: "March",
      apr: "April",
      may: "May",
      jun: "June",
      jul: "July",
      aug: "August",
      sep: "September",
      oct: "October",
      nov: "November",
      dec: "December",
    },
    monthShort: {
      jan: "Jan",
      feb: "Feb",
      mar: "Mar",
      apr: "Apr",
      may: "May",
      jun: "Jun",
      jul: "Jul",
      aug: "Aug",
      sep: "Sep",
      oct: "Oct",
      nov: "Nov",
      dec: "Dec",
    },
    monthDay: "{{monthShort}} {{day}}",
  },
};

export default common;
