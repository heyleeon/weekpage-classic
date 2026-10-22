//! Accelerator strings ("Control+Alt+Space"): parsing, canonical form, display text, and the
//! macOS virtual key codes used to compare against system shortcuts.
//!
//! Pure functions, compiled on every platform (no `cfg`); the platform is passed in explicitly
//! so tests cover macOS and Windows behaviour on any host.

use crate::model::Platform;

/// A parsed accelerator: modifier flags plus one main key in canonical spelling
/// (`A`–`Z`, `0`–`9`, `Space`, `F1`–`F12`, or any other key name upper-camel-cased).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Accel {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// ⌘ on macOS, the Windows key on Windows.
    pub meta: bool,
    pub key: String,
}

impl Accel {
    /// True when at least one of Ctrl / Alt / ⌘ (Win) is held (Shift alone does not count).
    pub fn has_strong_modifier(&self) -> bool {
        self.ctrl || self.alt || self.meta
    }

    /// Canonical accelerator string, modifiers in macOS order: `Control+Alt+Shift+Super+Key`.
    pub fn canonical(&self) -> String {
        let mut parts: Vec<&str> = Vec::new();
        if self.ctrl {
            parts.push("Control");
        }
        if self.alt {
            parts.push("Alt");
        }
        if self.shift {
            parts.push("Shift");
        }
        if self.meta {
            parts.push("Super");
        }
        parts.push(&self.key);
        parts.join("+")
    }

    /// Text shown to the user: macOS `⌃⌥⇧⌘Space`, Windows `Ctrl+Alt+Shift+Win+Space`.
    pub fn display(&self, platform: Platform) -> String {
        if platform == Platform::Macos {
            let mut s = String::new();
            if self.ctrl {
                s.push('⌃');
            }
            if self.alt {
                s.push('⌥');
            }
            if self.shift {
                s.push('⇧');
            }
            if self.meta {
                s.push('⌘');
            }
            s.push_str(&self.key);
            s
        } else {
            let mut parts: Vec<&str> = Vec::new();
            if self.ctrl {
                parts.push("Ctrl");
            }
            if self.alt {
                parts.push("Alt");
            }
            if self.shift {
                parts.push("Shift");
            }
            if self.meta {
                parts.push("Win");
            }
            parts.push(&self.key);
            parts.join("+")
        }
    }
}

/// Canonical spelling of a main key, or None when it is a modifier / empty.
fn canonical_key(raw: &str) -> Option<String> {
    let up = raw.trim().to_ascii_uppercase();
    if up.is_empty() {
        return None;
    }
    if up.len() == 1 {
        let c = up.chars().next()?;
        if c.is_ascii_alphanumeric() {
            return Some(up);
        }
    }
    if let Some(letter) = up.strip_prefix("KEY")
        && letter.len() == 1
        && letter.chars().all(|c| c.is_ascii_alphabetic())
    {
        return Some(letter.to_string());
    }
    if let Some(digit) = up.strip_prefix("DIGIT")
        && digit.len() == 1
        && digit.chars().all(|c| c.is_ascii_digit())
    {
        return Some(digit.to_string());
    }
    if up == "SPACE" {
        return Some("Space".to_string());
    }
    if let Some(n) = up.strip_prefix('F')
        && let Ok(n) = n.parse::<u8>()
        && (1..=24).contains(&n)
    {
        return Some(format!("F{n}"));
    }
    // Other named keys: keep them recognisable but normalised ("tab" → "Tab").
    let mut chars = up.chars();
    let first = chars.next()?;
    Some(format!("{first}{}", chars.as_str().to_ascii_lowercase()))
}

/// Parses an accelerator. `CommandOrControl` resolves per `platform`. Returns None for an empty
/// string, a string without a main key, or more than one main key.
pub fn parse(accelerator: &str, platform: Platform) -> Option<Accel> {
    let mut a = Accel::default();
    let mut key: Option<String> = None;
    for token in accelerator.split('+') {
        let t = token.trim();
        if t.is_empty() {
            return None;
        }
        match t.to_ascii_uppercase().as_str() {
            "CONTROL" | "CTRL" => a.ctrl = true,
            "ALT" | "OPTION" => a.alt = true,
            "SHIFT" => a.shift = true,
            "SUPER" | "CMD" | "COMMAND" | "META" | "WIN" => a.meta = true,
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => {
                if platform == Platform::Macos {
                    a.meta = true;
                } else {
                    a.ctrl = true;
                }
            }
            _ => {
                if key.is_some() {
                    return None;
                }
                key = Some(canonical_key(t)?);
            }
        }
    }
    a.key = key?;
    Some(a)
}

/// True for the main keys the recorder accepts: `A`–`Z`, `0`–`9`, `Space`, `F1`–`F12`.
pub fn is_allowed_main_key(key: &str) -> bool {
    if key == "Space" {
        return true;
    }
    if key.len() == 1 {
        return key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    }
    key.strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=12).contains(&n))
}

