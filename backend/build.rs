fn main() {
    // The manifest is embedded below for every linked artifact, not only the bin.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
    embed_windows_manifest();
}

/// tauri-build links its Common Controls v6 manifest into the bin only (`rustc-link-arg-bins`),
/// so on Windows the unit / integration test executables, which also link Tauri, fail to start
/// with STATUS_ENTRYPOINT_NOT_FOUND. Embed the same manifest (`windows-app-manifest.xml`, copied
/// from tauri-build) into every artifact instead. MSVC linker only; the windows-gnu cross-check
/// (`check.sh win`) does not link.
fn embed_windows_manifest() {
    let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if os == "windows" && env == "msvc" {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
}
