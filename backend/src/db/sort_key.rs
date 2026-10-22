//! Fractional index keys (base62 `0-9A-Za-z`, compared as plain ASCII strings).
//!
//! A key is a non-empty digit string that never ends in `0`, read as a fraction `0.d1d2d3…`.
//! `between(prev, next)` returns a key strictly between the two (open ends allowed), so any item
//! can be moved with a single-row write. The frontend compares keys with `<`, never
//! `localeCompare` (enforced by scripts/check-boundaries.sh).

use crate::error::AppError;

pub const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE: usize = 62;

fn digit(c: u8) -> Option<usize> {
    DIGITS.iter().position(|d| *d == c)
}

/// True for a well-formed key: non-empty, base62 only, no trailing `0`.
pub fn is_valid(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(|c| digit(c).is_some()) && !key.ends_with('0')
}

/// A key strictly between `prev` and `next` (`None` = open end).
///
/// - `between(None, None)` → the first key of an empty list;
/// - `between(Some(last), None)` → append; `between(None, Some(first))` → prepend.
///
/// Errors with `invalid` when a key is malformed or `prev >= next`.
pub fn between(prev: Option<&str>, next: Option<&str>) -> Result<String, AppError> {
    for k in [prev, next].into_iter().flatten() {
        if !is_valid(k) {
            return Err(AppError::invalid(format!("malformed sort key {k:?}")));
        }
    }
    if let (Some(a), Some(b)) = (prev, next)
        && a >= b
    {
        return Err(AppError::invalid(format!(
            "sort keys out of order: {a:?} >= {b:?}"
        )));
    }
    Ok(midpoint(
        prev.unwrap_or("").as_bytes(),
        next.map(str::as_bytes),
    ))
}

/// `n` evenly growing keys for an empty list (seed, bulk insert).
pub fn sequence(n: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(n);
    let mut last: Option<String> = None;
    for _ in 0..n {
        let k = midpoint(last.as_deref().unwrap_or("").as_bytes(), None);
        out.push(k.clone());
        last = Some(k);
    }
    out
}

/// Midpoint of `a` (may be empty = 0) and `b` (None = 1). Requires `a < b`, no trailing zeros.
fn midpoint(a: &[u8], b: Option<&[u8]>) -> String {
    if let Some(b) = b {
        // Shared prefix, reading missing digits of `a` as '0'.
        let mut n = 0;
        while n < b.len() && a.get(n).copied().unwrap_or(b'0') == b[n] {
            n += 1;
        }
        if n > 0 {
            let rest_a = if n < a.len() { &a[n..] } else { &[][..] };
            let mut out = String::from_utf8_lossy(&b[..n]).into_owned();
            out.push_str(&midpoint(rest_a, Some(&b[n..])));
            return out;
        }
    }
    let da = a.first().map(|c| digit(*c).unwrap_or(0)).unwrap_or(0);
    let db = b.map(|b| digit(b[0]).unwrap_or(BASE)).unwrap_or(BASE);
    if db - da > 1 {
        let mid = (da + db).div_ceil(2);
        return (DIGITS[mid] as char).to_string();
    }
    // Consecutive first digits.
    match b {
        Some(b) if b.len() > 1 => (b[0] as char).to_string(),
        _ => {
            let rest_a = if a.len() > 1 { &a[1..] } else { &[][..] };
            let mut out = (DIGITS[da] as char).to_string();
            out.push_str(&midpoint(rest_a, None));
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tiny deterministic PRNG so the test needs no extra crate.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self, bound: usize) -> usize {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((self.0 >> 33) as usize) % bound
        }
    }

    #[test]
    fn open_ends() {
        let first = between(None, None).unwrap();
        assert!(is_valid(&first));
        let after = between(Some(&first), None).unwrap();
        let before = between(None, Some(&first)).unwrap();
        assert!(before < first && first < after);
    }

    #[test]
    fn between_adjacent_and_tight_keys() {
        for (a, b) in [
            ("1", "2"),
            ("V", "W"),
            ("z", "zz"),
            ("01", "1"),
            ("0001", "0002"),
            ("y", "z"),
        ] {
            let m = between(Some(a), Some(b)).unwrap();
            assert!(a < m.as_str() && m.as_str() < b, "{a} < {m} < {b}");
            assert!(is_valid(&m), "{m}");
        }
        let m = between(None, Some("01")).unwrap();
        assert!(m.as_str() < "01" && is_valid(&m), "{m}");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(between(Some("b"), Some("a")).is_err());
        assert!(between(Some("a"), Some("a")).is_err());
        assert!(between(Some("a0"), None).is_err());
        assert!(between(Some(""), None).is_err());
        assert!(between(Some("a-b"), None).is_err());
    }

    #[test]
    fn sequence_is_strictly_increasing() {
        let keys = sequence(50);
        for w in keys.windows(2) {
            assert!(w[0] < w[1], "{} < {}", w[0], w[1]);
        }
    }

    #[test]
    fn thousand_random_inserts_stay_strictly_ordered() {
        let mut rng = Lcg(42);
        let mut keys: Vec<String> = vec![];
        for _ in 0..1000 {
            let pos = rng.next(keys.len() + 1);
            let prev = if pos == 0 {
                None
            } else {
                Some(keys[pos - 1].as_str())
            };
            let next = keys.get(pos).map(String::as_str);
            let k = between(prev, next).unwrap();
            assert!(is_valid(&k));
            keys.insert(pos, k);
        }
        for w in keys.windows(2) {
            assert!(w[0] < w[1], "{} < {}", w[0], w[1]);
        }
        // Repeated inserts at the front and back stay short-ish.
        assert!(keys.iter().all(|k| k.len() < 40));
    }

    #[test]
    fn hammering_one_gap_still_works() {
        let mut lo = between(None, None).unwrap();
        let hi = between(Some(&lo), None).unwrap();
        for _ in 0..200 {
            let m = between(Some(&lo), Some(&hi)).unwrap();
            assert!(lo < m && m < hi);
            lo = m;
        }
    }
}
