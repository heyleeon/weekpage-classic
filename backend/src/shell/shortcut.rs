//! Global shortcut: register / re-register, toggle the window, report failures
//! (ui-spec §1.1).
//!
//! - Only `ShortcutState::Pressed` toggles (the plugin calls us on press and on release).
//! - Re-registration unregisters the old combo first; when the new one fails the old one is
//!   registered again and the returned status says so.
//! - Every change is published as `shell://shortcut-status`; the first time no shortcut at all is
//!   active, a system notification says so (Carbon on macOS does not report cross-app clashes,
//!   so the frontend also shows a first-run hint).
//! - `conflict` names an enabled macOS system shortcut on the same combo (D4: ⌃⌥Space is the
//!   input-source switch), re-checked on every show so turning it off in System Settings clears it.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use super::{ShellState, lock, window};
use crate::i18n::{self, Lang, Text};
use crate::model::{Platform, ShortcutStatus, ShownReason};
use crate::platform::{self, accelerator};

/// What is registered right now.
#[derive(Debug, Clone, Default)]
pub struct Registration {
    pub status: Option<ShortcutStatus>,
    pub shortcut: Option<Shortcut>,
}

// ── Pure ─────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dispatch {
    Toggle,
    Ignore,
}

/// Press of our registered combo → toggle; releases and unknown combos → ignore.
pub fn dispatch(state: ShortcutState, pressed_id: u32, registered_id: Option<u32>) -> Dispatch {
    if state == ShortcutState::Pressed && registered_id == Some(pressed_id) {
        Dispatch::Toggle
    } else {
        Dispatch::Ignore
    }
}

/// Why an accelerator is refused before it reaches the OS. The `Display` text goes into
/// `ShortcutStatus.error`; its first word is what the frontend switches on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    Unparsable,
    NoModifier,
    KeyNotAllowed,
    Reserved,
}

impl Invalid {
    pub fn message(&self, accelerator: &str) -> String {
        match self {
            Invalid::Unparsable => format!("invalid accelerator: {accelerator:?}"),
            Invalid::NoModifier => format!("invalid accelerator, needs a modifier: {accelerator}"),
            Invalid::KeyNotAllowed => {
                format!("invalid accelerator, key not allowed: {accelerator}")
            }
            Invalid::Reserved => format!("reserved system shortcut: {accelerator}"),
        }
    }
}

/// Combos the system owns and that cannot be given up (ui-spec §16.3). ⌃⌥Space is NOT here on
/// macOS: it is the user's chosen default (D4) and is reported as a `conflict` instead.
fn reserved(a: &accelerator::Accel, platform: Platform) -> bool {
    let only = |ctrl: bool, alt: bool, shift: bool, meta: bool| {
        a.ctrl == ctrl && a.alt == alt && a.shift == shift && a.meta == meta
    };
    match platform {
        Platform::Macos => {
            (a.key == "Space"
                && (only(false, false, false, true) || only(true, false, false, false)))
                || (a.key == "Tab" && a.meta)
        }
        _ => {
            a.meta
                || (a.key == "Space" && only(true, false, false, false))
                || (a.key == "Tab" && a.alt)
                || (a.key == "F4" && only(false, true, false, false))
                || (a.key == "Delete" && a.ctrl && a.alt)
        }
    }
}

/// Validates an accelerator (must have Ctrl / Alt / ⌘ — Shift alone only with F-keys; main key
/// A–Z, 0–9, Space or F1–F12; not a reserved system combo). Returns the canonical spelling.
pub fn validate(accelerator: &str, platform: Platform) -> Result<String, Invalid> {
    let a = accelerator::parse(accelerator, platform).ok_or(Invalid::Unparsable)?;
    if reserved(&a, platform) {
        return Err(Invalid::Reserved);
    }
    if !accelerator::is_allowed_main_key(&a.key) {
        return Err(Invalid::KeyNotAllowed);
    }
    let function_key = a.key.starts_with('F') && a.key.len() > 1;
    if !a.has_strong_modifier() && !(a.shift && function_key) {
        return Err(Invalid::NoModifier);
    }
    Ok(a.canonical())
}

