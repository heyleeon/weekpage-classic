//! Contract tests: the generated frontend files must match what the Rust side produces.
//!
//! - `export_bindings`: `frontend/src/types/bindings.ts` == tauri-specta output;
//! - `demo_fixture`: `frontend/src/lib/__fixtures__/demo-snapshot.json` == seeded snapshot.
//!
//! Regenerate both with `bash scripts/gen-contracts.sh` (runs the two `#[ignore]` writers).

use std::path::PathBuf;

use crate::db::snapshot;
use crate::model::Settings;
use crate::paths::repo_root;
use crate::test_support::seeded_db;

const REGEN_HINT: &str = "out of date: run `bash scripts/gen-contracts.sh` and commit the result";

fn bindings_path() -> PathBuf {
    repo_root().join("frontend/src/types/bindings.ts")
}

fn fixture_path() -> PathBuf {
    repo_root().join("frontend/src/lib/__fixtures__/demo-snapshot.json")
}

fn typescript() -> specta_typescript::Typescript {
    specta_typescript::Typescript::default().header(
        "// Generated from backend/src/{commands,model,error}.rs by scripts/gen-contracts.sh.",
    )
}

fn render_bindings() -> String {
    let tmp = std::env::temp_dir().join(format!("weekpage-bindings-{}.ts", crate::db::new_id()));
    crate::commands::specta_builder()
        .export(typescript(), &tmp)
        .expect("export bindings");
    let out = std::fs::read_to_string(&tmp).expect("read exported bindings");
    std::fs::remove_file(&tmp).ok();
    out
}

fn render_fixture() -> String {
    let db = seeded_db();
    let mut snap = db
        .with_conn(|c| snapshot::load(c, &Settings::fixture()))
        .expect("load seeded snapshot");
    snap.settings = Settings::fixture();
    let mut json = serde_json::to_string_pretty(&snap).expect("serialize snapshot");
    json.push('\n');
    json
}

fn assert_same(path: PathBuf, expected: &str) {
    let actual = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        actual == expected,
        "{} is {REGEN_HINT}",
        path.strip_prefix(repo_root()).unwrap_or(&path).display()
    );
}

#[test]
fn export_bindings() {
    assert_same(bindings_path(), &render_bindings());
}

#[test]
fn demo_fixture() {
    assert_same(fixture_path(), &render_fixture());
}

#[test]
fn rendering_is_reproducible() {
    assert_eq!(render_bindings(), render_bindings());
    assert_eq!(render_fixture(), render_fixture());
}

#[test]
#[ignore = "writer: run through scripts/gen-contracts.sh"]
fn write_bindings() {
    let path = bindings_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, render_bindings()).unwrap();
}

#[test]
#[ignore = "writer: run through scripts/gen-contracts.sh"]
fn write_demo_fixture() {
    let path = fixture_path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, render_fixture()).unwrap();
}
