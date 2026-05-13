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
    /// Sibling read of the managed-tier MCP-servers file. Not part of the
    /// settings precedence merge — surfaced separately so the UI can
    /// indicate that an admin has shipped MCP policy. (`spec/inventory.md:42`,
    /// `spec/settings-display.md` Phase 2.)
    #[serde(rename = "managed_mcp")]
    pub managed_mcp: LayerRead,
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

// ---- Array-merge ----------------------------------------------------------
//
// Per `inventory.md:58`, a small set of array-valued settings are
// concatenated + deduplicated across layers rather than replaced last-wins.
// For these fields, the leaf carries `source: null` at the field level and a
// per-element provenance list under `elements`. See spec/settings-display.md
// "Merge semantics" and inspector-ui.md:117-124.

const ARRAY_MERGED_PATHS: &[&[&str]] = &[
    &["permissions", "allow"],
    &["permissions", "deny"],
    &["permissions", "ask"],
    &["permissions", "additionalDirectories"],
    &["sandbox", "filesystem", "allowWrite"],
];

fn lookup_path<'a>(raw: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = raw;
    for seg in path {
        cur = cur.as_object()?.get(*seg)?;
    }
    Some(cur)
}

fn set_path(root: &mut Value, path: &[&str], leaf: Value) {
    if path.is_empty() {
        *root = leaf;
        return;
    }
    if !root.is_object() || is_provenance_leaf(root) {
        *root = Value::Object(Map::new());
    }
    let obj = root.as_object_mut().expect("ensured object above");
    let (head, rest) = (path[0], &path[1..]);
    if rest.is_empty() {
        obj.insert(head.to_string(), leaf);
        return;
    }
    let child = obj
        .entry(head.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    set_path(child, rest, leaf);
}

/// For one known array-merged path, walk the layers in lowest-precedence-first
/// order, collect array elements, dedupe by serialized JSON (first contributor
/// wins), and emit a provenance leaf with `value` (the merged array),
/// `source: null`, and `elements` (per-element source list). Returns `None`
/// when no layer contributed an array at this path.
fn collect_array_merged(layers: &[LayerRead], path: &[&str]) -> Option<Value> {
    let mut elements: Vec<Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // `layers` is stored highest-first; reverse to walk lowest-first. This
    // matches the merge order in `read_snapshot` and means the lowest-precedence
    // layer contributing a given element gets the credit — so the rule's
    // origin reads from "where was this rule first added?".
    for layer in layers.iter().rev() {
        if layer.status != LayerStatus::Ok {
            continue;
        }
        let Some(raw) = layer.raw.as_ref() else {
            continue;
        };
        let Some(node) = lookup_path(raw, path) else {
            continue;
        };
        let Some(arr) = node.as_array() else {
            continue;
        };
        for item in arr {
            let key = serde_json::to_string(item).unwrap_or_default();
            if seen.insert(key) {
                let mut entry = Map::new();
                entry.insert("value".into(), item.clone());
                entry.insert(
                    "source".into(),
                    serde_json::to_value(layer.source).unwrap_or(Value::Null),
                );
                elements.push(Value::Object(entry));
            }
        }
    }

    if elements.is_empty() {
        return None;
    }

    let value_array: Vec<Value> = elements
        .iter()
        .filter_map(|e| e.get("value").cloned())
        .collect();

    let mut leaf = Map::new();
    leaf.insert("value".into(), Value::Array(value_array));
    leaf.insert("source".into(), Value::Null);
    leaf.insert("elements".into(), Value::Array(elements));
    Some(Value::Object(leaf))
}

fn apply_array_merge(effective: &mut Value, layers: &[LayerRead]) {
    for path in ARRAY_MERGED_PATHS {
        if let Some(leaf) = collect_array_merged(layers, path) {
            set_path(effective, path, leaf);
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    // Read HOME / USERPROFILE without pulling a dependency. Tauri targets
    // desktop OSes only, so this covers macOS, Linux, and Windows.
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn settings_path(dir: &Path, file: &str) -> PathBuf {
    dir.join(".claude").join(file)
}

/// How the project root was supplied to a snapshot read. Mirrors the
/// attach-mode spec: an attached pid wins over a path override; both win
/// over the legacy "knobs.cc's own CWD" fallback.
pub enum ProjectSource {
    /// Pre-pivot fallback: read project/project_local relative to whatever
    /// directory knobs.cc itself was launched from. Useful only in tests
    /// and the no-attach-no-picker default; production frontends after the
    /// pivot will always supply Attached or Picked.
    CurrentDir,
    /// User attached to a running claude; the snapshot grounds itself in
    /// that process's cwd. Carries the pid so we can emit an honest
    /// diagnostic if the process is gone.
    Attached(u32),
    /// User picked a project directory via the path-picker fallback (no
    /// claude running, or explicit override).
    Picked(PathBuf),
}

/// One-shot resolution of grounding from a `ProjectSource`. When attached,
/// fetches the full ClaudeProcess (cwd + argv + environ) so the cli + env
/// + project layers can each draw from the same sysinfo snapshot rather
/// than re-querying.
fn resolve_grounding(
    source: &ProjectSource,
    diagnostics: &mut Vec<Diagnostic>,
) -> (Option<PathBuf>, Option<crate::runtime::ClaudeProcess>) {
    match source {
        ProjectSource::CurrentDir => (std::env::current_dir().ok(), None),
        ProjectSource::Attached(pid) => match crate::runtime::process_for_pid(*pid) {
            Some(p) => {
                let cwd = PathBuf::from(&p.cwd);
                (Some(cwd), Some(p))
            }
            None => {
                diagnostics.push(Diagnostic {
                    level: DiagnosticLevel::Warn,
                    message: format!(
                        "attached claude process (pid {pid}) is no longer visible — project / cli / env layers will be empty"
                    ),
                });
                (None, None)
            }
        },
        ProjectSource::Picked(path) => {
            if path.is_dir() {
                (Some(path.clone()), None)
            } else {
                diagnostics.push(Diagnostic {
                    level: DiagnosticLevel::Warn,
                    message: format!(
                        "picked project directory does not exist: {}",
                        path.display()
                    ),
                });
                (None, None)
            }
        }
    }
}

pub fn read_snapshot(source: ProjectSource) -> SettingsSnapshot {
    let mut diagnostics = Vec::new();

    let (project, attached) = resolve_grounding(&source, &mut diagnostics);
    if project.is_none() && matches!(source, ProjectSource::CurrentDir) {
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

    // `cli` and `env` layers ground in the attached process's argv / environ
    // when available; otherwise they fall back to the legacy behaviors
    // (cli: Missing — no argv to read; env: knobs.cc's own process env).
    let cli_layer = match attached.as_ref() {
        Some(p) => crate::cli_layer::read_cli_layer(&p.argv),
        None => LayerRead {
            source: LayerSource::Cli,
            path: None,
            status: LayerStatus::Missing,
            raw: None,
            error: None,
        },
    };
    let env_layer = match attached.as_ref() {
        Some(p) => crate::env_layer::read_env_layer_attached(&p.environ),
        None => crate::env_layer::read_env_layer(),
    };

    // Highest precedence first — matches the public API order. The merge below
    // walks them in reverse so higher-precedence values win.
    let layers = vec![
        crate::managed_layer::read_managed_layer(),
        cli_layer,
        env_layer,
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
    let managed_mcp = crate::managed_layer::read_managed_mcp();

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
    // After last-wins, rewrite the leaf for known array-merged paths.
    apply_array_merge(&mut effective, &layers);

    SettingsSnapshot {
        layers,
        effective,
        project_root: project.map(|p| p.to_string_lossy().into_owned()),
        diagnostics,
        managed_mcp,
    }
}

/// The Tauri command. Frontend supplies one of:
/// - `attached_pid` — preferred, grounds the snapshot in a running claude.
/// - `project_root_override` — fallback for the no-claude / path-picker flow.
/// - neither — legacy "knobs.cc's own CWD" behavior, kept so existing
///   integration smoke tests don't break during migration.
///
/// If both are supplied, `attached_pid` wins per the attach-mode spec.
///
/// `rename_all = "snake_case"` is load-bearing: Tauri 2 defaults to
/// camelCase for JS-side command args, but the rest of this project's
/// wire format is snake_case (matching the SettingsSnapshot return shape
/// via `#[serde(rename_all = "snake_case")]`). Without this attribute,
/// `attached_pid: 75618` from JS silently deserialized to `None` and the
/// snapshot fell back to `ProjectSource::CurrentDir`.
#[tauri::command(rename_all = "snake_case")]
pub fn read_settings_layers(
    attached_pid: Option<u32>,
    project_root_override: Option<String>,
) -> SettingsSnapshot {
    let source = match (attached_pid, project_root_override) {
        (Some(pid), _) => ProjectSource::Attached(pid),
        (None, Some(path)) => ProjectSource::Picked(PathBuf::from(path)),
        (None, None) => ProjectSource::CurrentDir,
    };
    read_snapshot(source)
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
    fn merge_with_provenance_replaces_arrays_last_wins() {
        // `merge_with_provenance` itself is last-wins for everything except
        // objects — that's deliberate. Array-merge for the known fields runs
        // as a post-pass (`apply_array_merge`); see `array_merged_*` tests.
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

    fn ok_layer(source: LayerSource, raw: Value) -> LayerRead {
        LayerRead {
            source,
            path: None,
            status: LayerStatus::Ok,
            raw: Some(raw),
            error: None,
        }
    }

    #[test]
    fn array_merged_concats_across_layers_lowest_first() {
        // `layers` is stored highest-first (matches read_snapshot's order).
        let layers = vec![
            ok_layer(LayerSource::Project, json!({"permissions": {"allow": ["c"]}})),
            ok_layer(LayerSource::User, json!({"permissions": {"allow": ["a", "b"]}})),
        ];
        let mut eff = Value::Object(Map::new());
        apply_array_merge(&mut eff, &layers);
        let leaf = lookup_path(&eff, &["permissions", "allow"]).unwrap();
        assert_eq!(leaf["value"], json!(["a", "b", "c"]));
        assert_eq!(leaf["source"], Value::Null);
        let elements = leaf["elements"].as_array().unwrap();
        assert_eq!(elements[0], json!({"value": "a", "source": "user"}));
        assert_eq!(elements[1], json!({"value": "b", "source": "user"}));
        assert_eq!(elements[2], json!({"value": "c", "source": "project"}));
    }

    #[test]
    fn array_merged_dedupes_with_first_contributor_winning() {
        // user adds a+b; project also adds b — b's source stays user (lowest
        // precedence to contribute it).
        let layers = vec![
            ok_layer(
                LayerSource::Project,
                json!({"permissions": {"allow": ["b", "c"]}}),
            ),
            ok_layer(
                LayerSource::User,
                json!({"permissions": {"allow": ["a", "b"]}}),
            ),
        ];
        let mut eff = Value::Object(Map::new());
        apply_array_merge(&mut eff, &layers);
        let leaf = lookup_path(&eff, &["permissions", "allow"]).unwrap();
        assert_eq!(leaf["value"], json!(["a", "b", "c"]));
        let elements = leaf["elements"].as_array().unwrap();
        assert_eq!(elements[1], json!({"value": "b", "source": "user"}));
        assert_eq!(elements[2], json!({"value": "c", "source": "project"}));
    }

    #[test]
    fn array_merged_skips_non_array_values_and_failed_layers() {
        let layers = vec![
            ok_layer(
                LayerSource::Project,
                json!({"permissions": {"allow": "not an array"}}),
            ),
            ok_layer(LayerSource::User, json!({"permissions": {"allow": ["a"]}})),
            LayerRead {
                source: LayerSource::ProjectLocal,
                path: None,
                status: LayerStatus::Error,
                raw: None,
                error: Some("parse fail".into()),
            },
        ];
        let mut eff = Value::Object(Map::new());
        apply_array_merge(&mut eff, &layers);
        let leaf = lookup_path(&eff, &["permissions", "allow"]).unwrap();
        assert_eq!(leaf["value"], json!(["a"]));
    }

    #[test]
    fn array_merged_emits_nothing_when_no_layer_has_the_path() {
        let layers = vec![ok_layer(LayerSource::User, json!({"model": "opus"}))];
        let mut eff = Value::Object(Map::new());
        apply_array_merge(&mut eff, &layers);
        assert!(lookup_path(&eff, &["permissions", "allow"]).is_none());
    }

    #[test]
    fn array_merged_overwrites_last_wins_leaf() {
        let layers = vec![
            ok_layer(LayerSource::Project, json!({"permissions": {"allow": ["b"]}})),
            ok_layer(LayerSource::User, json!({"permissions": {"allow": ["a"]}})),
        ];
        let mut eff = Value::Object(Map::new());
        for layer in layers.iter().rev() {
            merge_with_provenance(&mut eff, layer.raw.clone().unwrap(), layer.source);
        }
        // Sanity: last-wins put a single source on the leaf.
        assert_eq!(
            lookup_path(&eff, &["permissions", "allow"]).unwrap()["source"],
            json!("project"),
        );
        apply_array_merge(&mut eff, &layers);
        let leaf = lookup_path(&eff, &["permissions", "allow"]).unwrap();
        assert_eq!(leaf["value"], json!(["a", "b"]));
        assert_eq!(leaf["source"], Value::Null);
    }

    #[test]
    fn array_merged_dedupes_object_elements_by_serialized_json() {
        // Permission rules are typically strings, but additionalDirectories
        // could in principle be object entries. Verify dedup is shape-aware.
        let layers = vec![
            ok_layer(
                LayerSource::Project,
                json!({"permissions": {"additionalDirectories": [{"path": "/x"}]}}),
            ),
            ok_layer(
                LayerSource::User,
                json!({"permissions": {"additionalDirectories": [{"path": "/x"}, {"path": "/y"}]}}),
            ),
        ];
        let mut eff = Value::Object(Map::new());
        apply_array_merge(&mut eff, &layers);
        let leaf = lookup_path(&eff, &["permissions", "additionalDirectories"]).unwrap();
        assert_eq!(leaf["value"], json!([{"path": "/x"}, {"path": "/y"}]));
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

    // ---- Grounding (ProjectSource) -----------------------------------

    fn temp_project_with_settings(model: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "knobs-cc-grounding-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        let claude_dir = dir.join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        std::fs::write(
            claude_dir.join("settings.json"),
            format!(r#"{{ "model": "{model}" }}"#),
        )
        .unwrap();
        dir
    }

    fn find_layer<'a>(
        snap: &'a SettingsSnapshot,
        source: LayerSource,
    ) -> &'a LayerRead {
        snap.layers
            .iter()
            .find(|l| matches!((l.source, source), (a, b) if std::mem::discriminant(&a) == std::mem::discriminant(&b)))
            .expect("layer present")
    }

    #[test]
    fn picked_project_dir_grounds_project_layer() {
        let project = temp_project_with_settings("opus");
        let snap = read_snapshot(ProjectSource::Picked(project.clone()));
        let layer = find_layer(&snap, LayerSource::Project);
        assert!(matches!(layer.status, LayerStatus::Ok));
        assert_eq!(layer.raw.as_ref().unwrap()["model"], json!("opus"));
        let p = layer.path.as_ref().unwrap();
        assert!(
            p.contains(&project.to_string_lossy().to_string()),
            "expected project path to contain the picked dir; got {p}",
        );
        assert_eq!(snap.project_root.as_deref(), Some(&*project.to_string_lossy()));
        std::fs::remove_dir_all(&project).ok();
    }

    #[test]
    fn picked_nonexistent_dir_emits_diagnostic_and_skips_layer() {
        let bogus = PathBuf::from("/nonexistent/path/that/will/never/exist");
        let snap = read_snapshot(ProjectSource::Picked(bogus.clone()));
        // Project layer falls back to "no path" — read_layer treats that as
        // Missing without an error, but we expect a diagnostic naming the
        // bogus dir so the user can correct.
        assert!(
            snap.diagnostics
                .iter()
                .any(|d| d.message.contains("picked project directory does not exist")),
            "expected a diagnostic about the bogus directory; got {:?}",
            snap.diagnostics
                .iter()
                .map(|d| &d.message)
                .collect::<Vec<_>>(),
        );
        let layer = find_layer(&snap, LayerSource::Project);
        assert!(matches!(layer.status, LayerStatus::Missing));
    }

    #[test]
    fn attached_pid_for_unknown_process_emits_diagnostic() {
        // u32::MAX is reliably an unused pid; resolve_project_dir routes
        // that through runtime::cwd_for_pid which returns None.
        let snap = read_snapshot(ProjectSource::Attached(u32::MAX));
        assert!(
            snap.diagnostics
                .iter()
                .any(|d| d.message.contains("no longer visible")),
            "expected a diagnostic about the missing attached process; got {:?}",
            snap.diagnostics
                .iter()
                .map(|d| &d.message)
                .collect::<Vec<_>>(),
        );
        let layer = find_layer(&snap, LayerSource::Project);
        assert!(matches!(layer.status, LayerStatus::Missing));
    }

    fn cli_layer<'a>(snap: &'a SettingsSnapshot) -> &'a LayerRead {
        snap.layers
            .iter()
            .find(|l| matches!(l.source, LayerSource::Cli))
            .expect("cli layer slot must be present in every snapshot")
    }

    #[test]
    fn cli_layer_missing_when_grounding_isnt_attached() {
        let snap = read_snapshot(ProjectSource::CurrentDir);
        let l = cli_layer(&snap);
        assert!(
            matches!(l.status, LayerStatus::Missing),
            "expected Missing for current-dir grounding; got {:?}",
            l.status,
        );
        // Picked grounding likewise has no process to read argv from.
        let snap = read_snapshot(ProjectSource::Picked(std::env::temp_dir()));
        let l = cli_layer(&snap);
        assert!(matches!(l.status, LayerStatus::Missing));
    }

    #[test]
    fn cli_layer_ok_when_attached_to_live_process() {
        // sysinfo can't read another process's environ on Windows; attach
        // mode reports `Unsupported` and `process_for_pid` returns None,
        // so an "attached" snapshot has no argv to parse and the cli
        // layer stays Missing. The test's premise only holds on Unix.
        if cfg!(target_os = "windows") {
            return;
        }
        // The test runner's argv doesn't contain claude flags, so the cli
        // layer will be Ok with an empty `raw` — but the slot must be Ok,
        // not Missing, and the rail row must un-grey.
        let snap = read_snapshot(ProjectSource::Attached(std::process::id()));
        let l = cli_layer(&snap);
        assert!(
            matches!(l.status, LayerStatus::Ok),
            "expected Ok for attached grounding; got {:?}",
            l.status,
        );
        assert!(l.raw.is_some(), "cli layer raw must be set when Ok");
    }

    #[test]
    fn attached_pid_for_live_process_resolves_project_root() {
        // Same Windows caveat as above — `process_for_pid` is Unix-only
        // in v1, so this end-to-end attach test only runs on macOS / Linux.
        if cfg!(target_os = "windows") {
            return;
        }
        // process_for_pid is gated on same-UID + a readable cwd; it does
        // not require the target to be named claude (that filter runs at
        // discovery time in read_runtime_layer). Using our own pid is the
        // cheapest way to exercise the live resolution path end-to-end.
        let our_pid = std::process::id();
        let snap = read_snapshot(ProjectSource::Attached(our_pid));
        // The test runner's cwd is the project_root we should have read.
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(
            snap.project_root.as_deref(),
            Some(&*cwd.to_string_lossy()),
            "attached snapshot should ground in the live process's cwd",
        );
        // No "no longer visible" diagnostic — the process is us.
        assert!(
            !snap.diagnostics.iter().any(|d| d.message.contains("no longer visible")),
            "live pid should not produce a missing-process diagnostic",
        );
    }

    #[test]
    fn current_dir_fallback_matches_legacy_behavior() {
        // The pre-pivot behavior: project root resolves to whatever
        // std::env::current_dir() returns. We don't assert specific paths
        // (tests run in unpredictable cwd), only that the snapshot has a
        // project_root set when env::current_dir is resolvable.
        let snap = read_snapshot(ProjectSource::CurrentDir);
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(
            snap.project_root.as_deref(),
            Some(&*cwd.to_string_lossy()),
            "current-dir grounding should match std::env::current_dir() output",
        );
    }
}
