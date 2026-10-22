//! Side effects of a settings change (architecture §6.3): only for fields that actually
//! changed — shortcut (re-register, roll back on failure), autostart, theme (`set_theme`),
//! hide-on-blur, timezone (the app clock), language (relabel the tray menu and the window title; notifications read it when
//! they are sent).
//! `calendarWeeks`, `calendarFirstRow`, `lastPage`, `todoDoneCollapsed`,
//! `onboardingShortcutHintSeen` are storage only: switching page or weeks never touches the
//! global shortcut.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

use super::{ShellState, shortcut};
use crate::AppState;
use crate::commands::{is_dev, settings_defaults};
use crate::db;
use crate::error::AppError;
use crate::i18n::{self, Text};
use crate::model::{Settings, SettingsPatch, ShortcutStatus, Theme};

/// Settings cache key marking "the release build already turned autostart on once".
const AUTOSTART_INIT_KEY: &str = "cache:shell-autostart-initialized";

/// Which side effects a settings change needs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Changes {
    pub shortcut: bool,
    pub autostart: bool,
    pub theme: bool,
    pub hide_on_blur: bool,
    pub language: bool,
    pub timezone: bool,
}

impl Changes {
    pub fn any(&self) -> bool {
        self.shortcut
            || self.autostart
            || self.theme
            || self.hide_on_blur
            || self.language
            || self.timezone
    }
}

/// Pure diff: only the six fields with side effects count.
pub fn diff(old: &Settings, new: &Settings) -> Changes {
    Changes {
        shortcut: old.shortcut != new.shortcut,
        autostart: old.autostart != new.autostart,
        theme: old.theme != new.theme,
        hide_on_blur: old.hide_on_blur != new.hide_on_blur,
        language: old.language != new.language,
        timezone: old.timezone != new.timezone,
    }
}

/// `system` → follow the OS (None).
pub fn tauri_theme(theme: Theme) -> Option<tauri::Theme> {
    match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    }
}

/// Applies the difference between `old` and `new`; returns the resulting shortcut status.
pub fn apply<R: Runtime>(app: &AppHandle<R>, old: &Settings, new: &Settings) -> ShortcutStatus {
    let changes = diff(old, new);
    if !changes.any() {
        return shortcut::status(app);
    }
    let mut status = None;
    if changes.shortcut {
        let st = shortcut::reregister(app, &old.shortcut, &new.shortcut);
        if st.accelerator != new.shortcut {
            // The new combo did not take: keep the stored setting on the combo in effect.
            restore_shortcut(app, &st.accelerator);
        }
        status = Some(st);
    }
    if changes.autostart {
        set_autostart(app, new.autostart);
    }
    if changes.theme {
        apply_theme(app, new.theme);
    }
    if changes.hide_on_blur
        && let Some(s) = app.try_state::<ShellState>()
    {
        s.hide_on_blur.store(new.hide_on_blur, Ordering::SeqCst);
        log::info!("hide on blur: {}", new.hide_on_blur);
    }
    if changes.language {
        log::info!("language setting: {:?}", new.language);
        apply_window_title(app, new);
    }
    if changes.timezone {
        log::info!("timezone setting: {}", new.timezone);
        crate::clock::set_timezone(&new.timezone);
    }
    if changes.autostart || changes.shortcut || changes.language {
        super::tray::refresh(app);
    }
    status.unwrap_or_else(|| shortcut::status(app))
}

/// Same path as the `update_settings` command, for changes made from the tray menu.
pub fn save_and_apply<R: Runtime>(
    app: &AppHandle<R>,
    patch: &SettingsPatch,
) -> Result<ShortcutStatus, AppError> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| AppError::platform("app state not ready"))?;
    let defaults = settings_defaults(app);
    let now = state.clock.now_ms();
    let (old, new) = state
        .db
        .with_tx(|tx| db::settings::merge(tx, &defaults, patch, now))?;
    Ok(apply(app, &old, &new))
}

fn restore_shortcut<R: Runtime>(app: &AppHandle<R>, accelerator: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let defaults = settings_defaults(app);
    let now = state.clock.now_ms();
    let patch = SettingsPatch {
        shortcut: Some(accelerator.to_string()),
        ..Default::default()
    };
    match state
        .db
        .with_tx(|tx| db::settings::merge(tx, &defaults, &patch, now))
    {
        Ok(_) => log::info!("settings: shortcut rolled back to {accelerator}"),
        Err(e) => log::warn!("settings: shortcut rollback failed: {e}"),
    }
}

