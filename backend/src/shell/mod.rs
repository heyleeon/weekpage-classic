//! Window, shortcut, tray and settings side effects.
//!
//! No OS conditionals here — OS-specific calls go through `crate::platform`. Runtime state
//! (blur guard, quit flag, last show time, shortcut registration) lives in [`ShellState`],
//! managed in [`setup`]; `AppState` stays `{ db, clock }`.

pub mod settings_apply;
pub mod shortcut;
pub mod tray;
pub mod window;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager, RunEvent, Runtime};

use crate::AppState;
use crate::error::AppError;
use crate::model::{Settings, ShownReason, TrackpadPayload};
use crate::platform;

/// Command-line flag the autostart entry launches us with (lib.rs registers it).
pub const AUTOSTART_ARG: &str = "--autostart";
/// `WEEKPAGE_DEBUG_SMOKE=1` (debug builds only): show → hide → show → notify → exit 0.
const SMOKE_ENV: &str = "WEEKPAGE_DEBUG_SMOKE";

/// The shell's runtime state. Every field is touched from several threads.
pub struct ShellState {
    /// Reference count of "do not hide on blur" (drag, native dialog, shortcut recording).
    pub(crate) blur_guard: AtomicI32,
    /// Set right before a deliberate quit; `ExitRequested` is only let through when set.
    pub(crate) quitting: AtomicBool,
    /// Mirror of `settings.hideOnBlur`.
    pub(crate) hide_on_blur: AtomicBool,
    /// `window_ready` has been received (first frame rendered).
    pub(crate) ready: AtomicBool,
    /// A show requested before the first frame (shown once `window_ready` arrives).
    pub(crate) pending_show: Mutex<Option<ShownReason>>,
    /// Launched by the login item: stay hidden after the first frame.
    pub(crate) autostart_launch: bool,
    /// When the window was last shown (blur right after a show is ignored).
    pub(crate) shown_at: Mutex<Option<Instant>>,
    /// Bumped on every focus change; a pending blur check is stale once it moved on.
    pub(crate) focus_seq: AtomicU64,
    /// Global shortcut registration (see `shortcut.rs`).
    pub(crate) shortcut: Mutex<shortcut::Registration>,
    /// Serialises re-registrations (never held while emitting).
    pub(crate) shortcut_op: Mutex<()>,
    /// The "shortcut is taken" system notification was already shown in this run.
    pub(crate) shortcut_failure_notified: AtomicBool,
    /// Whether the tray icon shows the "overdue steps" dot (as last applied). Also serialises
    /// the refreshes (see `tray::refresh_badge`).
    pub(crate) tray_badge: Mutex<bool>,
}

impl ShellState {
    pub fn new(hide_on_blur: bool, autostart_launch: bool) -> Self {
        ShellState {
            blur_guard: AtomicI32::new(0),
            quitting: AtomicBool::new(false),
            hide_on_blur: AtomicBool::new(hide_on_blur),
            ready: AtomicBool::new(false),
            pending_show: Mutex::new(None),
            autostart_launch,
            shown_at: Mutex::new(None),
            focus_seq: AtomicU64::new(0),
            shortcut: Mutex::new(shortcut::Registration::default()),
            shortcut_op: Mutex::new(()),
            shortcut_failure_notified: AtomicBool::new(false),
            // The tray icon is created without the dot.
            tray_badge: Mutex::new(false),
        }
    }

    /// Milliseconds since the last show (None = never shown).
    pub(crate) fn ms_since_shown(&self) -> Option<u64> {
        lock(&self.shown_at).map(|t| u64::try_from(t.elapsed().as_millis()).unwrap_or(u64::MAX))
    }
}

/// Poison-tolerant lock (a panicked holder must not take the shell down with it).
pub(crate) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Current settings straight from the database (defaults when unreadable).
pub(crate) fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Settings {
    let defaults = crate::commands::settings_defaults(app);
    match app.try_state::<AppState>() {
        Some(state) => state
            .db
            .with_conn(|c| crate::db::settings::get(c, &defaults))
            .unwrap_or_else(|e| {
                log::warn!("shell: reading settings failed ({e}), using defaults");
                defaults
            }),
        None => defaults,
    }
}

