//! Phase 3b of `spec/settings-display.md`: read process env vars and fold
//! them into the snapshot as the `env` layer.
//!
//! The env-var → settings-key mapping is hand-maintained at
//! `catalog/env-settings-map.json` because the upstream JSON Schema doesn't
//! expose env equivalents as structured metadata, and inversion logic
//! (`DISABLE_*` flipping a bool) can't be inferred from prose.

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::settings::{LayerRead, LayerSource, LayerStatus};

const RAW_MAPPING_FILE: &str = include_str!("../../catalog/env-settings-map.json");

#[derive(Debug, Deserialize)]
struct MappingFile {
    mappings: Vec<EnvMapping>,
}

#[derive(Debug, Deserialize)]
struct EnvMapping {
    env: String,
    settings: String,
    #[serde(rename = "type")]
    ty: String,
    #[serde(default)]
    invert: bool,
}

fn load_mappings() -> Vec<EnvMapping> {
    serde_json::from_str::<MappingFile>(RAW_MAPPING_FILE)
        .expect("catalog/env-settings-map.json must parse at compile time")
        .mappings
}

/// Coerce an env-var string into the typed JSON value the settings field
/// expects. Returns `None` (i.e. "skip this mapping") rather than poisoning
/// the layer when the value can't be coerced — a malformed env var
/// shouldn't drop the inspector to an error state.
fn coerce(raw: &str, ty: &str, invert: bool) -> Option<Value> {
    match ty {
        "string" => Some(Value::String(raw.to_string())),
        "bool" => coerce_bool(raw).map(|b| Value::Bool(if invert { !b } else { b })),
        "int" => raw
            .trim()
            .parse::<i64>()
            .ok()
            .map(|n| Value::Number(n.into())),
        _ => None,
    }
}

fn coerce_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" => Some(true),
        "0" | "false" | "no" | "" => Some(false),
        _ => None,
    }
}

/// Insert `value` at the dotted settings path, creating intermediate
/// objects as needed.
fn set_dotted_path(root: &mut Value, dotted: &str, value: Value) {
    let segments: Vec<&str> = dotted.split('.').collect();
    set_segments(root, &segments, value);
}

