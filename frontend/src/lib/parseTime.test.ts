import { describe, expect, it } from "vitest";
import { parseTime, parseTimeOnly } from "./parseTime";

// Cases for ui-spec §18, one row per case: [#, input, time, endTime, title]. Rows 38 and 58 hold two
// inputs each (「12pm 午饭 / 12am 上线」「25点 / 15:60 测试」) and are split into a / b.
const TABLE: [string, string, string | null, string | null, string][] = [
  ["1", "3点开会", "15:00", null, "开会"],
  ["2", "下午3点开会", "15:00", null, "开会"],
  ["3", "3pm 开会", "15:00", null, "开会"],
  ["4", "15点开会", "15:00", null, "开会"],
  ["5", "15.00 开会", "15:00", null, "开会"],
  ["6", "下午3点半和 A 喝咖啡", "15:30", null, "和 A 喝咖啡"],
  ["7", "15:30 和 A 喝咖啡", "15:30", null, "和 A 喝咖啡"],
  ["8", "3:30pm 和 A 喝咖啡", "15:30", null, "和 A 喝咖啡"],
  ["9", "早上9点晨跑", "09:00", null, "晨跑"],
  ["10", "中午和 A 吃饭", "12:00", null, "和 A 吃饭"],
  ["11", "晚上8点看电影", "20:00", null, "看电影"],
  ["12", "6点吃饭", "18:00", null, "吃饭"],
  ["13", "1点交接", "13:00", null, "交接"],
  ["14", "3-5点开会", "15:00", "17:00", "开会"],
  ["15", "收拾去上海的行李", null, null, "收拾去上海的行李"],
  ["16", "飞上海 CA1519 18:00", "18:00", null, "飞上海 CA1519"],
  ["17", "和律师电话会，过 LLC 条款 14:00", "14:00", null, "和律师电话会，过 LLC 条款"],
  ["18", "7点起床", "07:00", null, "起床"],
  ["19", "12点午饭", "12:00", null, "午饭"],
  ["20", "0点跨年", "00:00", null, "跨年"],
  ["21", "凌晨1点看球", "01:00", null, "看球"],
  ["22", "早上6点出发", "06:00", null, "出发"],
  ["23", "上午10点半例会", "10:30", null, "例会"],
  ["24", "中午1点 午休结束", "13:00", null, "午休结束"],
  ["25", "中午12点半", "12:30", null, ""],
  ["26", "今晚8点 聚餐", "20:00", null, "聚餐"],
  ["27", "傍晚6点跑步", "18:00", null, "跑步"],
  ["28", "下午7点 复盘", "19:00", null, "复盘"],
  ["29", "3点15分 对账", "15:15", null, "对账"],
  ["30", "3点一刻 对账", "15:15", null, "对账"],
  ["31", "三点半开会", "15:30", null, "开会"],
  ["32", "两点开会", "14:00", null, "开会"],
  ["33", "十点站会", "10:00", null, "站会"],
  ["34", "15点半 评审", "15:30", null, "评审"],
  ["35", "09.30 站会", "09:30", null, "站会"],
  ["36", "3.30pm 电话", "15:30", null, "电话"],
  ["37", "11am brunch", "11:00", null, "brunch"],
  ["38a", "12pm 午饭", "12:00", null, "午饭"],
  ["38b", "12am 上线", "00:00", null, "上线"],
  ["39", "3 PM 开会", "15:00", null, "开会"],
  ["40", "１５：３０ 开会", "15:30", null, "开会"],
  ["41", "3点钟 碰头", "15:00", null, "碰头"],
  ["42", "15:30pm 碰头", "15:30", null, "碰头"],
  ["43", "下午 3 点 开会", "15:00", null, "开会"],
  ["44", "3点-5点半 workshop", "15:00", "17:30", "workshop"],
  ["45", "下午3点到5点 访谈", "15:00", "17:00", "访谈"],
  ["46", "15:00-16:30 评审", "15:00", "16:30", "评审"],
  ["47", "9-11点培训", "09:00", "11:00", "培训"],
  ["48", "5-7点 晚宴", "17:00", "19:00", "晚宴"],
  ["49", "11-1点 午饭会", "11:00", "13:00", "午饭会"],
  ["50", "早上9点到下午2点 展会", "09:00", "14:00", "展会"],
  ["51", "买3个苹果", null, null, "买3个苹果"],
  ["52", "第3点意见", null, null, "第3点意见"],
  ["53", "版本 2.10 发布", null, null, "版本 2.10 发布"],
  ["54", "报销 15.00 元", null, null, "报销 15.00 元"],
  ["55", "3-5 再看", null, null, "3-5 再看"],
  ["56", "10/1 交材料", null, null, "10/1 交材料"],
  ["57", "下午去银行", null, null, "下午去银行"],
  ["58a", "25点", null, null, "25点"],
  ["58b", "15:60 测试", null, null, "15:60 测试"],
  ["59", "15:00", "15:00", null, ""],
  ["60", "3点开会 5点吃饭", "15:00", null, "开会 5点吃饭"],
  ["61", "明天下午3点开会", "15:00", null, "明天开会"],
  ["62", "晚上12点 守岁", null, null, "晚上12点 守岁"],
  ["63", "整理3点意见", "15:00", null, "整理意见"],
  ["64", "15:00，和供应商吃饭", "15:00", null, "和供应商吃饭"],
  ["65", "晚上8点 演唱会", "20:00", null, "演唱会"],
];