/// Called from `setup` after the database is ready: shell state, window material, theme, window
/// title, global shortcut, tray, autostart, notification click, debug smoke.
pub fn setup<R: Runtime>(app: &mut App<R>) -> Result<(), AppError> {
    let handle = app.handle().clone();
    let settings = read_settings(&handle);
    let autostart_launch = std::env::args().any(|a| a == AUTOSTART_ARG);
    app.manage(ShellState::new(settings.hide_on_blur, autostart_launch));
    if autostart_launch {
        log::info!("launched by the login item: the window stays hidden");
    }

    match window::main_window(&handle) {
        Ok(w) => {
            if let Err(e) = platform::apply_window_effects(&w) {
                log::warn!("window effects failed: {e}");
            }
        }
        Err(e) => log::warn!("shell setup: {e}"),
    }
    settings_apply::apply_theme(&handle, settings.theme);
    settings_apply::apply_window_title(&handle, &settings);

    let status = shortcut::register_initial(&handle, &settings.shortcut);
    log::info!(
        "global shortcut {}: registered={} conflict={:?}",
        status.accelerator,
        status.registered,
        status.conflict
    );

    if let Err(e) = tray::create(&handle, &settings) {
        log::warn!("tray icon failed: {e}");
    }

    let trackpad = handle.clone();
    platform::watch_trackpad(move |touching| emit(&trackpad, TrackpadPayload { touching }));
    settings_apply::init_autostart(&handle, &settings);

    let click_app = handle.clone();
    platform::on_notification_click(Box::new(move || {
        if let Err(e) = window::show_main(&click_app, ShownReason::Notification) {
            log::warn!("notification click: show failed: {e}");
        }
    }));

    if cfg!(debug_assertions) && std::env::var(SMOKE_ENV).is_ok_and(|v| v.trim() == "1") {
        smoke(handle);
    }
    Ok(())
}

/// Single-instance callback: a second launch shows the existing window.
pub fn on_second_instance<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>) {
    log::info!(
        "second instance started ({} args), showing main window",
        argv.len()
    );
    if let Err(e) = window::show_main(app, ShownReason::SecondInstance) {
        log::warn!("second instance: show failed: {e}");
    }
}

/// Every `RunEvent`: Reopen (macOS Spotlight / Dock) shows the window; `ExitRequested` is only
/// let through after a deliberate quit (tray, settings, Cmd+Q).
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    if platform::is_reopen(event) {
        if let Err(e) = window::show_main(app, ShownReason::Reopen) {
            log::warn!("reopen: show failed: {e}");
        }
        return;
    }
    if let RunEvent::ExitRequested { code, api, .. } = event {
        let quitting = app
            .try_state::<ShellState>()
            .is_some_and(|s| s.quitting.load(Ordering::SeqCst));
        if quitting {
            log::info!("exit requested (code {code:?}): quitting");
        } else {
            log::info!("exit requested (code {code:?}) without a quit action: prevented");
            api.prevent_exit();
        }
    }
}

/// Quit for real (tray "quit", settings "quit", Cmd+Q from the frontend).
pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    log::info!("quit requested");
    if let Some(s) = app.try_state::<ShellState>() {
        s.quitting.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

/// Emits a typed event by its registered name without requiring `mount_events` (never panics).
pub fn emit<R: Runtime, E: tauri_specta::Event + Serialize + Clone>(
    app: &AppHandle<R>,
    payload: E,
) {
    if let Err(e) = app.emit(E::NAME, payload) {
        log::warn!("emit {} failed: {e}", E::NAME);
    }
}

/// Headless self-check for agents without a screen (README, "冒烟"). Logs `smoke: shown` /
/// `smoke: hidden` / `smoke: notify ok` / `smoke: ok`, then exits 0 (exit 1 on a failed step).
fn smoke<R: Runtime>(app: AppHandle<R>) {
    log::info!("smoke: scheduled");
    tauri::async_runtime::spawn(async move {
        let pause = |ms| tokio::time::sleep(Duration::from_millis(ms));
        let dump = |tag: &str| match window::main_window(&app) {
            Ok(w) => log::info!(
                "smoke: {tag} visible={:?} pos={:?} size={:?} focused={:?}",
                w.is_visible().ok(),
                w.outer_position().ok().map(|p| (p.x, p.y)),
                w.outer_size().ok().map(|s| (s.width, s.height)),
                w.is_focused().ok(),
            ),
            Err(e) => log::error!("smoke: {tag} no main window: {e}"),
        };
        let mut ok = true;
        // The frontend may not render in a bare binary; do not wait for `window_ready`.
        if let Some(s) = app.try_state::<ShellState>() {
            s.ready.store(true, Ordering::SeqCst);
        }
        pause(800).await;
        for (step, show) in [("shown", true), ("hidden", false), ("shown", true)] {
            let r = if show {
                window::show_main(&app, ShownReason::Launch)
            } else {
                window::hide(&app)
            };
            if let Err(e) = r {
                log::error!("smoke: {step} step failed: {e}");
                ok = false;
            }
            pause(600).await;
            let visible = window::main_window(&app)
                .ok()
                .and_then(|w| w.is_visible().ok());
            if visible != Some(show) {
                log::error!("smoke: expected visible={show}, got {visible:?}");
                ok = false;
            }
            dump(step);
        }
        match platform::notify(&app, "smoke", "smoke") {
            Ok(()) => log::info!("smoke: notify ok"),
            Err(e) => {
                log::error!("smoke: notify failed: {e}");
                ok = false;
            }
        }
        let status = shortcut::status(&app);
        log::info!(
            "smoke: shortcut {} registered={} conflict={:?}",
            status.accelerator,
            status.registered,
            status.conflict
        );
        pause(300).await;
        if ok {
            log::info!("smoke: ok");
            quit(&app);
        } else {
            log::error!("smoke: failed");
            if let Some(s) = app.try_state::<ShellState>() {
                s.quitting.store(true, Ordering::SeqCst);
            }
            app.exit(1);
        }
    });
}
