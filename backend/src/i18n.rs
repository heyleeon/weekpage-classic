//! Text the backend shows itself (tray / menu bar menu, reminder notifications, the daily step
//! digest, the "shortcut taken" notification) in the UI language. The window's copy lives in the
//! frontend (frontend/src/i18n); this is the small rest.
//!
//! `settings.language` picks the language; `system` follows the OS list of preferred languages
//! (`platform::preferred_languages`): the first entry the app has text for decides (Simplified
//! Chinese of any region → Chinese, en* → English; Traditional Chinese has no copy and is skipped,
//! see [`is_simplified_chinese`]), a list with neither falls back to English and an empty list to
//! Chinese. That is how macOS WebKit picks `navigator.language` from the app's
//! `CFBundleLocalizations` (Info.plist), which the frontend's `resolveLang` then reads, so the
//! menu and the window agree. Chinese is the source copy and must not drift from what v0.1 sent.

use crate::model::{Language, Settings};
use crate::platform;

/// A language the backend has text for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    ZhHans,
    En,
}

/// Pure: the language for a setting, given the OS's preferred languages (most preferred first,
/// BCP 47 tags such as `zh-Hans-CN` or `en-US`).
pub fn resolve<S: AsRef<str>>(setting: Language, os_languages: &[S]) -> Lang {
    match setting {
        Language::ZhHans => Lang::ZhHans,
        Language::En => Lang::En,
        Language::System => from_os(os_languages),
    }
}

fn from_os<S: AsRef<str>>(os_languages: &[S]) -> Lang {
    let tags: Vec<String> = os_languages
        .iter()
        .map(|t| t.as_ref().trim().to_ascii_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    if tags.is_empty() {
        return Lang::ZhHans;
    }
    for tag in &tags {
        if is_simplified_chinese(tag) {
            return Lang::ZhHans;
        }
        if tag.starts_with("en") {
            return Lang::En;
        }
    }
    Lang::En
}

/// Simplified-script Chinese (`zh`, `zh-CN`, `zh-SG`, `zh-Hans-*`); Traditional (`zh-TW`, `zh-HK`,
/// `zh-MO`, `zh-Hant-*`) is a different script with no copy here, the same call macOS makes when it
/// matches the user's languages against the bundle's zh-Hans / en localizations. Takes a lowercased
/// tag; mirrors the frontend's `isSimplifiedChinese` (which asks `Intl.Locale` for the script).
fn is_simplified_chinese(tag: &str) -> bool {
    let mut parts = tag.split(['-', '_']);
    if parts.next() != Some("zh") {
        return false;
    }
    let rest: Vec<&str> = parts.collect();
    if rest.contains(&"hant") {
        return false;
    }
    rest.contains(&"hans") || !rest.iter().any(|p| matches!(*p, "tw" | "hk" | "mo"))
}

/// The language for `settings` (reads the OS list only for `system`).
pub fn for_settings(settings: &Settings) -> Lang {
    let os = match settings.language {
        Language::System => platform::preferred_languages(),
        Language::ZhHans | Language::En => Vec::new(),
    };
    resolve(settings.language, &os)
}

/// Fixed strings. The exhaustive match in [`Text::get`] keeps both languages complete.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Text {
    /// Notification title and tray tooltip.
    AppName,
    TrayShow,
    TrayCalendar,
    TrayTasks,
    TraySettings,
    TrayAutostart,
    TrayQuit,
}

impl Text {
    #[cfg(test)]
    pub const ALL: [Text; 7] = [
        Text::AppName,
        Text::TrayShow,
        Text::TrayCalendar,
        Text::TrayTasks,
        Text::TraySettings,
        Text::TrayAutostart,
        Text::TrayQuit,
    ];