describe("parseTime · ui-spec §18", () => {
  it.each(TABLE)("#%s 「%s」", (_n, input, time, endTime, title) => {
    expect(parseTime(input)).toEqual({ time, endTime, title });
  });
});

describe("parseTime · extra cases", () => {
  it.each<[string, string | null, string | null, string]>([
    // 「3点15」 is the same as 「3点15分」 (row 29 note); 「三刻」 = 45 (row 30 note).
    ["3点15 对账", "15:15", null, "对账"],
    ["3点三刻 对账", "15:45", null, "对账"],
    // Full-width letters and am / pm spelled with dots, any case.
    ["３ＰＭ 开会", "15:00", null, "开会"],
    ["9 a.m. 早会", "09:00", null, "早会"],
    ["7 P.M. 晚饭", "19:00", null, "晚饭"],
    // A leading zero means 24-hour: no +12.
    ["06:00 晨跑", "06:00", null, "晨跑"],
    ["3:30 开会", "15:30", null, "开会"],
    // 「下午12点」 is noon; 「凌晨12点」 is midnight.
    ["下午12点 开会", "12:00", null, "开会"],
    ["凌晨12点 上线", "00:00", null, "上线"],
    // Range separators: ~ – — 至, and colon ranges with am / pm.
    ["3~5点 开会", "15:00", "17:00", "开会"],
    ["3点至5点 开会", "15:00", "17:00", "开会"],
    ["15:00—17:00 演唱会", "15:00", "17:00", "演唱会"],
    ["10am-2pm 展会", "10:00", "14:00", "展会"],
    // The fragment can sit in the middle; inner punctuation stays.
    ["和 A，下午3点，喝咖啡", "15:00", null, "和 A，，喝咖啡"],
    // Amounts and versions are not times.
    ["¥12.30 午饭", null, null, "¥12.30 午饭"],
    ["v10.12 发布", null, null, "v10.12 发布"],
    ["跑了 10.50km", null, null, "跑了 10.50km"],
    // 「一点」 without minutes or a real period word is 「a little」.
    ["吃一点东西", null, null, "吃一点东西"],
    ["早一点出发", null, null, "早一点出发"],
    ["一点半 开会", "13:30", null, "开会"],
    ["凌晨一点 看球", "01:00", null, "看球"],
    // IME-ish mixed input: full-width colon with half-width digits, extra spaces.
    ["  15：30   和  A  ", "15:30", null, "和 A"],
    // 3 amazing is not 3 am.
    ["3 amazing ideas", null, null, "3 amazing ideas"],
  ])("「%s」", (input, time, endTime, title) => {
    expect(parseTime(input)).toEqual({ time, endTime, title });
  });
});

