//! Platform functions: the ONLY place allowed to use `cfg(target_os …)` (scripts/check-boundaries.sh).
//!
//! `shell/` and everything else call these functions instead of branching on the OS
//! (architecture §3). Pure helpers that every platform
//! compiles and tests live in `accelerator`, `system_shortcuts` and `tray_badge`.

pub mod accelerator;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub mod system_shortcuts;
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub mod tray_badge;

#[cfg(target_os = "macos")]
mod macos_notify;
#[cfg(target_os = "macos")]
mod macos_panel;
#[cfg(target_os = "macos")]
mod macos_prefs;
#[cfg(target_os = "macos")]
mod macos_trackpad;
#[cfg(target_os = "macos")]
mod macos_tray;
#[cfg(target_os = "windows")]
mod windows;

use tauri::image::Image;
use tauri::tray::TrayIcon;
use tauri::{App, AppHandle, Manager, RunEvent, Runtime, WebviewWindow};

use crate::error::AppError;
use crate::model::Platform;

/// Label of the only window (architecture §4).
const MAIN_LABEL: &str = "main";

/// The platform this binary was built for.
pub fn current() -> Platform {
    if cfg!(target_os = "macos") {
        Platform::Macos
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Other
    }
}

/// macOS: `ActivationPolicy::Accessory`, turn the main window into a non-activating NSPanel.
/// Windows / other: nothing.
pub fn setup<R: Runtime>(app: &mut App<R>) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        let skip = cfg!(debug_assertions) && std::env::var("WEEKPAGE_NO_PANEL").is_ok();
        match app.get_webview_window(MAIN_LABEL) {
            Some(_) if skip => log::warn!("WEEKPAGE_NO_PANEL set: panel conversion skipped"),
            Some(window) => macos_panel::convert(&window)?,
            None => log::warn!("platform setup: main window not found, panel conversion skipped"),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app.get_webview_window(MAIN_LABEL);
    }
    Ok(())
}

/// macOS: vibrancy `UnderWindowBackground`, radius 26. Windows: Mica on build >= 22000.
pub fn apply_window_effects<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        window.set_effects(
            EffectsBuilder::new()
                .effect(Effect::UnderWindowBackground)
                .state(EffectState::Active)
                .radius(26.0)
                .build(),
        )?;
        log::info!("window effects: vibrancy UnderWindowBackground applied");
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        windows::apply_effects(window)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        Ok(())
    }
}

/// Whether a native translucent material is in effect (false → frontend adds `.no-vibrancy` and
/// paints the solid `--window-fallback` ring): macOS true unless "Reduce transparency" is on;
/// Windows 11 true, Windows 10 false.
pub fn vibrancy_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        !macos_panel::reduce_transparency()
    }
    #[cfg(target_os = "windows")]
    {
        windows::mica_supported()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// macOS: reports trackpad fingers down (true) / lifted (false) from the scroll phases, so the page
/// can tell a resting swipe from a finished one. Windows / other: never called.
pub fn watch_trackpad(on_change: impl Fn(bool) + 'static) {
    #[cfg(target_os = "macos")]
    {
        macos_trackpad::watch(on_change);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = on_change;
    }
}

/// True for the macOS "reopen" event (Spotlight / Dock launch of a running app).
pub fn is_reopen(event: &RunEvent) -> bool {
    #[cfg(target_os = "macos")]
    {
        matches!(event, RunEvent::Reopen { .. })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = event;
        false
    }
}

/// macOS: left click on the tray opens the menu; Windows: left click toggles the window.
pub fn tray_left_click_shows_menu() -> bool {
    cfg!(target_os = "macos")
}

/// macOS: the tray icon is a template image (follows the menu bar's light / dark look).
/// Windows: a black template glyph would vanish on a dark taskbar, use the app icon instead.
pub fn tray_icon_is_template() -> bool {
    cfg!(target_os = "macos")
}

/// Shows (`on`) or removes the "overdue steps" red dot on the tray / menu bar icon.
///
/// - macOS: the icon is a template image, which cannot carry colour; a small red circle view is
///   added to (or removed from) the status item's button, above the glyph's top-right corner.
///   `plain` is not used.
/// - Windows / other: the icon is the coloured app icon; `plain` is that icon without the dot, and
///   the tray shows either a copy with the dot composited into its top-right corner
///   ([`tray_badge::with_dot`]) or `plain` itself.
pub fn set_tray_badge<R: Runtime>(
    tray: &TrayIcon<R>,
    plain: &Image<'_>,
    on: bool,
) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let _ = plain;
        macos_tray::set_badge(tray, on)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let icon = if on {
            let (w, h) = (plain.width(), plain.height());
            Image::new_owned(tray_badge::with_dot(plain.rgba(), w, h), w, h)
        } else {
            plain.clone()
        };
        tray.set_icon(Some(icon))?;
        Ok(())
    }
}