    pub fn get(self, lang: Lang) -> &'static str {
        match lang {
            Lang::ZhHans => match self {
                Text::AppName => "WeekPage",
                Text::TrayShow => "显示 WeekPage",
                Text::TrayCalendar => "日历",
                Text::TrayTasks => "任务",
                Text::TraySettings => "设置…",
                Text::TrayAutostart => "开机自启",
                Text::TrayQuit => "退出 WeekPage",
            },
            Lang::En => match self {
                Text::AppName => "WeekPage",
                Text::TrayShow => "Show WeekPage",
                Text::TrayCalendar => "Calendar",
                Text::TrayTasks => "Tasks",
                Text::TraySettings => "Settings…",
                Text::TrayAutostart => "Open at Login",
                Text::TrayQuit => "Quit WeekPage",
            },
        }
    }
}

/// Todo reminder at its time: 「提醒：{title}」 / "Reminder: {title}".
pub fn todo_due(lang: Lang, title: &str) -> String {
    match lang {
        Lang::ZhHans => format!("提醒：{title}"),
        Lang::En => format!("Reminder: {title}"),
    }
}

/// Task reminder the day before its due date: 「「{title}」明天截止」 / "“{title}” is due tomorrow".
pub fn task_due_tomorrow(lang: Lang, title: &str) -> String {
    match lang {
        Lang::ZhHans => format!("「{title}」明天截止"),
        Lang::En => format!("“{title}” is due tomorrow"),
    }
}

/// A task inside the missed summary: 「「{title}」截止」 / "“{title}” is due".
pub fn task_due(lang: Lang, title: &str) -> String {
    match lang {
        Lang::ZhHans => format!("「{title}」截止"),
        Lang::En => format!("“{title}” is due"),
    }
}

/// Missed reminders merged into one: 「错过 3 条提醒：a、b…」 / "Missed 3 reminders: a, b…".
/// `labels` are the first few items, `more` adds the trailing ellipsis.
pub fn missed(lang: Lang, count: usize, labels: &[String], more: bool) -> String {
    let ellipsis = if more { "…" } else { "" };
    match lang {
        Lang::ZhHans => format!("错过 {count} 条提醒：{}{ellipsis}", labels.join("、")),
        Lang::En => {
            let noun = if count == 1 { "reminder" } else { "reminders" };
            format!("Missed {count} {noun}: {}{ellipsis}", labels.join(", "))
        }
    }
}

/// A step inside the daily step digest: 「{task} · {step}」 (same shape in both languages).
pub fn step_label(task: &str, step: &str) -> String {
    format!("{task} · {step}")
}

/// Overdue part of the daily step digest: 「2 步逾期：a、b…」 / "2 steps overdue: a, b…".
/// `labels` are the first few steps, `more` adds the trailing ellipsis (as in [`missed`]).
pub fn steps_overdue(lang: Lang, count: usize, labels: &[String], more: bool) -> String {
    let ellipsis = if more { "…" } else { "" };
    match lang {
        Lang::ZhHans => format!("{count} 步逾期：{}{ellipsis}", labels.join("、")),
        Lang::En => {
            let noun = if count == 1 { "step" } else { "steps" };
            format!("{count} {noun} overdue: {}{ellipsis}", labels.join(", "))
        }
    }
}

/// Due-today part of the daily step digest: 「今天到期 1 步：a」 / "1 step due today: a".
/// `labels` / `more` as in [`steps_overdue`].
pub fn steps_due_today(lang: Lang, count: usize, labels: &[String], more: bool) -> String {
    let ellipsis = if more { "…" } else { "" };
    match lang {
        Lang::ZhHans => format!("今天到期 {count} 步：{}{ellipsis}", labels.join("、")),
        Lang::En => {
            let noun = if count == 1 { "step" } else { "steps" };
            format!("{count} {noun} due today: {}{ellipsis}", labels.join(", "))
        }
    }
}

