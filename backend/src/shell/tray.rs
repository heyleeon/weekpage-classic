//! Tray / menu bar icon and menu (ui-spec §1.1).
//!
//! Menu: 显示 WeekPage (with the current shortcut) / 日历 / 任务 / ─ / 设置… / 开机自启 ✓ / ─ /
//! 退出 WeekPage, in the UI language (`crate::i18n`, English: Show WeekPage / Calendar / Tasks /
//! Settings… / Open at Login / Quit WeekPage). Left click: macOS opens the menu, Windows toggles
//! the window (`platform::tray_left_click_shows_menu`). The menu (and the tooltip) is rebuilt
//! when the shortcut, autostart or language changes. The menu bar icon can silently fail to
//! appear (lessons.md 2026-10-04 04:43:57), so the shortcut and Spotlight / Start menu stay as the
//! other two entries.
//!
//! Overdue dot: while at least one step is overdue (`reminders::has_overdue_steps`: an open
//! do / wait / check key point dated before today on a live, unfinished task) the icon carries a
//! small red dot at its top-right, so the user notices with the window hidden
//! (`platform::set_tray_badge`: a red circle view on the macOS template icon, a composited copy
//! of the coloured icon on Windows). [`refresh_badge`] runs on every reminder heartbeat (30 s,
//! first one at startup) and right after the main window hides (ticking a step, then hiding,
//! updates it at once); the native call only happens when the state changes. A failed refresh
//! only logs a warning and is retried by the next one.

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use super::{ShellState, lock, settings_apply, window};
use crate::AppState;
use crate::error::AppError;
use crate::i18n::{self, Lang, Text};
use crate::model::{NavigatePayload, NavigateTarget, Settings, SettingsPatch, ShownReason};
use crate::platform;

pub const TRAY_ID: &str = "main";

const ID_SHOW: &str = "show";
const ID_CALENDAR: &str = "calendar";
const ID_TASKS: &str = "tasks";
const ID_SETTINGS: &str = "settings";
const ID_AUTOSTART: &str = "autostart";
const ID_QUIT: &str = "quit";

static TEMPLATE_ICON: &[u8] = include_bytes!("../../icons/tray-template.png");

fn show_item<R: Runtime>(
    app: &AppHandle<R>,
    lang: Lang,
    shortcut: &str,
) -> tauri::Result<MenuItem<R>> {
    let label = Text::TrayShow.get(lang);
    // The accelerator is only displayed (menu key equivalent); fall back to plain text when the
    // menu library cannot parse it.
    MenuItem::with_id(app, ID_SHOW, label, true, Some(shortcut))
        .or_else(|_| MenuItem::with_id(app, ID_SHOW, label, true, None::<&str>))
}

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: Text,
    lang: Lang,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text.get(lang), true, None::<&str>)
}

fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    settings: &Settings,
    lang: Lang,
) -> tauri::Result<Menu<R>> {
    let show = show_item(app, lang, &settings.shortcut)?;
    let calendar = item(app, ID_CALENDAR, Text::TrayCalendar, lang)?;
    let tasks = item(app, ID_TASKS, Text::TrayTasks, lang)?;
    let prefs = item(app, ID_SETTINGS, Text::TraySettings, lang)?;
    let autostart = CheckMenuItem::with_id(
        app,
        ID_AUTOSTART,
        Text::TrayAutostart.get(lang),
        true,
        settings.autostart,
        None::<&str>,
    )?;
    let quit = item(app, ID_QUIT, Text::TrayQuit, lang)?;
    Menu::with_items(
        app,
        &[
            &show,
            &calendar,
            &tasks,
            &PredefinedMenuItem::separator(app)?,
            &prefs,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

fn icon<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Image<'static>> {
    if platform::tray_icon_is_template() {
        return Image::from_bytes(TEMPLATE_ICON);
    }
    match app.default_window_icon() {
        Some(i) => Ok(i.clone().to_owned()),
        None => Image::from_bytes(TEMPLATE_ICON),
    }
}

fn show_then_navigate<R: Runtime>(app: &AppHandle<R>, page: NavigateTarget) {
    if let Err(e) = window::show_main(app, ShownReason::Tray) {
        log::warn!("tray: show failed: {e}");
    }
    super::emit(app, NavigatePayload { page });
}

fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        ID_SHOW => {
            if let Err(e) = window::show_main(app, ShownReason::Tray) {
                log::warn!("tray: show failed: {e}");
            }
        }
        ID_CALENDAR => show_then_navigate(app, NavigateTarget::Calendar),
        ID_TASKS => show_then_navigate(app, NavigateTarget::Tasks),
        ID_SETTINGS => show_then_navigate(app, NavigateTarget::Settings),
        ID_AUTOSTART => {
            let next = !super::read_settings(app).autostart;
            let patch = SettingsPatch {
                autostart: Some(next),
                ..Default::default()
            };
            if let Err(e) = settings_apply::save_and_apply(app, &patch) {
                log::warn!("tray: autostart toggle failed: {e}");
                refresh(app);
            }
        }
        ID_QUIT => super::quit(app),
        other => log::debug!("tray: unknown menu item {other}"),
    }
}

