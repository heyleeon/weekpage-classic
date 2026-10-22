//! Conflicts between our global shortcut and the system's own shortcuts.
//!
//! macOS keeps its keyboard shortcuts in `com.apple.symbolichotkeys` → `AppleSymbolicHotKeys`:
//! `{ "61": { enabled: 1, value: { parameters: [32, 49, 786432], type: "standard" } }, … }` where
//! the parameters are (character, virtual key code, modifier flags). A Carbon hotkey registered
//! on the same combo does not fail, but the system handles the key first (user decision D4:
//! ⌃⌥Space is item 61 "select next source in Input menu"). This module is the pure part:
//! matching an accelerator against already-read entries. Reading the preferences lives in
//! `macos_prefs.rs`.

use super::accelerator::{self, MAC_MODIFIER_MASK};
use crate::model::Platform;

/// One entry of `AppleSymbolicHotKeys`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemHotkey {
    pub id: u32,
    pub enabled: bool,
    /// Virtual key code; 65535 means "no key".
    pub key_code: u16,
    /// NSEvent modifier flags (may carry extra bits such as the function-key flag).
    pub modifiers: u64,
}

/// Stable identifier of a conflicting system shortcut, reported in `ShortcutStatus.conflict`.
/// The frontend maps it to Chinese guidance (where to turn it off).
pub fn conflict_name(id: u32) -> String {
    match id {
        60 => "input-source-previous".to_string(),
        61 => "input-source-next".to_string(),
        64 => "spotlight".to_string(),
        65 => "spotlight-window".to_string(),
        other => format!("system-{other}"),
    }
}

/// The enabled system shortcut that uses the same combo as `accelerator`, if any.
/// Lower ids win when several match (60/61/64 are the ones users actually hit).
pub fn find_conflict(accelerator: &str, entries: &[SystemHotkey]) -> Option<String> {
    let parsed = accelerator::parse(accelerator, Platform::Macos)?;
    let (code, mods) = accelerator::mac_combo(&parsed)?;
    entries
        .iter()
        .filter(|e| e.enabled && e.key_code == code && e.modifiers & MAC_MODIFIER_MASK == mods)
        .min_by_key(|e| e.id)
        .map(|e| conflict_name(e.id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hk(id: u32, enabled: bool, key_code: u16, modifiers: u64) -> SystemHotkey {
        SystemHotkey {
            id,
            enabled,
            key_code,
            modifiers,
        }
    }

    fn defaults() -> Vec<SystemHotkey> {
        vec![
            hk(60, true, 49, 262_144),
            hk(61, true, 49, 786_432),
            hk(64, true, 49, 1_048_576),
            hk(65, false, 49, 1_572_864),
            // F-key style entry with the function flag (0x800000) set.
            hk(36, true, 103, 8_388_608),
        ]
    }

    #[test]
    fn control_option_space_conflicts_with_next_input_source() {
        assert_eq!(
            find_conflict("Control+Alt+Space", &defaults()).as_deref(),
            Some("input-source-next")
        );
    }

    #[test]
    fn control_space_and_command_space() {
        assert_eq!(
            find_conflict("Control+Space", &defaults()).as_deref(),
            Some("input-source-previous")
        );
        assert_eq!(
            find_conflict("Super+Space", &defaults()).as_deref(),
            Some("spotlight")
        );
    }

    #[test]
    fn disabled_entries_and_other_combos_do_not_conflict() {
        assert_eq!(find_conflict("Alt+Super+Space", &defaults()), None);
        assert_eq!(find_conflict("Control+Alt+Shift+Space", &defaults()), None);
        let mut off = defaults();
        off[1].enabled = false;
        assert_eq!(find_conflict("Control+Alt+Space", &off), None);
    }

    #[test]
    fn function_key_flag_is_ignored() {
        assert_eq!(
            find_conflict("F11", &defaults()).as_deref(),
            Some("system-36")
        );
    }

    #[test]
    fn unparsable_accelerator_has_no_conflict() {
        assert_eq!(find_conflict("", &defaults()), None);
        assert_eq!(find_conflict("Control+Enter", &defaults()), None);
    }
}
