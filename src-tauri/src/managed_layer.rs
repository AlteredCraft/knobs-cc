//! Phase 2 of `spec/settings-display.md`: read the file-based managed tier.
//!
//! The managed tier collapses to a single `managed` layer at the public API
//! boundary (highest precedence). Internally it merges
//! `managed-settings.json` with `managed-settings.d/*.json` alphabetically,
//! per `spec/inventory.md:42`. `managed-mcp.json` is read as a sibling but
//! is not part of the precedence merge — MCP servers are a different config
//! category; the UI just needs to know the file exists.
//!
//! OS-policy managed sources (macOS plist, Windows registry) are Phase 6.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::settings::{LayerRead, LayerSource, LayerStatus};

/// Platform's file-based managed-settings root. None on unsupported targets
/// (so the snapshot can still report a `missing` rail row rather than panic).
fn resolve_managed_base() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        Some(PathBuf::from("/Library/Application Support/ClaudeCode"))
    }
    #[cfg(target_os = "linux")]
    {
        Some(PathBuf::from("/etc/claude-code"))
    }
    #[cfg(target_os = "windows")]
    {
        Some(PathBuf::from(r"C:\Program Files\ClaudeCode"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

pub fn read_managed_layer() -> LayerRead {
    match resolve_managed_base() {
        Some(base) => read_managed_layer_at(&base),
        None => layer_missing(LayerSource::Managed, None),
    }
}

pub fn read_managed_mcp() -> LayerRead {
    match resolve_managed_base() {
        Some(base) => read_managed_mcp_at(&base),
        None => layer_missing(LayerSource::Managed, None),
    }
}

fn layer_missing(source: LayerSource, path: Option<PathBuf>) -> LayerRead {
    LayerRead {
        source,
        path: path.map(|p| p.to_string_lossy().into_owned()),
        status: LayerStatus::Missing,
        raw: None,
        error: None,
    }
}

fn layer_error(source: LayerSource, path: PathBuf, msg: String) -> LayerRead {
    LayerRead {
        source,
        path: Some(path.to_string_lossy().into_owned()),
        status: LayerStatus::Error,
        raw: None,
        error: Some(msg),
    }
}

fn layer_ok(source: LayerSource, path: PathBuf, raw: Value) -> LayerRead {
    LayerRead {
        source,
        path: Some(path.to_string_lossy().into_owned()),
        status: LayerStatus::Ok,
        raw: Some(raw),
        error: None,
    }
}

fn read_managed_layer_at(base: &Path) -> LayerRead {
    let base_file = base.join("managed-settings.json");
    let drop_in_dir = base.join("managed-settings.d");

    let base_present = base_file.exists();
    let drop_in_files = collect_drop_in_paths(&drop_in_dir);

    if !base_present && drop_in_files.is_empty() {
        return layer_missing(LayerSource::Managed, Some(base.to_path_buf()));
    }

    let mut acc: Value = if base_present {
        match read_json(&base_file) {
            Ok(v) => v,
            Err(e) => return layer_error(LayerSource::Managed, base_file, e),
        }
    } else {
        Value::Object(Map::new())
    };

    // Drop-ins are merged alphabetically last-wins. Any malformed file fails
    // the whole layer — admins should know their policy isn't loading rather
    // than seeing a silently-skipped file.
    for p in &drop_in_files {
        match read_json(p) {
            Ok(v) => merge_in(&mut acc, v),
            Err(e) => return layer_error(LayerSource::Managed, p.clone(), e),
        }
    }

    layer_ok(LayerSource::Managed, base.to_path_buf(), acc)
}

fn read_managed_mcp_at(base: &Path) -> LayerRead {
    let path = base.join("managed-mcp.json");
    if !path.exists() {
        return layer_missing(LayerSource::Managed, Some(path));
    }
    match read_json(&path) {
        Ok(v) => layer_ok(LayerSource::Managed, path, v),
        Err(e) => layer_error(LayerSource::Managed, path, e),
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("io error reading {}: {e}", path.display()))?;
    serde_json::from_str::<Value>(&text)
        .map_err(|e| format!("parse error in {}: {e}", path.display()))
}

fn collect_drop_in_paths(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    paths.sort();
    paths
}

/// Recursive last-wins merge for plain JSON. Used inside the managed tier to
/// collapse base + drop-ins into a single Value before the main provenance
/// merge sees it.
fn merge_in(acc: &mut Value, incoming: Value) {
    match incoming {
        Value::Object(b) => {
            if !acc.is_object() {
                *acc = Value::Object(Map::new());
            }
            let a = acc.as_object_mut().expect("ensured object above");
            for (k, v) in b {
                match a.get_mut(&k) {
                    Some(existing) => merge_in(existing, v),
                    None => {
                        a.insert(k, v);
                    }
                }
            }
        }
        other => {
            *acc = other;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "knobs-cc-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn missing_when_neither_base_nor_drop_ins_present() {
        let d = temp_dir("managed-empty");
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.status, LayerStatus::Missing);
        assert!(layer.raw.is_none());
        assert!(layer.error.is_none());
        assert_eq!(layer.path.as_deref(), Some(d.to_string_lossy().as_ref()));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn ok_when_only_base_present() {
        let d = temp_dir("managed-base-only");
        write(&d.join("managed-settings.json"), r#"{"model":"sonnet"}"#);
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap(), json!({"model": "sonnet"}));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn ok_when_only_drop_ins_present() {
        let d = temp_dir("managed-dropins-only");
        write(&d.join("managed-settings.d/00-base.json"), r#"{"model":"opus"}"#);
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap(), json!({"model": "opus"}));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn drop_ins_merge_alphabetically_last_wins() {
        let d = temp_dir("managed-alpha");
        write(
            &d.join("managed-settings.json"),
            r#"{"model":"haiku","theme":"dark"}"#,
        );
        write(&d.join("managed-settings.d/10-org.json"), r#"{"model":"sonnet"}"#);
        write(&d.join("managed-settings.d/20-team.json"), r#"{"model":"opus"}"#);
        let layer = read_managed_layer_at(&d);
        let raw = layer.raw.unwrap();
        // alphabetic order: base < 10-org < 20-team — last wins.
        assert_eq!(raw["model"], json!("opus"));
        // theme only set in base; survives because no drop-in overwrites it.
        assert_eq!(raw["theme"], json!("dark"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn drop_in_dir_skips_non_json_files() {
        let d = temp_dir("managed-mixed");
        write(&d.join("managed-settings.d/policy.json"), r#"{"a":1}"#);
        write(&d.join("managed-settings.d/README.md"), "ignore me");
        write(&d.join("managed-settings.d/notes.txt"), "ignore me too");
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.raw.unwrap(), json!({"a": 1}));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn drop_in_dir_skips_extensionless_and_dotfiles() {
        let d = temp_dir("managed-edges");
        write(&d.join("managed-settings.d/policy.json"), r#"{"a":1}"#);
        // No extension — must be skipped, not parsed.
        write(&d.join("managed-settings.d/README"), "ignore me");
        // A dotfile with no extension. We rely on the `.json` extension filter
        // alone — `.DS_Store` etc. fall out for free.
        write(&d.join("managed-settings.d/.DS_Store"), "");
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.raw.unwrap(), json!({"a": 1}));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn malformed_base_file_errors_layer() {
        let d = temp_dir("managed-bad-base");
        write(&d.join("managed-settings.json"), "{ not json }");
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.status, LayerStatus::Error);
        let err = layer.error.unwrap();
        assert!(err.contains("parse"), "expected parse error, got: {err}");
        assert!(err.contains("managed-settings.json"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn malformed_drop_in_errors_layer_with_offending_path() {
        let d = temp_dir("managed-bad-dropin");
        write(&d.join("managed-settings.json"), r#"{"a":1}"#);
        write(&d.join("managed-settings.d/01-broken.json"), "{ broken }");
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.status, LayerStatus::Error);
        let err = layer.error.unwrap();
        assert!(
            err.contains("01-broken"),
            "expected error to name offending file, got: {err}"
        );
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn nested_objects_merge_per_key_within_managed_tier() {
        let d = temp_dir("managed-nested");
        write(
            &d.join("managed-settings.json"),
            r#"{"permissions":{"defaultMode":"ask","allow":["a"]}}"#,
        );
        write(
            &d.join("managed-settings.d/01-overlay.json"),
            r#"{"permissions":{"defaultMode":"auto"}}"#,
        );
        let raw = read_managed_layer_at(&d).raw.unwrap();
        assert_eq!(raw["permissions"]["defaultMode"], json!("auto"));
        // `allow` not touched by overlay; survives from base.
        assert_eq!(raw["permissions"]["allow"], json!(["a"]));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn arrays_replace_last_wins_within_managed_tier() {
        // Within the managed tier we don't do array-concat-dedup; that's a
        // cross-layer rule applied as a post-pass in settings.rs. Inside the
        // managed merge, last-wins is the right behavior — admins layering
        // drop-ins expect overrides, not silent concatenation.
        let d = temp_dir("managed-arrays");
        write(
            &d.join("managed-settings.json"),
            r#"{"permissions":{"allow":["a","b"]}}"#,
        );
        write(
            &d.join("managed-settings.d/01-overlay.json"),
            r#"{"permissions":{"allow":["c"]}}"#,
        );
        let raw = read_managed_layer_at(&d).raw.unwrap();
        assert_eq!(raw["permissions"]["allow"], json!(["c"]));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn empty_drop_in_dir_with_base_present_is_ok() {
        let d = temp_dir("managed-empty-dir");
        write(&d.join("managed-settings.json"), r#"{"a":1}"#);
        std::fs::create_dir_all(d.join("managed-settings.d")).unwrap();
        let layer = read_managed_layer_at(&d);
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap(), json!({"a": 1}));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn managed_mcp_missing_when_not_present() {
        let d = temp_dir("managed-mcp-missing");
        let layer = read_managed_mcp_at(&d);
        assert_eq!(layer.status, LayerStatus::Missing);
        assert!(layer.raw.is_none());
        // Path points at the expected location even when missing, so the UI
        // can show "would have been read from …".
        assert!(layer.path.unwrap().ends_with("managed-mcp.json"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn managed_mcp_ok_when_present() {
        let d = temp_dir("managed-mcp-ok");
        write(&d.join("managed-mcp.json"), r#"{"mcpServers":{"foo":{}}}"#);
        let layer = read_managed_mcp_at(&d);
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap(), json!({"mcpServers":{"foo":{}}}));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn managed_mcp_error_when_malformed() {
        let d = temp_dir("managed-mcp-bad");
        write(&d.join("managed-mcp.json"), "{ broken }");
        let layer = read_managed_mcp_at(&d);
        assert_eq!(layer.status, LayerStatus::Error);
        assert!(layer.error.unwrap().contains("parse"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn merge_in_replaces_scalar_with_object_and_vice_versa() {
        // Higher-precedence drop-in turns a scalar leaf into an object: the
        // scalar is gone and the object takes over wholesale. The reverse
        // (object → scalar) similarly replaces.
        let mut a = json!({"x": "scalar"});
        merge_in(&mut a, json!({"x": {"nested": 1}}));
        assert_eq!(a, json!({"x": {"nested": 1}}));

        let mut b = json!({"x": {"nested": 1}});
        merge_in(&mut b, json!({"x": "scalar"}));
        assert_eq!(b, json!({"x": "scalar"}));
    }
}