fn set_segments(root: &mut Value, segments: &[&str], value: Value) {
    if segments.is_empty() {
        *root = value;
        return;
    }
    if !root.is_object() {
        *root = Value::Object(Map::new());
    }
    let map = root.as_object_mut().expect("ensured object above");
    let head = segments[0];
    let rest = &segments[1..];
    if rest.is_empty() {
        map.insert(head.to_string(), value);
        return;
    }
    let child = map
        .entry(head.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    set_segments(child, rest, value);
}

/// Walk the mapping table, look up each env var via `read_env`, coerce, and
/// drop a value into the synthetic settings object. Pulled out of
/// `read_env_layer` so tests can exercise the synthesis without touching
/// the process environment.
fn build_raw<F: Fn(&str) -> Option<String>>(
    mappings: &[EnvMapping],
    read_env: F,
) -> Value {
    let mut raw = Value::Object(Map::new());
    for m in mappings {
        let Some(value) = read_env(&m.env) else {
            continue;
        };
        let Some(coerced) = coerce(&value, &m.ty, m.invert) else {
            continue;
        };
        set_dotted_path(&mut raw, &m.settings, coerced);
    }
    raw
}

/// Build the env LayerRead from the current process environment. Always
/// returns `Ok` — even when no mapped vars are set, an empty raw object is
/// the right answer (the rail row will just show count 0).
pub fn read_env_layer() -> LayerRead {
    let mappings = load_mappings();
    let raw = build_raw(&mappings, |key| std::env::var(key).ok());
    LayerRead {
        source: LayerSource::Env,
        path: None,
        status: LayerStatus::Ok,
        raw: Some(raw),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn map_string(env: &str, settings: &str) -> EnvMapping {
        EnvMapping {
            env: env.into(),
            settings: settings.into(),
            ty: "string".into(),
            invert: false,
        }
    }

    fn map_bool(env: &str, settings: &str, invert: bool) -> EnvMapping {
        EnvMapping {
            env: env.into(),
            settings: settings.into(),
            ty: "bool".into(),
            invert,
        }
    }

    #[test]
    fn coerce_string_is_passthrough() {
        assert_eq!(coerce("opus", "string", false), Some(json!("opus")));
        assert_eq!(coerce("", "string", false), Some(json!("")));
    }

    #[test]
    fn coerce_bool_recognises_truthy_and_falsy() {
        for raw in ["1", "true", "TRUE", "yes", "Yes"] {
            assert_eq!(coerce(raw, "bool", false), Some(json!(true)), "raw={raw:?}");
        }
        for raw in ["0", "false", "no", ""] {
            assert_eq!(coerce(raw, "bool", false), Some(json!(false)), "raw={raw:?}");
        }
    }

    #[test]
    fn coerce_bool_returns_none_on_unrecognised_value() {
        assert_eq!(coerce("maybe", "bool", false), None);
        assert_eq!(coerce("2", "bool", false), None);
    }

    #[test]
    fn coerce_bool_invert_flips_after_parse() {
        // env=1 with invert=true → false (e.g. CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1
        // means includeGitInstructions=false).
        assert_eq!(coerce("1", "bool", true), Some(json!(false)));
        assert_eq!(coerce("0", "bool", true), Some(json!(true)));
    }

    #[test]
    fn coerce_int_parses_or_returns_none() {
        assert_eq!(coerce("600000", "int", false), Some(json!(600_000)));
        assert_eq!(coerce("not-a-number", "int", false), None);
    }

    #[test]
    fn coerce_unknown_type_returns_none() {
        assert_eq!(coerce("anything", "float", false), None);
    }

    #[test]
    fn build_raw_emits_mapped_env_at_settings_path() {
        let mappings = vec![map_string("ANTHROPIC_MODEL", "model")];
        let env: HashMap<&str, String> =
            [("ANTHROPIC_MODEL", "opus".to_string())].into_iter().collect();
        let raw = build_raw(&mappings, |k| env.get(k).cloned());
        assert_eq!(raw, json!({ "model": "opus" }));
    }

    #[test]
    fn build_raw_supports_dotted_settings_paths() {
        let mappings = vec![map_string("X", "permissions.defaultMode")];
        let env: HashMap<&str, String> =
            [("X", "ask".to_string())].into_iter().collect();
        let raw = build_raw(&mappings, |k| env.get(k).cloned());
        assert_eq!(raw, json!({ "permissions": { "defaultMode": "ask" } }));
    }

    #[test]
    fn build_raw_emits_empty_object_when_no_vars_are_set() {
        let mappings = vec![map_string("ANTHROPIC_MODEL", "model")];
        let raw = build_raw(&mappings, |_| None);
        assert_eq!(raw, json!({}));
    }

    #[test]
    fn build_raw_skips_unrecognised_bool() {
        let mappings = vec![map_bool("FLAG", "flag", false)];
        let env: HashMap<&str, String> =
            [("FLAG", "maybe".to_string())].into_iter().collect();
        let raw = build_raw(&mappings, |k| env.get(k).cloned());
        assert_eq!(raw, json!({}));
    }

    #[test]
    fn build_raw_inverts_when_flag_is_set() {
        let mappings = vec![map_bool(
            "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
            "includeGitInstructions",
            true,
        )];
        let env: HashMap<&str, String> = [(
            "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
            "1".to_string(),
        )]
        .into_iter()
        .collect();
        let raw = build_raw(&mappings, |k| env.get(k).cloned());
        assert_eq!(raw, json!({ "includeGitInstructions": false }));
    }

    #[test]
    fn mapping_file_parses_and_contains_anthropic_model() {
        // Compile-time-embedded JSON: this guards against the file going
        // malformed without the build noticing.
        let mappings = load_mappings();
        assert!(!mappings.is_empty());
        assert!(mappings.iter().any(|m| m.env == "ANTHROPIC_MODEL"));
    }
}
