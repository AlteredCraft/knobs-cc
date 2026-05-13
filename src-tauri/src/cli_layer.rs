//! Attach-mode PR 2: synthesize the `cli` precedence layer from the
//! attached claude's argv.
//!
//! Mirrors `env_layer.rs`'s shape: a hand-curated map at
//! `catalog/cli-settings-map.json` translates known flags to settings keys,
//! and `build_raw` walks an argv slice producing a synthetic settings
//! object. The rest of the snapshot's merge machinery treats the result
//! identically to any other layer.
//!
//! Closes the cli-row half of #11.

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::settings::{LayerRead, LayerSource, LayerStatus};

const RAW_MAPPING_FILE: &str = include_str!("../../catalog/cli-settings-map.json");

#[derive(Debug, Deserialize)]
struct MappingFile {
    mappings: Vec<CliMapping>,
}

#[derive(Debug, Deserialize)]
struct CliMapping {
    flag: String,
    settings: String,
    kind: String,
}

fn load_mappings() -> Vec<CliMapping> {
    serde_json::from_str::<MappingFile>(RAW_MAPPING_FILE)
        .expect("catalog/cli-settings-map.json must parse at compile time")
        .mappings
}

/// Set a JSON value at a dotted settings path. Used by the `string` kind to
/// place a scalar; the `stringArrayMulti` kind has its own array-aware
/// variant below.
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