/// The accelerator as the user reads it (⌃⌥Space / Ctrl+Alt+Space); the raw text when unparsable.
pub fn display(accelerator: &str, platform: Platform) -> String {
    accelerator::parse(accelerator, platform)
        .map(|a| a.display(platform))
        .unwrap_or_else(|| accelerator.to_string())
}

/// Body of the one-time "shortcut taken" notification, in the UI language (`i18n`).
pub fn failure_notice(accelerator: &str, platform: Platform, lang: Lang) -> String {
    i18n::shortcut_taken(
        lang,
        &display(accelerator, platform),
        platform == Platform::Macos,
    )
}

// ── Effects ──────────────────────────────────────────────────────────────────────────────────

/// Plugin handler for every shortcut event.
pub fn on_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    let registered = app
        .try_state::<ShellState>()
        .and_then(|s| lock(&s.shortcut).shortcut.map(|r| r.id()));
    if dispatch(event.state, shortcut.id(), registered) == Dispatch::Toggle
        && let Err(e) = window::toggle(app, ShownReason::Shortcut)
    {
        log::warn!("shortcut toggle failed: {e}");
    }
}

/// Current registration state for `app_info` (conflict re-checked live).
pub fn status<R: Runtime>(app: &AppHandle<R>) -> ShortcutStatus {
    let current = app
        .try_state::<ShellState>()
        .and_then(|s| lock(&s.shortcut).status.clone());
    match current {
        Some(mut s) => {
            s.conflict = platform::system_shortcut_conflict(&s.accelerator);
            s
        }
        None => {
            let accelerator = super::read_settings(app).shortcut;
            ShortcutStatus {
                conflict: platform::system_shortcut_conflict(&accelerator),
                accelerator,
                registered: false,
                error: None,
            }
        }
    }
}

fn try_register<R: Runtime>(app: &AppHandle<R>, accelerator: &str) -> Result<Shortcut, String> {
    let canonical =
        validate(accelerator, platform::current()).map_err(|e| e.message(accelerator))?;
    let shortcut: Shortcut = canonical
        .parse()
        .map_err(|e| format!("invalid accelerator: {accelerator:?} ({e})"))?;
    app.global_shortcut()
        .register(shortcut)
        .map_err(|e| format!("registration failed: {e}"))?;
    Ok(shortcut)
}

fn unregister<R: Runtime>(app: &AppHandle<R>, shortcut: Option<Shortcut>) {
    if let Some(s) = shortcut
        && let Err(e) = app.global_shortcut().unregister(s)
    {
        log::warn!("unregistering the old shortcut failed: {e}");
    }
}

/// Stores, emits and (first time nothing is active) notifies about a new status.
fn publish<R: Runtime>(app: &AppHandle<R>, status: ShortcutStatus, shortcut: Option<Shortcut>) {
    if let Some(s) = app.try_state::<ShellState>() {
        *lock(&s.shortcut) = Registration {
            status: Some(status.clone()),
            shortcut,
        };
        if !status.registered && !s.shortcut_failure_notified.swap(true, Ordering::SeqCst) {
            let lang = i18n::for_settings(&super::read_settings(app));
            let body = failure_notice(&status.accelerator, platform::current(), lang);
            if let Err(e) = platform::notify(app, Text::AppName.get(lang), &body) {
                log::warn!("shortcut failure notification failed: {e}");
            }
        }
    }
    if let Some(err) = &status.error {
        log::warn!("global shortcut {}: {err}", status.accelerator);
    }
    super::emit(app, status);
    super::tray::refresh(app);
}

