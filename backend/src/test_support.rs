//! Shared test helpers for unit tests and `backend/tests/**`.
//!
//! Always compiled (not `cfg(test)`) so integration tests can use it; hidden from docs.

use crate::clock::Clock;
use crate::db::Db;
use crate::model::Settings;
use crate::seed;

/// A fresh in-memory database with all migrations applied.
pub fn open_memory_db() -> Db {
    Db::open_in_memory().expect("in-memory database")
}

/// A frozen clock at local `YYYY-MM-DDTHH:MM`, e.g. `fixed_clock("2026-09-30T10:00")`.
pub fn fixed_clock(local: &str) -> Clock {
    Clock::fixed(local)
}

/// An in-memory database holding the demo seed (backend/src/seed.rs) with `Settings::fixture()`.
pub fn seeded_db() -> Db {
    let db = open_memory_db();
    db.with_tx(|tx| seed::demo(tx, &Settings::fixture()))
        .expect("seed demo data");
    db
}
