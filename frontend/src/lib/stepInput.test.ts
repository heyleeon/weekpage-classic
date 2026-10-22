import { describe, expect, it } from "vitest";
import { parseStepDate, resolveStepInput } from "./stepInput";

// Today = Tuesday 2026-10-06 (the week runs Mon 10/5 – Sun 10/11).
const TODAY = "2026-10-06";

// [input, date, title] for ui-spec §19.1 step 1.
const TABLE: [string, string | null, string][] = [
  // D1 / D2: cut, the rest tidied
  ["等管局回复 10/9", "2026-10-09", "等管局回复"],
  ["提交网申 · 11/15", "2026-11-15", "提交网申"],
  ["等审批 · 10/1 查", "2026-10-01", "等审批 · 查"],
  ["10月8日 看一遍终稿", "2026-10-08", "看一遍终稿"],
  ["10/1 15:00 打电话给银行", "2026-10-01", "15:00 打电话给银行"],
  ["10/3 提交，10/8 复查", "2026-10-03", "提交，10/8 复查"],
  ["1/5 交年报", "2027-01-05", "交年报"],
  // D4 「M.D」
  ["12.2 cdn 的证书会过期 记得续签", "2026-12-02", "cdn 的证书会过期 记得续签"],
  ["续签 12.20", "2026-12-20", "续签"],
  ["１２．２ 续签", "2026-12-02", "续签"],
  ["预算 3.5 万", null, "预算 3.5 万"],
  ["1.5 倍速看完", null, "1.5 倍速看完"],
  ["读第1.2节", null, "读第1.2节"],
  ["读 2.3 节", null, "读 2.3 节"],
  ["v2.1 发布", null, "v2.1 发布"],
  ["¥15.20 午饭", null, "¥15.20 午饭"],
  ["跑 3.5km", null, "跑 3.5km"],
  ["升级到 1.2.3", null, "升级到 1.2.3"],
  ["3.50 元", null, "3.50 元"],
  // D3 days
  ["明天续签", "2026-10-07", "续签"],
  ["今天交房租", "2026-10-06", "交房租"],
  ["后天出发", "2026-10-08", "出发"],
  ["大后天搬家", "2026-10-09", "搬家"],
  ["昨天对方回了邮件", "2026-10-05", "对方回了邮件"],
  ["前天寄出", "2026-10-04", "寄出"],
  ["去查审批结果（明天）", "2026-10-07", "去查审批结果"],
  ["然后天猫下单", null, "然后天猫下单"],
  ["提前天数算好", null, "提前天数算好"],
  // D3 weekdays: bare = the coming one (today counts); 这 / 本 = this week; 下 = next; 上 = last
  ["周五交材料", "2026-10-09", "交材料"],
  ["周二开会", "2026-10-06", "开会"],
  ["周一复盘", "2026-10-12", "复盘"],
  ["星期天休息", "2026-10-11", "休息"],
  ["礼拜六爬山", "2026-10-10", "爬山"],
  ["这周一复盘", "2026-10-05", "复盘"],
  ["本周日交周报", "2026-10-11", "交周报"],
  ["下周五 交材料", "2026-10-16", "交材料"],
  ["下个星期三 体检", "2026-10-14", "体检"],
  ["下下周一 出差", "2026-10-19", "出差"],
  ["上周五对方回了", "2026-10-02", "对方回了"],
  ["每周五例会", null, "每周五例会"],
  ["一周三次健身", null, "一周三次健身"],
  ["两周五天在家", null, "两周五天在家"],
  // English
  ["call mom tomorrow", "2026-10-07", "call mom"],
  ["Renew the cert on Friday.", "2026-10-09", "Renew the cert"],
  ["next fri submit", "2026-10-16", "submit"],
  ["this Mon recap", "2026-10-05", "recap"],
  ["pay rent by Thursday", "2026-10-08", "pay rent"],
  ["ship the day after tomorrow", "2026-10-08", "ship"],
  ["yesterday they replied", "2026-10-05", "they replied"],
  ["Dec 2 renew", "2026-12-02", "renew"],
  ["renew by 2nd of December", "2026-12-02", "renew"],
  ["sat down with Tom", null, "sat down with Tom"],
  ["next sat hike", "2026-10-17", "hike"],
  ["c'mon, finish it", null, "c'mon, finish it"],
  ["may 5pm call", null, "may 5pm call"],
  // nothing to read
  ["写英文文案", null, "写英文文案"],
  ["  等银行回电  ", null, "等银行回电"],
  // leftmost wins
  ["明天把 10/9 的材料寄出", "2026-10-07", "把 10/9 的材料寄出"],
];

describe("parseStepDate · ui-spec §19.1 step 1", () => {
  it.each(TABLE)("「%s」→ %s 「%s」", (input, date, title) => {
    expect(parseStepDate(input, TODAY)).toEqual({ date, title });
  });

  it("only a date: no title left", () => {
    expect(parseStepDate("12.2", TODAY)).toEqual({ date: "2026-12-02", title: "" });
    expect(parseStepDate("明天", TODAY)).toEqual({ date: "2026-10-07", title: "" });
  });
});

describe("resolveStepInput", () => {
  it("types the words without the date, cuts the date it uses", () => {
    expect(resolveStepInput("10/9 查", TODAY, null, undefined)).toEqual({
      kind: "check",
      date: "2026-10-09",
      text: "查",
      cut: true,
    });
    expect(resolveStepInput("明天等管局回复", TODAY, null, undefined)).toEqual({
      kind: "wait",
      date: "2026-10-07",
      text: "等管局回复",
      cut: true,
    });
    expect(resolveStepInput("写英文文案", TODAY, null, undefined)).toEqual({
      kind: "do",
      date: null,
      text: "写英文文案",
      cut: false,
    });
  });

  it("a date picked or cleared by hand leaves the text as typed; the same date still cuts", () => {
    expect(resolveStepInput("续签 12.2", TODAY, null, null)).toMatchObject({
      date: null,
      text: "续签 12.2",
      cut: false,
    });
    expect(resolveStepInput("续签 12.2", TODAY, null, "2026-12-05")).toMatchObject({
      date: "2026-12-05",
      text: "续签 12.2",
      cut: false,
    });
    expect(resolveStepInput("续签 12.2", TODAY, null, "2026-12-02")).toMatchObject({
      date: "2026-12-02",
      text: "续签",
      cut: true,
    });
  });

  it("a note gets today when no date is typed, else the typed one (cut)", () => {
    expect(resolveStepInput("对方回信了", TODAY, "note", undefined)).toEqual({
      kind: "note",
      date: TODAY,
      text: "对方回信了",
      cut: false,
    });
    expect(resolveStepInput("昨天对方回信了", TODAY, "note", undefined)).toEqual({
      kind: "note",
      date: "2026-10-05",
      text: "对方回信了",
      cut: true,
    });
  });
});
