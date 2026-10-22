// zh-Hans · holidays — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Day-head labels (lib/holidays.ts dayLabel, ui-spec §2.4): statutory holidays, adjusted workdays
// and the 24 solar terms. chinese-days gives Chinese names / its own ids; lib/holidays.ts maps
// them to the keys below. Day heads are narrow (the label ellipsises): keep every language short.

const holidays = {
  /** Adjusted workday (a weekend that is a working day). */
  workday: "补班",
  /** Day n (≥ 2) of a break: 「国庆 · 2」 (name = the festival's short name). */
  nthDay: "{{name}} · {{n}}",
  /** Holiday / workday and a solar term on the same day: 「国庆 · 8 · 寒露」. */
  withTerm: "{{head}} · {{term}}",
  /** full = first day of a break, short = 「国庆 · N」 after it. */
  festival: {
    newYear: { full: "元旦", short: "元旦" },
    springFestival: { full: "春节", short: "春节" },
    qingming: { full: "清明节", short: "清明" },
    labourDay: { full: "劳动节", short: "五一" },
    dragonBoat: { full: "端午节", short: "端午" },
    midAutumn: { full: "中秋节", short: "中秋" },
    nationalDay: { full: "国庆节", short: "国庆" },
  },
  /** The 24 solar terms, in calendar order from January. */
  term: {
    minorCold: "小寒",
    majorCold: "大寒",
    springBegins: "立春",
    rainWater: "雨水",
    insectsAwaken: "惊蛰",
    springEquinox: "春分",
    pureBrightness: "清明",
    grainRain: "谷雨",
    summerBegins: "立夏",
    grainBuds: "小满",
    grainInEar: "芒种",
    summerSolstice: "夏至",
    minorHeat: "小暑",
    majorHeat: "大暑",
    autumnBegins: "立秋",
    endOfHeat: "处暑",
    whiteDew: "白露",
    autumnEquinox: "秋分",
    coldDew: "寒露",
    frostDescent: "霜降",
    winterBegins: "立冬",
    minorSnow: "小雪",
    majorSnow: "大雪",
    winterSolstice: "冬至",
  },
};

export default holidays;