/// Startup: registers the configured shortcut.
pub fn register_initial<R: Runtime>(app: &AppHandle<R>, accelerator: &str) -> ShortcutStatus {
    let (registered, shortcut, error) = match try_register(app, accelerator) {
        Ok(s) => (true, Some(s), None),
        Err(e) => (false, None, Some(e)),
    };
    let status = ShortcutStatus {
        accelerator: accelerator.to_string(),
        registered,
        error,
        conflict: platform::system_shortcut_conflict(accelerator),
    };
    publish(app, status.clone(), shortcut);
    status
}

/// Settings change: unregister `old`, register `new`; on failure register `old` again.
/// The returned status's `accelerator` is the combo in effect afterwards (== `new` on success).
pub fn reregister<R: Runtime>(app: &AppHandle<R>, old: &str, new: &str) -> ShortcutStatus {
    let Some(shell) = app.try_state::<ShellState>() else {
        return status(app);
    };
    let _op = lock(&shell.shortcut_op);
    let previous = lock(&shell.shortcut).shortcut;

    if let Err(invalid) = validate(new, platform::current()) {
        // Refused before touching the OS: the old registration stays as it is.
        let status = ShortcutStatus {
            accelerator: old.to_string(),
            registered: previous.is_some(),
            error: Some(invalid.message(new)),
            conflict: platform::system_shortcut_conflict(old),
        };
        publish(app, status.clone(), previous);
        return status;
    }

    unregister(app, previous);
    match try_register(app, new) {
        Ok(s) => {
            log::info!("global shortcut changed: {old} -> {new}");
            let status = ShortcutStatus {
                accelerator: new.to_string(),
                registered: true,
                error: None,
                conflict: platform::system_shortcut_conflict(new),
            };
            publish(app, status.clone(), Some(s));
            status
        }
        Err(err) => {
            log::warn!("global shortcut {new} failed ({err}), rolling back to {old}");
            let back = try_register(app, old);
            let status = ShortcutStatus {
                accelerator: old.to_string(),
                registered: back.is_ok(),
                error: Some(err),
                conflict: platform::system_shortcut_conflict(old),
            };
            publish(app, status.clone(), back.ok());
            status
        }
    }
}

