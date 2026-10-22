// zh-Hans · settings — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// Settings panel (ui-spec §16), shortcut recorder and first-run hint (§1.1). `combo` is always the
// formatted accelerator in effect (「⌃⌥Space」 / "Ctrl+Alt+Space", components/settings/accelerator).
// Option labels from common: weeks = `common.weeks` (count), languages = `common.languageNames.*`
// (each language named in its own script).

const settings = {
  title: "设置",
  /** Footer button (no confirmation). */
  quit: "退出 WeekPage",
  /** Section titles, in panel order. */
  sections: {
    shortcut: "呼出",
    calendar: "日历",
    appearance: "外观",
    region: "语言与时区",
    window: "窗口",
  },
  /** 「显示几周」 [2周 | 3周 | 4周]. */
  calendarWeeks: {
    label: "显示几周",
  },
  /** 「第一行」 [本周 | 上周]: the week the calendar's first row shows at home. */
  firstRow: {
    label: "第一行",
    thisWeek: "本周",
    lastWeek: "上周",
    note: "打开窗口和回到今天时，日历第一行显示哪一周",
  },
  theme: {
    label: "主题",
    system: "跟随系统",
    light: "白天",
    dark: "黑夜",
  },
  /** 「语言」 [跟随系统 | 简体中文 | English]. */
  language: {
    label: "语言",
  },
  /** 「时区」: one drop-down, 「跟随系统（Asia/Shanghai）」 first, then every IANA zone. */
  timezone: {
    label: "时区",
    system: "跟随系统（{{zone}}）",
    note: "决定「今天」从几点算起，以及提醒、历史里的时间",
  },
  hideOnBlur: {
    label: "失焦时自动隐藏",
    note: "关掉后窗口会一直浮在最上层",
  },
  autostart: {
    label: "开机自动启动",
    note: "关掉后重启电脑，快捷键和提醒都要等你手动打开 WeekPage",
    /** Development builds: the same note plus why the toggle does nothing there. */
    noteDev: "关掉后重启电脑，快捷键和提醒都要等你手动打开 WeekPage（开发版不会真的注册开机启动）",
  },
  shortcut: {
    /** Row label of the global shortcut. */
    label: "呼出 WeekPage",
    record: "录制",
    recording: "按下新的组合… Esc 取消",
    /** Toast after a new combo took effect. */
    changed: "快捷键已改成 {{combo}}",
    /** Rust kept the old combo without saying why. */
    saveFailed: "没改成功，再试一次",
    reserved: "这是系统快捷键，换一个吧",
    taken: "这个组合被别的应用占用了，换一个试试",
    invalid: "这个组合不能用，换一个试试",
    noModifierMac: "要带上 ⌃ / ⌥ / ⌘ 之一，换一个试试",
    noModifierWin: "要带上 Ctrl / Alt 之一，换一个试试",
    /** Where macOS keeps its shortcuts; fills `path` in the conflict texts. */
    systemSettingsPath: "系统设置 → 键盘 → 键盘快捷键",
    /** An enabled macOS system shortcut on the same combo (ShortcutStatus.conflict). */
    conflict: {
      inputSourceNext:
        "{{combo}} 正被系统用于切换输入法。到 {{path}} → 输入法 关掉『选择输入法菜单中的下一个输入法』，或在这里换一个快捷键",
      inputSourcePrevious:
        "{{combo}} 正被系统用于切换输入法。到 {{path}} → 输入法 关掉『选择上一个输入法』，或在这里换一个快捷键",
      spotlight:
        "{{combo}} 正被系统用于聚焦搜索。到 {{path}} → 聚焦 关掉『显示聚焦搜索』，或在这里换一个快捷键",
      spotlightWindow:
        "{{combo}} 正被系统用于聚焦搜索。到 {{path}} → 聚焦 关掉『显示“访达”搜索窗口』，或在这里换一个快捷键",
      other: "{{combo}} 正被一个系统快捷键占用。到 {{path}} 里关掉它，或在这里换一个快捷键",
    },
  },
  firstRun: {
    /** Accessible name of the hint strip. */
    label: "快捷键提示",
    text: "按 {{combo}} 试试能不能收起；不行就去设置里换一个",
    openSettings: "去设置",
    gotIt: "知道了",
  },
};

export default settings;
