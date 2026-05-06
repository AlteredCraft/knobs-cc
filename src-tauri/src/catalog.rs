//! Catalog data — the upstream-derived reference for what every Claude
//! Code knob is, what it accepts, and what it defaults to.
//!
//! Catalog files are produced by `scripts/sync-*.js` and committed under
//! `catalog/`. We `include_str!` them at compile time so the binary owns
//! the data; the frontend reads them via the `read_catalog` Tauri command
//! rather than statically importing JSON. That keeps the catalog under
//! one set of eyes (Rust) and unblocks future cross-cutting use (e.g.
//! `$ref` resolution, settings ↔ env-var cross-refs) without bundling
//! reference data into the JS bundle.

use serde::Serialize;
use serde_json::Value;

const SETTINGS_JSON: &str = include_str!("../../catalog/settings.json");
const ENV_VARS_JSON: &str = include_str!("../../catalog/env-vars.json");
const HOOKS_JSON: &str = include_str!("../../catalog/hooks.json");

#[derive(Debug, Serialize)]
pub struct Catalogs {
    /// Parsed `catalog/settings.json` — `{source, schemaId, fetchedAt, count, settings: [...]}`.
    pub settings: Value,
    /// Parsed `catalog/env-vars.json` — `{source, fetchedAt, count, envVars: [...]}`.
    #[serde(rename = "env_vars")]
    pub env_vars: Value,
    /// Parsed `catalog/hooks.json` — `{source, fetchedAt, count, events: [...]}`.
    pub hooks: Value,
}

fn read_catalog_inner() -> Result<Catalogs, String> {
    Ok(Catalogs {
        settings: serde_json::from_str(SETTINGS_JSON)
            .map_err(|e| format!("catalog/settings.json parse: {e}"))?,
        env_vars: serde_json::from_str(ENV_VARS_JSON)
            .map_err(|e| format!("catalog/env-vars.json parse: {e}"))?,
        hooks: serde_json::from_str(HOOKS_JSON)
            .map_err(|e| format!("catalog/hooks.json parse: {e}"))?,
    })
}

#[tauri::command]
pub fn read_catalog() -> Result<Catalogs, String> {
    read_catalog_inner()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_catalog_parses_and_has_settings_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.settings.get("settings").and_then(Value::as_array);
        assert!(arr.is_some(), "settings.settings should be an array");
        assert!(!arr.unwrap().is_empty(), "settings array should be non-empty");
    }

    #[test]
    fn env_vars_catalog_parses_and_has_env_vars_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.env_vars.get("envVars").and_then(Value::as_array);
        assert!(arr.is_some(), "env_vars.envVars should be an array");
        assert!(!arr.unwrap().is_empty(), "envVars array should be non-empty");
    }

    #[test]
    fn hooks_catalog_parses_and_has_events_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.hooks.get("events").and_then(Value::as_array);
        assert!(arr.is_some(), "hooks.events should be an array");
        assert!(!arr.unwrap().is_empty(), "events array should be non-empty");
    }

    #[test]
    fn settings_entries_have_a_key_field() {
        // Spot-check that the catalog entry shape we rely on is intact —
        // `key` is the field rows.ts joins on.
        let c = read_catalog_inner().unwrap();
        let arr = c.settings.get("settings").unwrap().as_array().unwrap();
        let with_key = arr.iter().filter(|e| e.get("key").is_some()).count();
        assert_eq!(
            with_key,
            arr.len(),
            "every settings entry should have a `key` field",
        );
    }

    #[test]
    fn settings_catalog_contains_well_known_keys() {
        // Guard against a sync regression that drops or renames anchor keys.
        let c = read_catalog_inner().unwrap();
        let arr = c.settings.get("settings").unwrap().as_array().unwrap();
        for expected in ["model", "permissions"] {
            assert!(
                arr.iter().any(|e| e.get("key").and_then(Value::as_str) == Some(expected)),
                "settings catalog missing expected key: {expected}",
            );
        }
    }

    #[test]
    fn serializes_with_snake_case_env_vars_field() {
        // Wire shape contract — frontend reads `c.env_vars`, not `envVars`.
        let c = read_catalog_inner().unwrap();
        let json = serde_json::to_value(&c).unwrap();
        assert!(json.get("env_vars").is_some(), "expected snake_case env_vars on the wire");
        assert!(json.get("settings").is_some());
        assert!(json.get("hooks").is_some());
    }
}
