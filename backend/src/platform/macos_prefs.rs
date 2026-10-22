//! Reads the system keyboard shortcuts (`com.apple.symbolichotkeys` → `AppleSymbolicHotKeys`)
//! through CFPreferences. Read-only: the app never changes system settings.

use std::ffi::c_void;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};

use super::system_shortcuts::SystemHotkey;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFPreferencesCopyAppValue(key: *const c_void, application_id: *const c_void) -> *mut c_void;
    fn CFPreferencesAppSynchronize(application_id: *const c_void) -> u8;
}

const DOMAIN: &str = "com.apple.symbolichotkeys";
const KEY: &str = "AppleSymbolicHotKeys";

fn number(obj: &AnyObject) -> Option<i64> {
    obj.downcast_ref::<NSNumber>().map(|n| n.as_i64())
}

fn field(dict: &NSDictionary, name: &str) -> Option<Retained<AnyObject>> {
    let key = NSString::from_str(name);
    let key: &AnyObject = &key;
    dict.objectForKey(key)
}

fn entry(id: u32, value: &AnyObject) -> Option<SystemHotkey> {
    let item = value.downcast_ref::<NSDictionary>()?;
    let enabled = field(item, "enabled")
        .and_then(|e| number(&e))
        .is_some_and(|n| n != 0);
    let value = field(item, "value")?;
    let value = value.downcast_ref::<NSDictionary>()?;
    let params = field(value, "parameters")?;
    let params = params.downcast_ref::<NSArray>()?;
    if params.count() < 3 {
        return None;
    }
    let key_code = number(&params.objectAtIndex(1))?;
    let modifiers = number(&params.objectAtIndex(2))?;
    Some(SystemHotkey {
        id,
        enabled,
        key_code: u16::try_from(key_code).ok()?,
        modifiers: u64::try_from(modifiers).ok()?,
    })
}

/// Every parseable entry of `AppleSymbolicHotKeys` (empty when the domain is missing).
/// Entries absent from the user's preferences use macOS defaults that this cannot see; the
/// ones that matter here (60 / 61 / 64) are written as soon as the user has touched them, and
/// are present on a default install of recent macOS versions.
pub fn read_symbolic_hotkeys() -> Vec<SystemHotkey> {
    let domain = NSString::from_str(DOMAIN);
    let key = NSString::from_str(KEY);
    let domain_ptr = Retained::as_ptr(&domain).cast::<c_void>();
    let key_ptr = Retained::as_ptr(&key).cast::<c_void>();
    // SAFETY: NSString is toll-free bridged with CFString; CFPreferencesCopyAppValue follows the
    // Copy rule, so the returned object is +1 and owned by the Retained below.
    let root: Option<Retained<AnyObject>> = unsafe {
        CFPreferencesAppSynchronize(domain_ptr);
        let raw = CFPreferencesCopyAppValue(key_ptr, domain_ptr);
        Retained::from_raw(raw.cast::<AnyObject>())
    };
    let Some(root) = root else {
        log::warn!("shortcut conflict check: {DOMAIN} has no {KEY}");
        return Vec::new();
    };
    let Some(dict) = root.downcast_ref::<NSDictionary>() else {
        log::warn!("shortcut conflict check: {KEY} is not a dictionary");
        return Vec::new();
    };
    let keys = dict.allKeys();
    let mut out = Vec::with_capacity(keys.count());
    for k in keys.iter() {
        let Some(id) = k
            .downcast_ref::<NSString>()
            .and_then(|s| s.to_string().parse::<u32>().ok())
        else {
            continue;
        };
        if let Some(v) = dict.objectForKey(&k)
            && let Some(e) = entry(id, &v)
        {
            out.push(e);
        }
    }
    out
}
