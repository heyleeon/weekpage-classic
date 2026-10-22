//! WeekPage — Tauri backend: the only write path (SQLite) plus platform integration.
//!
//! Layout: `commands` (thin IPC entry) → `db` (repositories, journal, history,
//! sort keys) · `shell` (window / shortcut / tray / settings side effects) · `platform` (the only
//! place with `cfg(target_os …)`) · `reminders` (30 s heartbeat) · `i18n` (tray / notification
//! text) · `clock` / `paths` / `logging`.

pub mod clock;
pub mod db;
pub mod error;
pub mod model;
#[doc(hidden)]
pub mod test_support;

pub(crate) mod commands;
pub(crate) mod i18n;
pub(crate) mod logging;
pub(crate) mod paths;
pub(crate) mod platform;
pub(crate) mod reminders;
pub(crate) mod seed;
pub(crate) mod shell;

#[cfg(test)]
mod contracts;

use tauri::Manager;

use crate::clock::Clock;
use crate::db::Db;
use crate::error::AppError;

/// Managed state shared by all commands. The shell keeps its own runtime state in `ShellState`.
pub struct AppState {
    pub db: Db,
    pub clock: Clock,
}

const SEED_ENV: &str = "WEEKPAGE_SEED";

fn setup(app: &mut tauri::App) -> Result<(), AppError> {
    let paths = paths::resolve(app.handle())?;
    logging::init(app.handle(), &paths)?;
    log::info!(
        "starting weekpage {} (identifier {}, data dir {})",
        app.package_info().version,
        app.config().identifier,
        paths.data_dir.display()
    );

    let clock = Clock::from_env();
    let db = Db::open(&paths.db_file())?;
    let defaults = commands::settings_defaults(app.handle());

    let seed_demo =
        cfg!(debug_assertions) && std::env::var(SEED_ENV).is_ok_and(|v| v.trim() == "demo");
    if seed_demo {
        if db.is_empty()? {
            db.with_tx(|tx| seed::demo(tx, &defaults))?;
            log::info!("seeded demo data ({SEED_ENV}=demo)");
        } else {
            log::info!("{SEED_ENV}=demo ignored: database is not empty");
        }
    }

    let now = clock.now_ms();
    let settings = db.with_tx(|tx| {
        let settings = db::settings::ensure(tx, &defaults, now)?;
        db::settings::device_id(tx, now)?;
        Ok(settings)
    })?;
    clock::set_timezone(&settings.timezone);
    match db.backup_if_needed(&paths.backups_dir(), &clock) {
        Ok(Some(p)) => log::info!("backup written: {}", p.display()),
        Ok(None) => {}
        Err(e) => log::warn!("backup failed: {e}"),
    }
    match db.prune_journal() {
        Ok(n) if n > 0 => log::info!("undo journal: pruned {n} expired entries"),
        Ok(_) => {}
        Err(e) => log::warn!("undo journal prune failed: {e}"),
    }

    app.manage(AppState { db, clock });
    platform::setup(app)?;
    shell::setup(app)?;
    reminders::start(app.handle().clone());
    Ok(())
}

/// Entry point used by `main.rs`.
pub fn run() {
    let specta = commands::specta_builder();
    let invoke_handler = specta.invoke_handler();

    tauri::Builder::default()
        // Must be the first plugin (architecture §4 "单实例").
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            shell::on_second_instance(app, argv)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    shell::shortcut::on_shortcut(app, shortcut, event)
                })
                .build(),
        )
        .plugin(
            // macOS launcher defaults to LaunchAgent (`macos_launcher` only exists on macOS,
            // calling it here would break the Windows build).
            tauri_plugin_autostart::Builder::new()
                .args(["--autostart"])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(invoke_handler)
        .setup(move |app| {
            specta.mount_events(app);
            setup(app).map_err(|e| {
                log::error!("setup failed: {e}");
                Box::new(e) as Box<dyn std::error::Error>
            })
        })
        .on_window_event(shell::window::on_window_event)
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| panic!("failed to build the tauri app: {e}"))
        .run(|app, event| shell::on_run_event(app, &event));
}