// English input is read whatever the UI language is (same output contract: the time only).
describe("parseTime · English", () => {
  it.each<[string, string | null, string | null, string]>([
    // am / pm, with or without minutes and spaces.
    ["Dinner 8pm", "20:00", null, "Dinner"],
    ["8:30 am standup", "08:30", null, "standup"],
    ["8:30am standup", "08:30", null, "standup"],
    ["8 p.m. dinner", "20:00", null, "dinner"],
    ["12pm lunch", "12:00", null, "lunch"],
    // noon / midday / midnight.
    ["Lunch at noon", "12:00", null, "Lunch"],
    ["12 noon lunch", "12:00", null, "lunch"],
    ["Noon", "12:00", null, ""],
    ["midday walk", "12:00", null, "walk"],
    ["midnight launch", "00:00", null, "launch"],
    ["afternoon tea", null, null, "afternoon tea"],
    // o'clock reads like 「点钟」 (bare hour rule: 1–6 → afternoon).
    ["8 o'clock breakfast", "08:00", null, "breakfast"],
    ["3 o’clock tea", "15:00", null, "tea"],
    ["3 O'Clock tea", "15:00", null, "tea"],
    // A leading at / @ / from goes with the time.
    ["dinner at 7pm", "19:00", null, "dinner"],
    ["dinner@7pm", "19:00", null, "dinner"],
    ["Open from 3pm", "15:00", null, "Open"],
    ["flight at 18:00", "18:00", null, "flight"],
    // A bare hour after at / @ reads like 「N点」.
    ["pick up kids at 3", "15:00", null, "pick up kids"],
    ["dinner at 8", "08:00", null, "dinner"],
    ["call @ 4", "16:00", null, "call"],
    ["meet at 8.30", "08:30", null, "meet"],
    ["at 24", null, null, "at 24"],
    ["v at 2.10.3", null, null, "v at 2.10.3"],
    // Period words before (with this / tonight, or a bare word plus at) or after the hour.
    ["tonight at 8 dinner", "20:00", null, "dinner"],
    ["Dinner tonight at 8.", "20:00", null, "Dinner"],
    ["this afternoon at 3:30 review", "15:30", null, "review"],
    ["tomorrow morning at 9 standup", "09:00", null, "tomorrow standup"],
    ["good morning 2 all", null, null, "good morning 2 all"],
    ["8 tonight dinner", "20:00", null, "dinner"],
    ["dinner 8pm tonight", "20:00", null, "dinner"],
    ["3 in the afternoon call", "15:00", null, "call"],
    ["9 in the morning run", "09:00", null, "run"],
    ["10 at night call", "22:00", null, "call"],
    ["12 at night", null, null, "12 at night"],
    // Ranges: a bare start takes the end's am / pm; pm that lands after the end means am.
    ["3-5pm workshop", "15:00", "17:00", "workshop"],
    ["3 - 5 pm workshop", "15:00", "17:00", "workshop"],
    ["10-11am sync", "10:00", "11:00", "sync"],
    ["11-1pm lunch", "11:00", "13:00", "lunch"],
    ["9-5pm conference", "09:00", "17:00", "conference"],
    ["12-2pm lunch", "12:00", "14:00", "lunch"],
    ["7:30-9pm dinner", "19:30", "21:00", "dinner"],
    ["11:30-1pm brunch", "11:30", "13:00", "brunch"],
    ["3pm-5 review", "15:00", "17:00", "review"],
    ["3 to 5pm review", "15:00", "17:00", "review"],
    ["from 3 to 5pm review", "15:00", "17:00", "review"],
    ["3pm until 5pm review", "15:00", "17:00", "review"],
    ["noon to 2pm lunch", "12:00", "14:00", "lunch"],
    ["3-5 in the afternoon meeting", "15:00", "17:00", "meeting"],
    ["3-5pm tonight party", "15:00", "17:00", "party"],
    // A leading zero is 24-hour and does not take the end's pm.
    ["07:30-9pm shift", "07:30", "21:00", "shift"],
    // Not ranges: two bare numbers, or an end with its own am / pm before the start.
    ["5 to 7 drinks", null, null, "5 to 7 drinks"],
    ["10pm-1am party", "22:00", null, "1am party"],
    // Words that only look like am / pm / at.
    ["3 amazing ideas", null, null, "3 amazing ideas"],
    ["chat 3pm", "15:00", null, "chat"],
    ["format 3 pages", null, null, "format 3 pages"],
    ["Call Mr.", null, null, "Call Mr."],
  ])("%s", (input, time, endTime, title) => {
    expect(parseTime(input)).toEqual({ time, endTime, title });
  });
});

// Like 「明天下午3点开会」 (row 61), date words are not read: the date comes from the day cell
// (ui-spec §18), so they stay in the title next to a recognised time.
describe("parseTime · English date words stay in the title", () => {
  it.each<[string, string | null, string]>([
    ["today 3pm meeting", "15:00", "today meeting"],
    ["tomorrow 3pm meeting", "15:00", "tomorrow meeting"],
    ["day after tomorrow 10am dentist", "10:00", "day after tomorrow dentist"],
    ["mon 9am standup", "09:00", "mon standup"],
    ["monday standup", null, "monday standup"],
    ["next fri 3pm review", "15:00", "next fri review"],
    ["Next Friday at 3pm review", "15:00", "Next Friday review"],
    ["sat brunch", null, "sat brunch"],
    ["tonight 3-5pm", "15:00", "tonight"],
  ])("%s", (input, time, title) => {
    const p = parseTime(input);
    expect(p.time).toBe(time);
    expect(p.title).toBe(title);
  });
});

describe("parseTimeOnly", () => {
  it.each<[string, string | null]>([
    ["6点", "18:00"],
    ["18:00", "18:00"],
    ["下午3点半", "15:30"],
    ["6", "18:00"],
    ["9", "09:00"],
    ["１８：３０", "18:30"],
    ["晚上8点", "20:00"],
    ["", null],
    ["随便", null],
    ["25", null],
    ["8pm", "20:00"],
    ["8:30 am", "08:30"],
    ["noon", "12:00"],
    ["midnight", "00:00"],
    ["3 o'clock", "15:00"],
    ["tonight 8", "20:00"],
  ])("「%s」→ %s", (input, expected) => {
    expect(parseTimeOnly(input)).toBe(expected);
  });
});