/// Sets the theme of every window (`system` → None = follow the OS).
pub fn apply_theme<R: Runtime>(app: &AppHandle<R>, theme: Theme) {
    for (label, window) in app.webview_windows() {
        if let Err(e) = window.set_theme(tauri_theme(theme)) {
            log::warn!("set_theme on {label} failed: {e}");
        }
    }
}

/// Names every window in the UI language. The window has no title bar, but the title still shows
/// in Mission Control, screen-sharing pickers, the Windows task switcher and VoiceOver.
pub fn apply_window_title<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    let title = Text::AppName.get(i18n::for_settings(settings));
    for (label, window) in app.webview_windows() {
        if let Err(e) = window.set_title(title) {
            log::warn!("set_title on {label} failed: {e}");
        }
    }
}

/// Turns the login item on / off. The development identity never registers one (it would
/// point at a build artifact and fight the installed release build).
pub fn set_autostart<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    if is_dev(app) {
        log::info!("autostart {enabled} requested: ignored for the development identity");
        return;
    }
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    match result {
        Ok(()) => log::info!("autostart set to {enabled}"),
        Err(e) => log::warn!("autostart {enabled} failed: {e}"),
    }
}

/// Release identity, first launch: register the login item when the setting says so (default
/// true). Later launches leave the OS state alone (the user may have removed it there).
pub fn init_autostart<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    if is_dev(app) {
        return;
    }
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let done = state
        .db
        .with_conn(|c| db::settings::get_cache(c, AUTOSTART_INIT_KEY))
        .ok()
        .flatten()
        .is_some();
    if done {
        return;
    }
    if settings.autostart {
        set_autostart(app, true);
    }
    let now = state.clock.now_ms();
    if let Err(e) = state
        .db
        .with_conn(|c| db::settings::set_cache(c, AUTOSTART_INIT_KEY, "true", now))
    {
        log::warn!("autostart: remembering the first-launch setup failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CalendarFirstRow, Language, LastPage};

    #[test]
    fn page_and_weeks_changes_have_no_side_effects() {
        let old = Settings::fixture();
        let new = Settings {
            last_page: LastPage::Tasks,
            calendar_weeks: 4,
            calendar_first_row: CalendarFirstRow::LastWeek,
            todo_done_collapsed: true,
            onboarding_shortcut_hint_seen: true,
            ..old.clone()
        };
        let c = diff(&old, &new);
        assert_eq!(c, Changes::default());
        assert!(!c.any());
        assert!(
            !c.shortcut,
            "switching page must not re-register the shortcut"
        );
    }

    #[test]
    fn each_side_effect_field_is_detected_alone() {
        let old = Settings::fixture();
        let c = diff(
            &old,
            &Settings {
                shortcut: "Control+Alt+Shift+Space".into(),
                ..old.clone()
            },
        );
        assert_eq!(
            c,
            Changes {
                shortcut: true,
                ..Changes::default()
            }
        );
        let c = diff(
            &old,
            &Settings {
                theme: Theme::Dark,
                hide_on_blur: false,
                ..old.clone()
            },
        );
        assert_eq!(
            c,
            Changes {
                theme: true,
                hide_on_blur: true,
                ..Changes::default()
            }
        );
        let c = diff(
            &old,
            &Settings {
                autostart: !old.autostart,
                ..old.clone()
            },
        );
        assert!(c.autostart && !c.shortcut && !c.theme && !c.hide_on_blur && !c.language);
        let c = diff(
            &old,
            &Settings {
                language: Language::En,
                ..old.clone()
            },
        );
        assert_eq!(
            c,
            Changes {
                language: true,
                ..Changes::default()
            }
        );
        assert!(c.any(), "a language change relabels the tray menu");
        let c = diff(
            &old,
            &Settings {
                timezone: "Asia/Tokyo".into(),
                ..old.clone()
            },
        );
        assert_eq!(
            c,
            Changes {
                timezone: true,
                ..Changes::default()
            }
        );
        assert!(
            !c.shortcut,
            "a language change must not re-register the shortcut"
        );
    }

    #[test]
    fn same_value_written_again_is_not_a_change() {
        let old = Settings::fixture();
        assert!(!diff(&old, &old.clone()).any());
    }

    #[test]
    fn theme_mapping() {
        assert_eq!(tauri_theme(Theme::System), None);
        assert_eq!(tauri_theme(Theme::Light), Some(tauri::Theme::Light));
        assert_eq!(tauri_theme(Theme::Dark), Some(tauri::Theme::Dark));
    }
}