/// Append a list of values to the array at the given dotted path. Creates
/// the array if it doesn't exist. Used by `stringArrayMulti` flags like
/// `--add-dir A B C`.
fn append_to_array_path(root: &mut Value, dotted: &str, values: Vec<Value>) {
    let segments: Vec<&str> = dotted.split('.').collect();
    if values.is_empty() {
        return;
    }
    // Walk to the parent, then append/create at the leaf.
    let mut cur = root;
    for seg in &segments[..segments.len() - 1] {
        if !cur.is_object() {
            *cur = Value::Object(Map::new());
        }
        let map = cur.as_object_mut().expect("ensured object above");
        let child = map
            .entry(seg.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        cur = child;
    }
    if !cur.is_object() {
        *cur = Value::Object(Map::new());
    }
    let leaf_map = cur.as_object_mut().expect("ensured object above");
    let last = segments.last().expect("non-empty path");
    let entry = leaf_map
        .entry(last.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if let Some(arr) = entry.as_array_mut() {
        arr.extend(values);
    } else {
        // The path already held a non-array value (shouldn't happen for a
        // fresh cli layer, but be defensive). Overwrite with the array.
        *entry = Value::Array(values);
    }
}

/// Pure parser: walk an argv slice and a mapping table, return the
/// synthesized settings object. argv[0] (the binary path) is ignored.
///
/// Tokens that don't match a known flag are skipped silently — claude has
/// many flags we don't map yet, and erroring on unrecognised input would
/// poison the layer for any session that uses an unmapped flag (effectively
/// most of them).
///
fn build_raw(argv: &[String], mappings: &[CliMapping]) -> Value {
    use std::collections::HashMap;
    let by_flag: HashMap<&str, &CliMapping> =
        mappings.iter().map(|m| (m.flag.as_str(), m)).collect();

    let mut raw = Value::Object(Map::new());
    let mut i = 1; // skip argv[0]
    while i < argv.len() {
        let tok = &argv[i];
        // Support both `--flag value` and `--flag=value` forms.
        let (flag, inline_value): (&str, Option<&str>) =
            if let Some(eq) = tok.find('=') {
                (&tok[..eq], Some(&tok[eq + 1..]))
            } else {
                (tok.as_str(), None)
            };

        let Some(mapping) = by_flag.get(flag) else {
            i += 1;
            continue;
        };

        match mapping.kind.as_str() {
            "string" => {
                let value = if let Some(v) = inline_value {
                    v.to_string()
                } else {
                    i += 1;
                    if i >= argv.len() {
                        // Flag without value at end of argv — silently
                        // drop. The cli layer is a best-effort surface,
                        // not a syntax checker.
                        break;
                    }
                    argv[i].clone()
                };
                set_dotted_path(&mut raw, &mapping.settings, Value::String(value));
            }
            "stringArrayMulti" => {
                // Consume tokens until the next `-`-prefixed token or end.
                // Mirrors clap's `<arg...>` variadic flag style — claude's
                // `--add-dir ../apps ../lib` is the canonical example.
                let mut values: Vec<Value> = Vec::new();
                if let Some(v) = inline_value {
                    values.push(Value::String(v.to_string()));
                }
                i += 1;
                while i < argv.len() && !argv[i].starts_with('-') {
                    values.push(Value::String(argv[i].clone()));
                    i += 1;
                }
                if !values.is_empty() {
                    append_to_array_path(&mut raw, &mapping.settings, values);
                }
                // The outer `i += 1` at the bottom would advance past a
                // valid flag token; `continue` so we re-examine argv[i].
                continue;
            }
            _ => {
                // Unknown kind — defensive. Skip silently.
                i += 1;
                continue;
            }
        }
        i += 1;
    }
    raw
}

/// Build the cli LayerRead from an attached claude's argv. Returns `Missing`
/// when argv is empty (degenerate input — process exited or wasn't readable).
pub fn read_cli_layer(argv: &[String]) -> LayerRead {
    if argv.is_empty() {
        return LayerRead {
            source: LayerSource::Cli,
            path: None,
            status: LayerStatus::Missing,
            raw: None,
            error: None,
        };
    }
    let mappings = load_mappings();
    let raw = build_raw(argv, &mappings);
    LayerRead {
        source: LayerSource::Cli,
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

    fn map_string(flag: &str, settings: &str) -> CliMapping {
        CliMapping {
            flag: flag.into(),
            settings: settings.into(),
            kind: "string".into(),
        }
    }

    fn map_array(flag: &str, settings: &str) -> CliMapping {
        CliMapping {
            flag: flag.into(),
            settings: settings.into(),
            kind: "stringArrayMulti".into(),
        }
    }

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn string_flag_extracts_next_token_as_value() {
        let map = vec![map_string("--model", "model")];
        let out = build_raw(&argv(&["claude", "--model", "opus"]), &map);
        assert_eq!(out, json!({ "model": "opus" }));
    }

    #[test]
    fn string_flag_extracts_inline_eq_value() {
        let map = vec![map_string("--model", "model")];
        let out = build_raw(&argv(&["claude", "--model=opus"]), &map);
        assert_eq!(out, json!({ "model": "opus" }));
    }

    #[test]
    fn string_flag_uses_dotted_settings_path() {
        let map = vec![map_string("--permission-mode", "permissions.defaultMode")];
        let out = build_raw(&argv(&["claude", "--permission-mode", "auto"]), &map);
        assert_eq!(out, json!({ "permissions": { "defaultMode": "auto" } }));
    }

    #[test]
    fn unknown_flag_is_skipped_without_failure() {
        let map = vec![map_string("--model", "model")];
        let out = build_raw(
            &argv(&["claude", "--unknown-thing", "x", "--model", "opus"]),
            &map,
        );
        // The unknown flag and its value are both passed over. The model
        // mapping still fires.
        assert_eq!(out, json!({ "model": "opus" }));
    }

    #[test]
    fn array_flag_consumes_until_next_flag() {
        let map = vec![map_array("--add-dir", "permissions.additionalDirectories")];
        let out = build_raw(
            &argv(&["claude", "--add-dir", "../apps", "../lib", "--unknown", "x"]),
            &map,
        );
        assert_eq!(
            out,
            json!({ "permissions": { "additionalDirectories": ["../apps", "../lib"] } }),
        );
    }

    #[test]
    fn array_flag_supports_inline_first_value() {
        let map = vec![map_array("--add-dir", "permissions.additionalDirectories")];
        let out = build_raw(&argv(&["claude", "--add-dir=foo", "bar"]), &map);
        assert_eq!(
            out,
            json!({ "permissions": { "additionalDirectories": ["foo", "bar"] } }),
        );
    }

    #[test]
    fn array_flag_repeated_concatenates() {
        // `--add-dir foo --add-dir bar` should yield [foo, bar] rather
        // than the second occurrence overwriting the first.
        let map = vec![map_array("--add-dir", "permissions.additionalDirectories")];
        let out = build_raw(
            &argv(&["claude", "--add-dir", "foo", "--add-dir", "bar"]),
            &map,
        );
        assert_eq!(
            out,
            json!({ "permissions": { "additionalDirectories": ["foo", "bar"] } }),
        );
    }

    #[test]
    fn string_flag_at_end_of_argv_without_value_is_dropped_silently() {
        // `claude --model` with no following value — degenerate input from
        // an exited or malformed process. Don't crash, don't emit a
        // partial entry.
        let map = vec![map_string("--model", "model")];
        let out = build_raw(&argv(&["claude", "--model"]), &map);
        assert_eq!(out, json!({}));
    }

    #[test]
    fn empty_argv_or_no_mapped_flags_produces_empty_object() {
        let map = vec![map_string("--model", "model")];
        assert_eq!(build_raw(&argv(&["claude"]), &map), json!({}));
        assert_eq!(
            build_raw(&argv(&["claude", "--no-mcp"]), &map),
            json!({}),
        );
    }

    #[test]
    fn multiple_unrelated_flags_compose() {
        let map = vec![
            map_string("--model", "model"),
            map_string("--permission-mode", "permissions.defaultMode"),
            map_string("--effort", "effortLevel"),
        ];
        let out = build_raw(
            &argv(&[
                "claude",
                "--model",
                "opus",
                "--permission-mode",
                "plan",
                "--effort",
                "high",
            ]),
            &map,
        );
        assert_eq!(
            out,
            json!({
                "model": "opus",
                "permissions": { "defaultMode": "plan" },
                "effortLevel": "high"
            }),
        );
    }

    #[test]
    fn read_cli_layer_returns_ok_with_synthesized_raw() {
        let layer = read_cli_layer(&argv(&["claude", "--model", "opus"]));
        assert!(matches!(layer.status, LayerStatus::Ok));
        assert_eq!(
            layer.raw.unwrap(),
            json!({ "model": "opus" }),
        );
    }

    #[test]
    fn read_cli_layer_returns_missing_for_empty_argv() {
        // Degenerate input — process gone or unreadable. Better to signal
        // missing than emit an empty Ok layer that the UI would render as
        // a real entry.
        let layer = read_cli_layer(&[]);
        assert!(matches!(layer.status, LayerStatus::Missing));
        assert!(layer.raw.is_none());
    }

    #[test]
    fn mapping_file_parses_and_contains_model() {
        // Compile-time-embedded JSON guard, parallel to env_layer.
        let mappings = load_mappings();
        assert!(!mappings.is_empty());
        assert!(mappings.iter().any(|m| m.flag == "--model"));
        assert!(mappings.iter().any(|m| m.flag == "--add-dir"));
    }
}