fn on_tray_event<R: Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    if platform::tray_left_click_shows_menu() {
        return;
    }
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
        && let Err(e) = window::toggle(tray.app_handle(), ShownReason::Tray)
    {
        log::warn!("tray: toggle failed: {e}");
    }
}

/// Creates the tray icon (once, in `shell::setup`).
pub fn create<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), AppError> {
    let lang = i18n::for_settings(settings);
    let menu = build_menu(app, settings, lang)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(app)?)
        .icon_as_template(platform::tray_icon_is_template())
        .tooltip(Text::AppName.get(lang))
        .menu(&menu)
        .show_menu_on_left_click(platform::tray_left_click_shows_menu())
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_event)
        .build(app)?;
    log::info!("tray icon created");
    Ok(())
}

/// Rebuilds the menu from the stored settings (shortcut label, autostart check mark, language)
/// and relabels the tooltip.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let settings = super::read_settings(app);
    let lang = i18n::for_settings(&settings);
    match build_menu(app, &settings, lang) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                log::warn!("tray: menu refresh failed: {e}");
            }
        }
        Err(e) => log::warn!("tray: menu rebuild failed: {e}"),
    }
    if let Err(e) = tray.set_tooltip(Some(Text::AppName.get(lang))) {
        log::warn!("tray: tooltip refresh failed: {e}");
    }
}

/// Shows the overdue dot when at least one step is overdue, removes it otherwise; the native call
/// only happens when that changes. Blocking (the tray is changed on the main thread and this waits
/// for it): call it from the heartbeat or through [`refresh_badge_soon`], never on the main
/// thread. The state lock is held from the query to the native call, so two refreshes cannot
/// apply their answers out of order.
pub fn refresh_badge<R: Runtime>(app: &AppHandle<R>) {
    let (Some(state), Some(shell)) = (app.try_state::<AppState>(), app.try_state::<ShellState>())
    else {
        return;
    };
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let mut shown = lock(&shell.tray_badge);
    let today = state.clock.today();
    let overdue = match state
        .db
        .with_conn(|c| crate::reminders::has_overdue_steps(c, &today))
    {
        Ok(v) => v,
        Err(e) => {
            log::warn!("tray: overdue check failed: {e}");
            return;
        }
    };
    if *shown == overdue {
        return;
    }
    let applied = icon(app)
        .map_err(AppError::from)
        .and_then(|plain| platform::set_tray_badge(&tray, &plain, overdue));
    match applied {
        Ok(()) => {
            *shown = overdue;
            log::info!(
                "tray: overdue dot {}",
                if overdue { "shown" } else { "removed" }
            );
        }
        Err(e) => log::warn!("tray: overdue dot update failed: {e}"),
    }
}

/// [`refresh_badge`] on a blocking worker (safe from any thread, the main thread included).
pub fn refresh_badge_soon<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || refresh_badge(&app));
}
