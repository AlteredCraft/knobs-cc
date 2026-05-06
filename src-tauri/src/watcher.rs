//! Phase 7 of `spec/settings-display.md`: a thin file watcher that emits a
//! `settings-changed` event to the frontend whenever a file we read for the
//! settings snapshot changes on disk.
//!
//! We use the `notify` crate directly rather than `tauri-plugin-fs-watch`
//! because v1's capability surface is locked to `core:default` +
//! `opener:default` (CLAUDE.md "Tauri 2 boundaries"). The plugin would
//! require granting fs-watch capabilities to the JS side; doing the watch
//! in Rust keeps the boundary intact — JS only ever subscribes to the
//! synthetic event we emit.
//!
//! The watcher itself is intentionally permissive: any FS event whose path
//! looks like a settings file (or a managed drop-in JSON) triggers a single
//! emit. Coalescing happens on the frontend — a snappy emit-per-event with
//! one debounced refresh is simpler than debouncing here, and config
//! directories don't churn enough to justify the extra machinery.

use std::path::{Path, PathBuf};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::managed_layer::resolve_managed_base;

const SETTINGS_CHANGED: &str = "settings-changed";

/// Holds the live `notify` watcher; dropping it stops the watch. Kept in
/// Tauri-managed state so its lifetime matches the app's.
pub struct SettingsWatcher {
    _watcher: RecommendedWatcher,
}

impl SettingsWatcher {
    pub fn start(app: AppHandle) -> notify::Result<Self> {
        let mut watcher =
            notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
                Ok(event) if event_touches_settings(&event) => {
                    let _ = app.emit(SETTINGS_CHANGED, ());
                }
                _ => {}
            })?;

        // Watch directories rather than individual files: editors typically
        // rename a tempfile over the target, which leaves a per-file watch
        // pointing at a now-stale inode. Watching the parent dir picks up
        // the new file regardless of how it was written.
        for dir in watched_dirs() {
            if !dir.exists() {
                continue;
            }
            if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
                // Don't tank the whole watcher on one bad dir (permissions,
                // unsupported FS) — just log and continue.
                eprintln!("watcher: failed to watch {}: {e}", dir.display());
            }
        }

        Ok(Self { _watcher: watcher })
    }
}

fn watched_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(base) = resolve_managed_base() {
        dirs.push(base.clone());
        dirs.push(base.join("managed-settings.d"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join(".claude"));
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        dirs.push(PathBuf::from(home).join(".claude"));
    }
    dirs
}

fn event_touches_settings(event: &notify::Event) -> bool {
    event.paths.iter().any(|p| is_settings_path(p))
}

fn is_settings_path(p: &Path) -> bool {
    let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if matches!(
        name,
        "settings.json" | "settings.local.json" | "managed-settings.json" | "managed-mcp.json"
    ) {
        return true;
    }
    // Anything under a `managed-settings.d/` directory ending in `.json`.
    let in_drop_in_dir = p
        .parent()
        .and_then(|d| d.file_name())
        .and_then(|n| n.to_str())
        == Some("managed-settings.d");
    in_drop_in_dir && p.extension().and_then(|s| s.to_str()) == Some("json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_files_are_recognised() {
        assert!(is_settings_path(Path::new("/x/.claude/settings.json")));
        assert!(is_settings_path(Path::new(
            "/x/.claude/settings.local.json"
        )));
        assert!(is_settings_path(Path::new(
            "/Library/Application Support/ClaudeCode/managed-settings.json"
        )));
        assert!(is_settings_path(Path::new(
            "/Library/Application Support/ClaudeCode/managed-mcp.json"
        )));
    }

    #[test]
    fn drop_in_jsons_are_recognised() {
        assert!(is_settings_path(Path::new(
            "/etc/claude-code/managed-settings.d/00-base.json"
        )));
        assert!(is_settings_path(Path::new(
            "/etc/claude-code/managed-settings.d/99-override.json"
        )));
    }

    #[test]
    fn unrelated_paths_are_ignored() {
        // Different filename in a watched dir.
        assert!(!is_settings_path(Path::new("/x/.claude/agents.json")));
        // Right name but in the wrong directory.
        assert!(!is_settings_path(Path::new(
            "/x/.claude/managed-settings.d/README.md"
        )));
        // Drop-in dir, non-json extension.
        assert!(!is_settings_path(Path::new(
            "/etc/claude-code/managed-settings.d/notes.txt"
        )));
        // Empty path.
        assert!(!is_settings_path(Path::new("")));
    }
}
