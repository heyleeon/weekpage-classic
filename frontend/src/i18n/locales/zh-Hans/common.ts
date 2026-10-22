// zh-Hans · common — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// `date.*` feeds the locale-aware date text helpers in src/lib/dates.ts (weekdayShort,
// weekdayNames, weekdayNarrowNames, monthName, monthShortName, monthDayLabel, calendarTitle,
// todayTitle). Components call those helpers instead of reading these keys directly.

const common = {
  appName: "WeekPage",
  actions: {
    ok: "确定",
    cancel: "取消",
    confirm: "确认",
    delete: "删除",
    undo: "撤销",
    close: "关闭",
    save: "保存",
    edit: "编辑",
    add: "添加",
    done: "完成",
    back: "返回",
    retry: "再试一次",
  },
  /** 「3周」 — plural example: t("common.weeks", { count: 3 }); zh `_one` repeats `_other`. */
  weeks_one: "{{count}}周",
  weeks_other: "{{count}}周",
  /** Option labels of the 语言 setting; each language is named in its own script. */
  languageNames: {
    system: "跟随系统",
    zhHans: "简体中文",
    en: "English",
  },
  date: {
    weekday: {
      mon: "周一",
      tue: "周二",
      wed: "周三",
      thu: "周四",
      fri: "周五",
      sat: "周六",
      sun: "周日",
    },
    /** One-character heads (mini calendar). */
    weekdayNarrow: {
      mon: "一",
      tue: "二",
      wed: "三",
      thu: "四",
      fri: "五",
      sat: "六",
      sun: "日",
    },
    /** Calendar page title. */
    month: {
      jan: "1月",
      feb: "2月",
      mar: "3月",
      apr: "4月",
      may: "5月",
      jun: "6月",
      jul: "7月",
      aug: "8月",
      sep: "9月",
      oct: "10月",
      nov: "11月",
      dec: "12月",
    },
    monthShort: {
      jan: "1月",
      feb: "2月",
      mar: "3月",
      apr: "4月",
      may: "5月",
      jun: "6月",
      jul: "7月",
      aug: "8月",
      sep: "9月",
      oct: "10月",
      nov: "11月",
      dec: "12月",
    },
    /** 「9月30日」. Values: month (number), monthShort (name), day (number). */
    monthDay: "{{month}}月{{day}}日",
  },
};

export default common;