/// Re-checks the system-shortcut conflict (the user may have turned the system item off while
/// we were hidden) and emits a new status only when it changed.
pub fn refresh_conflict<R: Runtime>(app: &AppHandle<R>) {
    let Some(shell) = app.try_state::<ShellState>() else {
        return;
    };
    let updated = {
        let mut reg = lock(&shell.shortcut);
        let Some(status) = reg.status.as_mut() else {
            return;
        };
        let conflict = platform::system_shortcut_conflict(&status.accelerator);
        if conflict == status.conflict {
            return;
        }
        status.conflict = conflict;
        status.clone()
    };
    log::info!(
        "shortcut conflict for {} is now {:?}",
        updated.accelerator,
        updated.conflict
    );
    super::emit(app, updated);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn only_pressed_of_our_combo_toggles() {
        let ours = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space).id();
        let other = Shortcut::new(Some(Modifiers::SUPER), Code::KeyK).id();
        assert_eq!(
            dispatch(ShortcutState::Pressed, ours, Some(ours)),
            Dispatch::Toggle
        );
        assert_eq!(
            dispatch(ShortcutState::Released, ours, Some(ours)),
            Dispatch::Ignore
        );
        assert_eq!(
            dispatch(ShortcutState::Pressed, other, Some(ours)),
            Dispatch::Ignore
        );
        assert_eq!(
            dispatch(ShortcutState::Pressed, ours, None),
            Dispatch::Ignore
        );
    }

    #[test]
    fn one_press_and_release_toggles_once() {
        let id = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space).id();
        let toggles = [ShortcutState::Pressed, ShortcutState::Released]
            .into_iter()
            .filter(|s| dispatch(*s, id, Some(id)) == Dispatch::Toggle)
            .count();
        assert_eq!(toggles, 1);
    }

    #[test]
    fn canonical_matches_plugin_parsing() {
        let canonical = validate("alt+control+space", Platform::Macos).unwrap();
        assert_eq!(canonical, "Control+Alt+Space");
        let parsed: Shortcut = canonical.parse().unwrap();
        assert_eq!(
            parsed.id(),
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space).id()
        );
        let dev: Shortcut = validate("Control+Alt+Shift+Space", Platform::Windows)
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            dev.id(),
            Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
                Code::Space
            )
            .id()
        );
    }

    #[test]
    fn accelerator_validation() {
        use Platform::{Macos, Windows};
        assert!(validate("Control+Alt+Space", Macos).is_ok());
        assert!(validate("Control+Alt+Space", Windows).is_ok());
        assert!(validate("Super+Shift+K", Macos).is_ok());
        assert!(validate("Alt+1", Windows).is_ok());
        assert!(validate("Shift+F5", Windows).is_ok());
        assert_eq!(validate("Space", Macos), Err(Invalid::NoModifier));
        assert_eq!(validate("Shift+A", Macos), Err(Invalid::NoModifier));
        assert_eq!(
            validate("Control+Enter", Macos),
            Err(Invalid::KeyNotAllowed)
        );
        assert_eq!(
            validate("Control+F13", Windows),
            Err(Invalid::KeyNotAllowed)
        );
        assert_eq!(validate("Control+", Macos), Err(Invalid::Unparsable));
        assert_eq!(validate("", Macos), Err(Invalid::Unparsable));
    }

    #[test]
    fn reserved_system_combos_are_refused() {
        use Platform::{Macos, Windows};
        assert_eq!(validate("Super+Space", Macos), Err(Invalid::Reserved));
        assert_eq!(validate("Control+Space", Macos), Err(Invalid::Reserved));
        assert_eq!(validate("Super+Tab", Macos), Err(Invalid::Reserved));
        assert_eq!(validate("Super+K", Windows), Err(Invalid::Reserved));
        assert_eq!(validate("Control+Space", Windows), Err(Invalid::Reserved));
        assert_eq!(validate("Alt+Tab", Windows), Err(Invalid::Reserved));
        assert_eq!(validate("Alt+F4", Windows), Err(Invalid::Reserved));
        // D4: ⌃⌥Space is allowed on macOS (reported as a conflict, not refused).
        assert!(validate("Control+Alt+Space", Macos).is_ok());
        // ⌘Space with more modifiers is a different combo.
        assert!(validate("Alt+Super+Space", Macos).is_ok());
    }

    #[test]
    fn invalid_messages_start_with_a_stable_word() {
        assert!(
            Invalid::Reserved
                .message("Super+Space")
                .starts_with("reserved")
        );
        assert!(Invalid::NoModifier.message("A").starts_with("invalid"));
        assert!(Invalid::Unparsable.message("").starts_with("invalid"));
    }

    #[test]
    fn display_and_failure_notice_follow_the_setting() {
        assert_eq!(display("Control+Alt+Space", Platform::Macos), "⌃⌥Space");
        assert_eq!(
            display("Control+Alt+Shift+Space", Platform::Windows),
            "Ctrl+Alt+Shift+Space"
        );
        assert_eq!(
            failure_notice("Control+Alt+Space", Platform::Macos, Lang::ZhHans),
            "快捷键 ⌃⌥Space 被占用，打开菜单栏图标 → 设置 换一个"
        );
        assert_eq!(
            failure_notice("Control+Alt+Space", Platform::Windows, Lang::ZhHans),
            "快捷键 Ctrl+Alt+Space 被占用，打开托盘图标 → 设置 换一个"
        );
        assert_eq!(
            failure_notice("Control+Alt+Space", Platform::Macos, Lang::En),
            "Shortcut ⌃⌥Space is taken: open the menu bar icon → Settings to pick another"
        );
    }
}