/// macOS modifier flags as stored in `com.apple.symbolichotkeys` (NSEvent modifier masks).
pub const MAC_SHIFT: u64 = 0x2_0000;
pub const MAC_CONTROL: u64 = 0x4_0000;
pub const MAC_OPTION: u64 = 0x8_0000;
pub const MAC_COMMAND: u64 = 0x10_0000;
pub const MAC_MODIFIER_MASK: u64 = MAC_SHIFT | MAC_CONTROL | MAC_OPTION | MAC_COMMAND;

/// macOS virtual key code (`kVK_*`) of a canonical main key, for the keys the app accepts.
pub fn mac_key_code(key: &str) -> Option<u16> {
    let code = match key {
        "A" => 0,
        "S" => 1,
        "D" => 2,
        "F" => 3,
        "H" => 4,
        "G" => 5,
        "Z" => 6,
        "X" => 7,
        "C" => 8,
        "V" => 9,
        "B" => 11,
        "Q" => 12,
        "W" => 13,
        "E" => 14,
        "R" => 15,
        "Y" => 16,
        "T" => 17,
        "1" => 18,
        "2" => 19,
        "3" => 20,
        "4" => 21,
        "6" => 22,
        "5" => 23,
        "9" => 25,
        "7" => 26,
        "8" => 28,
        "0" => 29,
        "O" => 31,
        "U" => 32,
        "I" => 34,
        "P" => 35,
        "L" => 37,
        "J" => 38,
        "K" => 40,
        "N" => 45,
        "M" => 46,
        "Tab" => 48,
        "Space" => 49,
        "F5" => 96,
        "F6" => 97,
        "F7" => 98,
        "F3" => 99,
        "F8" => 100,
        "F9" => 101,
        "F11" => 103,
        "F10" => 109,
        "F12" => 111,
        "F4" => 118,
        "F2" => 120,
        "F1" => 122,
        _ => return None,
    };
    Some(code)
}

/// `(virtual key code, modifier flags)` in the encoding of `com.apple.symbolichotkeys`.
pub fn mac_combo(a: &Accel) -> Option<(u16, u64)> {
    let code = mac_key_code(&a.key)?;
    let mut mods = 0;
    if a.shift {
        mods |= MAC_SHIFT;
    }
    if a.ctrl {
        mods |= MAC_CONTROL;
    }
    if a.alt {
        mods |= MAC_OPTION;
    }
    if a.meta {
        mods |= MAC_COMMAND;
    }
    Some((code, mods))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_aliases_into_canonical_order() {
        let a = parse("alt+ctrl+space", Platform::Macos).unwrap();
        assert_eq!(a.canonical(), "Control+Alt+Space");
        let b = parse("Shift+Cmd+KeyK", Platform::Macos).unwrap();
        assert_eq!(b.canonical(), "Shift+Super+K");
        assert_eq!(
            parse("CommandOrControl+Digit1", Platform::Windows)
                .unwrap()
                .canonical(),
            "Control+1"
        );
        assert_eq!(
            parse("CmdOrCtrl+f5", Platform::Macos).unwrap().canonical(),
            "Super+F5"
        );
    }

    #[test]
    fn rejects_malformed() {
        assert_eq!(parse("", Platform::Macos), None);
        assert_eq!(parse("Control+Alt", Platform::Macos), None);
        assert_eq!(parse("Control+A+B", Platform::Macos), None);
        assert_eq!(parse("Control++A", Platform::Macos), None);
    }

    #[test]
    fn display_per_platform() {
        let a = parse("Control+Alt+Shift+Space", Platform::Macos).unwrap();
        assert_eq!(a.display(Platform::Macos), "⌃⌥⇧Space");
        assert_eq!(a.display(Platform::Windows), "Ctrl+Alt+Shift+Space");
        let w = parse("Super+K", Platform::Windows).unwrap();
        assert_eq!(w.display(Platform::Windows), "Win+K");
        assert_eq!(w.display(Platform::Macos), "⌘K");
    }

    #[test]
    fn allowed_main_keys() {
        for k in ["A", "Z", "0", "9", "Space", "F1", "F12"] {
            assert!(is_allowed_main_key(k), "{k}");
        }
        for k in ["F13", "Tab", "Enter", "Escape", "Comma"] {
            assert!(!is_allowed_main_key(k), "{k}");
        }
    }

    #[test]
    fn mac_combo_encoding_matches_symbolichotkeys() {
        // Item 61 "select next input source": parameters (32, 49, 786432).
        let a = parse("Control+Alt+Space", Platform::Macos).unwrap();
        assert_eq!(mac_combo(&a), Some((49, 786_432)));
        // Item 64 Spotlight: (32, 49, 1048576).
        let s = parse("Super+Space", Platform::Macos).unwrap();
        assert_eq!(mac_combo(&s), Some((49, 1_048_576)));
    }
}
