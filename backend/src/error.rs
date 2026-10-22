//! The single error type crossing the IPC boundary.
//!
//! `message` is English and meant for logs; the UI shows a generic Chinese hint instead.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// Input failed validation (empty title, due before start, bad date format…).
    Invalid,
    /// The referenced row does not exist (or is soft-deleted).
    NotFound,
    /// The operation cannot be applied any more (e.g. undo of an expired op).
    Conflict,
    /// SQLite / migration / serialization failure.
    Db,
    /// Window, shortcut, notification or other OS integration failure.
    Platform,
    /// The command exists but its implementation has not landed yet.
    NotImplemented,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{code:?}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        AppError {
            code,
            message: message.into(),
        }
    }

    pub fn not_implemented(name: &str) -> Self {
        Self::new(
            ErrorCode::NotImplemented,
            format!("not implemented: {name}"),
        )
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Invalid, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Conflict, message)
    }

    pub fn db(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Db, message)
    }

    pub fn platform(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Platform, message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::not_found("row not found"),
            other => AppError::db(other.to_string()),
        }
    }
}

impl From<rusqlite_migration::Error> for AppError {
    fn from(e: rusqlite_migration::Error) -> Self {
        AppError::db(format!("migration failed: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::db(format!("json: {e}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::platform(format!("io: {e}"))
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::platform(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_snake_case() {
        let e = AppError::not_implemented("create_todo");
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(
            json,
            r#"{"code":"not_implemented","message":"not implemented: create_todo"}"#
        );
    }

    #[test]
    fn no_rows_maps_to_not_found() {
        let e: AppError = rusqlite::Error::QueryReturnedNoRows.into();
        assert_eq!(e.code, ErrorCode::NotFound);
    }
}
