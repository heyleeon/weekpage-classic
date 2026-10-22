//! Windows specifics: Mica on Windows 11, nothing on Windows 10 (see ui-spec §0.3).

use tauri::window::{Effect, EffectsBuilder};
use tauri::{Runtime, WebviewWindow};

use crate::error::AppError;

/// First Windows 11 build (Mica needs it).
const WIN11_BUILD: u32 = 22000;

/// Windows build number (0 when it cannot be read).
pub fn build_number() -> u32 {
    windows_version::OsVersion::current().build
}

/// True on Windows 11 (build >= 22000).
pub fn mica_supported() -> bool {
    build_number() >= WIN11_BUILD
}

/// Mica on Windows 11; nothing on Windows 10 (the frontend paints the solid fallback ring).
pub fn apply_effects<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AppError> {
    if !mica_supported() {
        log::info!(
            "window effects: Windows build {} has no Mica, using the solid fallback",
            build_number()
        );
        return Ok(());
    }
    window.set_effects(EffectsBuilder::new().effect(Effect::Mica).build())?;
    log::info!("window effects: Mica applied");
    Ok(())
}