/// How monitor / cursor coordinates relate across screens.
///
/// - macOS (true): AppKit's desktop is one space in points. tao reports a monitor's "physical"
///   rect as points × that monitor's own scale and the cursor as points × the primary monitor's
///   scale, so with mixed scales the physical numbers of different screens overlap. Divide each
///   by its own scale to compare, and position windows with logical coordinates.
/// - Windows (false): physical pixels form one virtual desktop; compare and position physically.
pub fn logical_desktop() -> bool {
    cfg!(target_os = "macos")
}

/// Shows and focuses the window. macOS: `makeKeyAndOrderFront` on the main thread.
pub fn show_panel<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        macos_panel::show(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.show()?;
        window.set_focus()?;
        Ok(())
    }
}

/// Hides the window. macOS: `orderOut` on the main thread.
pub fn hide_panel<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        macos_panel::hide(window)
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.hide()?;
        Ok(())
    }
}

/// Sends a system notification. macOS: UNUserNotificationCenter, only when the process runs from
/// a real `.app` bundle (otherwise a warning; never crashes); authorization is requested right
/// before the first notification. Windows / other: tauri-plugin-notification.
pub fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos_notify::send(title, body)
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| AppError::platform(format!("notification failed: {e}")))
    }
}

/// The user's preferred UI languages, most preferred first, as BCP 47 tags (`zh-Hans-CN`,
/// `en-US`). macOS: `CFLocaleCopyPreferredLanguages` (honours the per-app language set in System
/// Settings); Windows: `GetUserPreferredUILanguages`. Empty when the OS reports nothing.
pub fn preferred_languages() -> Vec<String> {
    sys_locale::get_locales().collect()
}

/// What a click on one of our notifications does (macOS; Windows toasts from the plugin
/// activate the app on their own).
pub fn on_notification_click(f: Box<dyn Fn() + Send + Sync>) {
    #[cfg(target_os = "macos")]
    {
        macos_notify::set_click_handler(f);
    }
    #[cfg(not(target_os = "macos"))]
    {
        drop(f);
    }
}

/// The enabled system shortcut that uses the same combo as `accelerator` (macOS reads
/// `com.apple.symbolichotkeys`), as a stable name like `input-source-next`; None elsewhere.
pub fn system_shortcut_conflict(accelerator: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        system_shortcuts::find_conflict(accelerator, &macos_prefs::read_symbolic_hotkeys())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = accelerator;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_platform_is_consistent() {
        let p = current();
        assert_eq!(tray_left_click_shows_menu(), p == Platform::Macos);
        assert_eq!(tray_icon_is_template(), p == Platform::Macos);
        assert_eq!(logical_desktop(), p == Platform::Macos);
    }

    #[test]
    fn non_reopen_events_are_not_reopen() {
        assert!(!is_reopen(&RunEvent::Ready));
    }

    #[test]
    fn conflict_check_never_panics() {
        // Reads the real preferences on macOS; whatever is there, an unknown combo is clean.
        assert_eq!(
            system_shortcut_conflict("Control+Alt+Shift+Super+F12"),
            None
        );
        let _ = system_shortcut_conflict("Control+Alt+Space");
    }
}