/// Body of the one-time "shortcut taken" notification. `combo` is the shortcut as the user reads
/// it (⌃⌥Space / Ctrl+Alt+Space); `menu_bar` names the macOS menu bar icon instead of the tray.
/// 「快捷键 ⌃⌥Space 被占用，打开菜单栏图标 → 设置 换一个」 /
/// "Shortcut ⌃⌥Space is taken: open the menu bar icon → Settings to pick another".
pub fn shortcut_taken(lang: Lang, combo: &str, menu_bar: bool) -> String {
    match lang {
        Lang::ZhHans => {
            let entry = if menu_bar {
                "菜单栏图标"
            } else {
                "托盘图标"
            };
            format!("快捷键 {combo} 被占用，打开{entry} → 设置 换一个")
        }
        Lang::En => {
            let entry = if menu_bar {
                "menu bar icon"
            } else {
                "tray icon"
            };
            format!("Shortcut {combo} is taken: open the {entry} → Settings to pick another")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_setting_ignores_the_os() {
        assert_eq!(resolve(Language::ZhHans, &["en-US"]), Lang::ZhHans);
        assert_eq!(resolve(Language::En, &["zh-Hans-CN"]), Lang::En);
        assert_eq!(resolve::<&str>(Language::En, &[]), Lang::En);
    }

    #[test]
    fn system_follows_the_first_language_with_text() {
        assert_eq!(
            resolve(Language::System, &["zh-Hans-CN", "en-CN"]),
            Lang::ZhHans
        );
        assert_eq!(resolve(Language::System, &["zh-SG"]), Lang::ZhHans);
        assert_eq!(resolve(Language::System, &["ZH_cn"]), Lang::ZhHans);
        // Traditional Chinese has no copy: skipped like any other language without text.
        assert_eq!(resolve(Language::System, &["zh-TW"]), Lang::En);
        assert_eq!(resolve(Language::System, &["ZH-hant"]), Lang::En);
        assert_eq!(
            resolve(Language::System, &["zh-Hant-HK", "zh-Hans-CN"]),
            Lang::ZhHans
        );
        assert_eq!(resolve(Language::System, &["en-US", "zh-Hans"]), Lang::En);
        assert_eq!(resolve(Language::System, &["en"]), Lang::En);
        // No Japanese text: the next preferred language the app has wins.
        assert_eq!(
            resolve(Language::System, &["ja-JP", "zh-Hans"]),
            Lang::ZhHans
        );
        assert_eq!(resolve(Language::System, &["ja-JP", "en-GB"]), Lang::En);
    }

    #[test]
    fn simplified_chinese_goes_by_script_not_region() {
        for tag in ["zh", "zh-cn", "zh-sg", "zh-hans", "zh-hans-hk", "zh_cn"] {
            assert!(is_simplified_chinese(tag), "{tag}");
        }
        for tag in [
            "zh-tw",
            "zh-hk",
            "zh-mo",
            "zh-hant",
            "zh-hant-cn",
            "en",
            "zhx",
            "",
        ] {
            assert!(!is_simplified_chinese(tag), "{tag}");
        }
    }

    #[test]
    fn system_fallbacks() {
        // Neither Chinese nor English anywhere: English (the development region).
        assert_eq!(resolve(Language::System, &["fr-FR", "de"]), Lang::En);
        // Nothing reported at all: the source language.
        assert_eq!(resolve::<&str>(Language::System, &[]), Lang::ZhHans);
        assert_eq!(resolve(Language::System, &["", "  "]), Lang::ZhHans);
    }

    #[test]
    fn explicit_settings_resolve_without_the_os() {
        let s = Settings {
            language: Language::En,
            ..Settings::fixture()
        };
        assert_eq!(for_settings(&s), Lang::En);
        let s = Settings {
            language: Language::ZhHans,
            ..s
        };
        assert_eq!(for_settings(&s), Lang::ZhHans);
        // `system` reads the real OS list; whatever it is, it resolves without panicking.
        let _ = for_settings(&Settings::fixture());
    }

    #[test]
    fn chinese_copy_is_unchanged() {
        let zh: Vec<&str> = Text::ALL.iter().map(|t| t.get(Lang::ZhHans)).collect();
        assert_eq!(
            zh,
            [
                "WeekPage",
                "显示 WeekPage",
                "日历",
                "任务",
                "设置…",
                "开机自启",
                "退出 WeekPage"
            ]
        );
        assert_eq!(todo_due(Lang::ZhHans, "交房租"), "提醒：交房租");
        assert_eq!(
            task_due_tomorrow(Lang::ZhHans, "课程作业"),
            "「课程作业」明天截止"
        );
        assert_eq!(task_due(Lang::ZhHans, "课程作业"), "「课程作业」截止");
        assert_eq!(
            missed(Lang::ZhHans, 3, &["交房租".into(), "取快递".into()], true),
            "错过 3 条提醒：交房租、取快递…"
        );
    }

    #[test]
    fn english_copy() {
        let en: Vec<&str> = Text::ALL.iter().map(|t| t.get(Lang::En)).collect();
        assert_eq!(
            en,
            [
                "WeekPage",
                "Show WeekPage",
                "Calendar",
                "Tasks",
                "Settings…",
                "Open at Login",
                "Quit WeekPage"
            ]
        );
        assert_eq!(todo_due(Lang::En, "Pay rent"), "Reminder: Pay rent");
        assert_eq!(
            task_due_tomorrow(Lang::En, "Essay"),
            "“Essay” is due tomorrow"
        );
        assert_eq!(task_due(Lang::En, "Essay"), "“Essay” is due");
        assert_eq!(
            shortcut_taken(Lang::En, "⌃⌥Space", true),
            "Shortcut ⌃⌥Space is taken: open the menu bar icon → Settings to pick another"
        );
        assert_eq!(
            shortcut_taken(Lang::En, "Ctrl+Alt+Space", false),
            "Shortcut Ctrl+Alt+Space is taken: open the tray icon → Settings to pick another"
        );
    }

    #[test]
    fn english_missed_summary_singular_and_plural() {
        assert_eq!(
            missed(Lang::En, 1, &["“Essay” is due".into()], false),
            "Missed 1 reminder: “Essay” is due"
        );
        assert_eq!(
            missed(Lang::En, 2, &["Pay rent".into(), "Call mom".into()], false),
            "Missed 2 reminders: Pay rent, Call mom"
        );
        assert_eq!(
            missed(Lang::En, 5, &["Pay rent".into(), "Call mom".into()], true),
            "Missed 5 reminders: Pay rent, Call mom…"
        );
    }

    #[test]
    fn step_digest_copy() {
        let a = step_label("交会议 PPT", "找同事过一遍");
        assert_eq!(a, "交会议 PPT · 找同事过一遍");
        let b = step_label("orbit 域名备案", "管局通过");
        assert_eq!(
            steps_overdue(Lang::ZhHans, 2, &[a.clone(), b.clone()], false),
            "2 步逾期：交会议 PPT · 找同事过一遍、orbit 域名备案 · 管局通过"
        );
        assert_eq!(
            steps_overdue(Lang::ZhHans, 5, &[a.clone(), b.clone()], true),
            "5 步逾期：交会议 PPT · 找同事过一遍、orbit 域名备案 · 管局通过…"
        );
        assert_eq!(
            steps_due_today(
                Lang::ZhHans,
                1,
                &[step_label("注册美卡", "去查审批")],
                false
            ),
            "今天到期 1 步：注册美卡 · 去查审批"
        );
        assert_eq!(
            steps_overdue(Lang::En, 1, &["A".into()], false),
            "1 step overdue: A"
        );
        assert_eq!(
            steps_overdue(Lang::En, 2, &["A".into(), "B".into()], false),
            "2 steps overdue: A, B"
        );
        assert_eq!(
            steps_due_today(Lang::En, 1, &["A".into()], false),
            "1 step due today: A"
        );
        assert_eq!(
            steps_due_today(Lang::En, 3, &["A".into(), "B".into()], true),
            "3 steps due today: A, B…"
        );
    }

    #[test]
    fn every_text_is_non_empty_in_both_languages() {
        for t in Text::ALL {
            assert!(!t.get(Lang::ZhHans).is_empty(), "{t:?} zh");
            assert!(!t.get(Lang::En).is_empty(), "{t:?} en");
        }
    }
}
