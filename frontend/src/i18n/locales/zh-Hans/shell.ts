// zh-Hans · shell — source copy (the shape every language must match). See src/i18n/index.ts.
// Plurals: always define both `_one` and `_other` (zh `_one` may repeat `_other`).
//
// The window shell (components/shell): page switch, overlay / popover / toast hosts.
// Generic words (撤销, 关闭) come from `common.actions.*`.

const shell = {
  /** Toolbar page switch 「日历 ⌘1 | 任务 ⌘2」 (ui-spec §1.3); `label` names the group. */
  pageSwitch: {
    label: "页面",
    calendar: "日历",
    tasks: "任务",
  },
  /** Screen-reader name of the scrim button behind a modal (click = close). */
  closeOverlay: "关闭浮层",
  /** Toolbar gear (ui-spec §1.3) → settings panel. `combo` = 「⌘,」 / 「Ctrl+,」. */
  settings: {
    label: "设置",
    tooltip: "设置 {{combo}}",
  },
  /** Calendar page, only while the view is away from today's home row (ui-spec §1.3). The arrow
   *  next to it points to where today is; T is the keyboard shortcut. */
  backToToday: {
    label: "回到今天",
    tooltip: "回到今天（T）",
  },
};

export default shell;
