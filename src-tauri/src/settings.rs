//! Phase 1 of the settings-display spec (`spec/settings-display.md`):
//! read the three file-based layers a user always has on their own machine
//! and produce a snapshot with per-leaf provenance via last-wins merge.
//!
//! Managed sources, env vars, array-merge semantics, project-root discovery,
//! and catalog cross-reference are deferred to later phases.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

// Phase 1 only constructs ProjectLocal / Project / User; the rest are part of
// the wire contract for later phases (see spec/settings-display.md).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerSource {
    Managed,
    Cli,
    Env,
    ProjectLocal,
    Project,
    User,
    Default,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LayerStatus {
    Ok,
    Missing,
    Error,
}

#[derive(Debug, Serialize)]
pub struct LayerRead {
    pub source: LayerSource,
    pub path: Option<String>,
    pub status: LayerStatus,
    pub raw: Option<Value>,
    pub error: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticLevel {
    Warn,
    Error,
}

#[derive(Debug, Serialize)]
pub struct Diagnostic {
    pub level: DiagnosticLevel,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct SettingsSnapshot {
    pub layers: Vec<LayerRead>,
    pub effective: Value,
    pub project_root: Option<String>,
    pub diagnostics: Vec<Diagnostic>,
}

fn read_layer(source: LayerSource, path: Option<PathBuf>) -> LayerRead {
    let Some(path) = path else {
        return LayerRead {
            source,
            path: None,
            status: LayerStatus::Missing,
            raw: None,
            error: None,
        };
    };
    let path_str = path.to_string_lossy().into_owned();
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(value) => LayerRead {
                source,
                path: Some(path_str),
                status: LayerStatus::Ok,
                raw: Some(value),
                error: None,
            },
            Err(e) => LayerRead {
                source,
                path: Some(path_str),
                status: LayerStatus::Error,
                raw: None,
                error: Some(format!("parse error: {e}")),
            },
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => LayerRead {
            source,
            path: Some(path_str),
            status: LayerStatus::Missing,
            raw: None,
            error: None,
        },
        Err(e) => LayerRead {
            source,
            path: Some(path_str),
            status: LayerStatus::Error,
            raw: None,
            error: Some(format!("io error: {e}")),
        },
    }
}

/// Wrap a leaf with provenance. Phase 1 always emits a single source per leaf;
/// `elements` is reserved for Phase 3's array-merge support.
fn provenance_leaf(value: Value, source: LayerSource) -> Value {
    let mut obj = Map::new();
    obj.insert("value".into(), value);
    obj.insert(
        "source".into(),
        serde_json::to_value(source).unwrap_or(Value::Null),
    );
    Value::Object(obj)
}

/// Recursively merge `incoming` (higher precedence) onto `acc`.
///
/// - Objects merge key-by-key.
/// - Everything else (scalars, arrays, null) is replaced wholesale and tagged
///   with `incoming_source`. Phase 1 deliberately treats arrays as scalars
///   here; array-concat-dedup is Phase 3.
fn merge_with_provenance(acc: &mut Value, incoming: Value, incoming_source: LayerSource) {
    match incoming {
        Value::Object(incoming_map) => {
            // If acc isn't an object yet, replace it with one we can merge into.
            // The acc tree is always made of objects (interior) and provenance
            // leaves (frontier); a provenance leaf being replaced by an object
            // means the higher-precedence layer turned a scalar into an object,
            // which is rare but possible.
            if !acc.is_object() || is_provenance_leaf(acc) {
                *acc = Value::Object(Map::new());
            }
            let acc_map = acc.as_object_mut().expect("acc is object");
            for (k, v) in incoming_map {
                match acc_map.get_mut(&k) {
                    Some(existing) => merge_with_provenance(existing, v, incoming_source),
                    None => {
                        let mut child = Value::Object(Map::new());
                        merge_with_provenance(&mut child, v, incoming_source);
                        acc_map.insert(k, child);
                    }
                }
            }
        }
        other => {
            *acc = provenance_leaf(other, incoming_source);
        }
    }
}

fn is_provenance_leaf(v: &Value) -> bool {
    let Some(obj) = v.as_object() else {
        return false;
    };
    obj.contains_key("value") && obj.contains_key("source")
}

fn home_dir() -> Option<PathBuf> {
    // Read HOME / USERPROFILE without pulling a dependency. Tauri targets
    // desktop OSes only, so this covers macOS, Linux, and Windows.
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn project_dir() -> Option<PathBuf> {
    std::env::current_dir().ok()
}

fn settings_path(dir: &Path, file: &str) -> PathBuf {
    dir.join(".claude").join(file)
}

pub fn read_snapshot() -> SettingsSnapshot {
    let mut diagnostics = Vec::new();

    let project = project_dir();
    if project.is_none() {
        diagnostics.push(Diagnostic {
            level: DiagnosticLevel::Warn,
            message: "could not resolve current working directory".into(),
        });
    }
    let home = home_dir();
    if home.is_none() {
        diagnostics.push(Diagnostic {
            level: DiagnosticLevel::Warn,
            message: "HOME (or USERPROFILE on Windows) is not set; user settings will be skipped"
                .into(),
        });
    }

    // Highest precedence first — matches the public API order. The merge below
    // walks them in reverse so higher-precedence values win.
    let layers = vec![
        read_layer(
            LayerSource::ProjectLocal,
            project
                .as_deref()
                .map(|d| settings_path(d, "settings.local.json")),
        ),
        read_layer(
            LayerSource::Project,
            project
                .as_deref()
                .map(|d| settings_path(d, "settings.json")),
        ),
        read_layer(
            LayerSource::User,
            home.as_deref().map(|d| settings_path(d, "settings.json")),
        ),
    ];

    let mut effective = Value::Object(Map::new());
    for layer in layers.iter().rev() {
        if layer.status != LayerStatus::Ok {
            continue;
        }
        let Some(raw) = layer.raw.clone() else {
            continue;
        };
        merge_with_provenance(&mut effective, raw, layer.source);
    }

    SettingsSnapshot {
        layers,
        effective,
        project_root: project.map(|p| p.to_string_lossy().into_owned()),
        diagnostics,
    }
}

#[tauri::command]
pub fn read_settings_layers() -> SettingsSnapshot {
    read_snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn merge_layers(layers: &[(LayerSource, Value)]) -> Value {
        // Mirror read_snapshot's merge order: walk lowest-precedence first.
        let mut acc = Value::Object(Map::new());
        for (source, raw) in layers {
            merge_with_provenance(&mut acc, raw.clone(), *source);
        }
        acc
    }

    #[test]
    fn scalar_from_single_layer_is_tagged_with_that_source() {
        let merged = merge_layers(&[(LayerSource::User, json!({ "model": "sonnet" }))]);
        assert_eq!(merged["model"]["value"], json!("sonnet"));
        assert_eq!(merged["model"]["source"], json!("user"));
    }

    #[test]
    fn higher_precedence_scalar_wins_and_replaces_provenance() {
        let merged = merge_layers(&[
            (LayerSource::User, json!({ "model": "sonnet" })),
            (LayerSource::Project, json!({ "model": "opus" })),
            (LayerSource::ProjectLocal, json!({ "model": "haiku" })),
        ]);
        assert_eq!(merged["model"]["value"], json!("haiku"));
        assert_eq!(merged["model"]["source"], json!("project_local"));
    }

    #[test]
    fn unset_at_higher_layer_keeps_lower_provenance() {
        let merged = merge_layers(&[
            (LayerSource::User, json!({ "model": "sonnet", "theme": "dark" })),
            (LayerSource::ProjectLocal, json!({ "model": "haiku" })),
        ]);
        assert_eq!(merged["model"]["source"], json!("project_local"));
        assert_eq!(merged["theme"]["value"], json!("dark"));
        assert_eq!(merged["theme"]["source"], json!("user"));
    }

    #[test]
    fn nested_objects_merge_per_key() {
        let merged = merge_layers(&[
            (
                LayerSource::User,
                json!({ "permissions": { "defaultMode": "ask", "deny": ["rm -rf /"] } }),
            ),
            (
                LayerSource::Project,
                json!({ "permissions": { "defaultMode": "auto" } }),
            ),
        ]);
        assert_eq!(merged["permissions"]["defaultMode"]["value"], json!("auto"));
        assert_eq!(
            merged["permissions"]["defaultMode"]["source"],
            json!("project")
        );
        // The deny array is only present at user; phase 1 treats arrays like
        // scalars, so it should still appear with user provenance.
        assert_eq!(
            merged["permissions"]["deny"]["value"],
            json!(["rm -rf /"])
        );
        assert_eq!(merged["permissions"]["deny"]["source"], json!("user"));
    }

    #[test]
    fn arrays_are_replaced_wholesale_in_phase_1() {
        // Documents the deliberate phase 1 limitation: array-merge concat-dedup
        // is deferred to phase 3, so a higher layer's array fully replaces the
        // lower layer's array. If this test ever needs updating, it means
        // phase 3 has landed and ProvenancedValue should grow `elements`.
        let merged = merge_layers(&[
            (LayerSource::User, json!({ "permissions": { "allow": ["a", "b"] } })),
            (
                LayerSource::Project,
                json!({ "permissions": { "allow": ["c"] } }),
            ),
        ]);
        assert_eq!(
            merged["permissions"]["allow"]["value"],
            json!(["c"])
        );
        assert_eq!(
            merged["permissions"]["allow"]["source"],
            json!("project")
        );
    }

    #[test]
    fn higher_layer_object_replaces_lower_layer_scalar() {
        let merged = merge_layers(&[
            (LayerSource::User, json!({ "permissions": "auto" })),
            (
                LayerSource::Project,
                json!({ "permissions": { "defaultMode": "ask" } }),
            ),
        ]);
        // The scalar leaf got promoted to an object; the inner key carries
        // project provenance, and the original user value is gone.
        assert_eq!(
            merged["permissions"]["defaultMode"]["value"],
            json!("ask")
        );
        assert_eq!(
            merged["permissions"]["defaultMode"]["source"],
            json!("project")
        );
    }

    #[test]
    fn is_provenance_leaf_recognizes_shape() {
        assert!(is_provenance_leaf(
            &json!({ "value": "x", "source": "user" })
        ));
        assert!(!is_provenance_leaf(&json!({ "value": "x" })));
        assert!(!is_provenance_leaf(&json!({ "source": "user" })));
        assert!(!is_provenance_leaf(&json!("scalar")));
        assert!(!is_provenance_leaf(&json!([1, 2])));
    }

    #[test]
    fn provenance_leaf_has_value_and_source() {
        let v = provenance_leaf(json!(42), LayerSource::Project);
        assert_eq!(v["value"], json!(42));
        assert_eq!(v["source"], json!("project"));
    }

    #[test]
    fn read_layer_reports_missing_for_absent_file() {
        let layer = read_layer(
            LayerSource::User,
            Some(PathBuf::from("/nonexistent/path/to/settings.json")),
        );
        assert!(matches!(layer.status, LayerStatus::Missing));
        assert!(layer.raw.is_none());
        assert!(layer.error.is_none());
    }

    #[test]
    fn read_layer_reports_error_on_malformed_json() {
        let dir = std::env::temp_dir().join(format!(
            "knobs-cc-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, "{ not json }").unwrap();
        let layer = read_layer(LayerSource::User, Some(path.clone()));
        assert!(matches!(layer.status, LayerStatus::Error));
        assert!(layer.error.is_some());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_layer_parses_valid_json() {
        let dir = std::env::temp_dir().join(format!(
            "knobs-cc-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, r#"{ "model": "opus" }"#).unwrap();
        let layer = read_layer(LayerSource::Project, Some(path.clone()));
        assert!(matches!(layer.status, LayerStatus::Ok));
        assert_eq!(layer.raw.unwrap(), json!({ "model": "opus" }));
        std::fs::remove_dir_all(&dir).ok();
    }
}
