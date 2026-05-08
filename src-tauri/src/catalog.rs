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
const SUB_AGENTS_JSON: &str = include_str!("../../catalog/sub-agents.json");
const MCP_JSON: &str = include_str!("../../catalog/mcp.json");
const PERMISSIONS_JSON: &str = include_str!("../../catalog/permissions.json");
const KEYBINDINGS_JSON: &str = include_str!("../../catalog/keybindings.json");
const CLI_REFERENCE_JSON: &str = include_str!("../../catalog/cli-reference.json");

#[derive(Debug, Serialize)]
pub struct Catalogs {
    /// Parsed `catalog/settings.json` — `{source, schemaId, fetchedAt, count, settings: [...]}`.
    pub settings: Value,
    /// Parsed `catalog/env-vars.json` — `{source, fetchedAt, count, envVars: [...]}`.
    #[serde(rename = "env_vars")]
    pub env_vars: Value,
    /// Parsed `catalog/hooks.json` — `{source, fetchedAt, count, events: [...]}`.
    pub hooks: Value,
    /// Parsed `catalog/sub-agents.json` — `{source, fetchedAt, count, fields: [...]}`.
    #[serde(rename = "sub_agents")]
    pub sub_agents: Value,
    /// Parsed `catalog/mcp.json` — `{source, fetchedAt, count, scopes: [...]}`.
    pub mcp: Value,
    /// Parsed `catalog/permissions.json` — `{source, fetchedAt, count, modes: [...]}`.
    pub permissions: Value,
    /// Parsed `catalog/keybindings.json` — `{source, fetchedAt, count, contexts: [...]}`.
    pub keybindings: Value,
    /// Parsed `catalog/cli-reference.json` — `{source, fetchedAt, commandCount, flagCount, commands: [...], flags: [...]}`.
    #[serde(rename = "cli_reference")]
    pub cli_reference: Value,
}

fn read_catalog_inner() -> Result<Catalogs, String> {
    Ok(Catalogs {
        settings: serde_json::from_str(SETTINGS_JSON)
            .map_err(|e| format!("catalog/settings.json parse: {e}"))?,
        env_vars: serde_json::from_str(ENV_VARS_JSON)
            .map_err(|e| format!("catalog/env-vars.json parse: {e}"))?,
        hooks: serde_json::from_str(HOOKS_JSON)
            .map_err(|e| format!("catalog/hooks.json parse: {e}"))?,
        sub_agents: serde_json::from_str(SUB_AGENTS_JSON)
            .map_err(|e| format!("catalog/sub-agents.json parse: {e}"))?,
        mcp: serde_json::from_str(MCP_JSON)
            .map_err(|e| format!("catalog/mcp.json parse: {e}"))?,
        permissions: serde_json::from_str(PERMISSIONS_JSON)
            .map_err(|e| format!("catalog/permissions.json parse: {e}"))?,
        keybindings: serde_json::from_str(KEYBINDINGS_JSON)
            .map_err(|e| format!("catalog/keybindings.json parse: {e}"))?,
        cli_reference: serde_json::from_str(CLI_REFERENCE_JSON)
            .map_err(|e| format!("catalog/cli-reference.json parse: {e}"))?,
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
    fn sub_agents_catalog_parses_and_has_fields_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.sub_agents.get("fields").and_then(Value::as_array);
        assert!(arr.is_some(), "sub_agents.fields should be an array");
        assert!(!arr.unwrap().is_empty(), "fields array should be non-empty");
    }

    #[test]
    fn sub_agents_catalog_contains_required_anchor_fields() {
        // Guard against a sync regression that drops or renames the two
        // required frontmatter fields. Upstream specifies only `name` and
        // `description` as required; both must be present and marked so.
        let c = read_catalog_inner().unwrap();
        let arr = c.sub_agents.get("fields").unwrap().as_array().unwrap();
        for expected in ["name", "description"] {
            let entry = arr
                .iter()
                .find(|e| e.get("name").and_then(Value::as_str) == Some(expected))
                .unwrap_or_else(|| panic!("sub-agents catalog missing field: {expected}"));
            assert_eq!(
                entry.get("required").and_then(Value::as_bool),
                Some(true),
                "{expected} should be required=true",
            );
        }
    }

    #[test]
    fn mcp_catalog_parses_and_has_scopes_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.mcp.get("scopes").and_then(Value::as_array);
        assert!(arr.is_some(), "mcp.scopes should be an array");
        assert!(!arr.unwrap().is_empty(), "scopes array should be non-empty");
    }

    #[test]
    fn mcp_catalog_contains_three_canonical_scopes() {
        // Guard against a sync regression that drops or renames the scopes
        // upstream documents. Local / Project / User are the precedence-
        // ordered scopes a user-authored MCP server can live at.
        let c = read_catalog_inner().unwrap();
        let arr = c.mcp.get("scopes").unwrap().as_array().unwrap();
        for expected in ["Local", "Project", "User"] {
            assert!(
                arr.iter()
                    .any(|e| e.get("name").and_then(Value::as_str) == Some(expected)),
                "mcp catalog missing scope: {expected}",
            );
        }
    }

    #[test]
    fn permissions_catalog_parses_and_has_modes_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.permissions.get("modes").and_then(Value::as_array);
        assert!(arr.is_some(), "permissions.modes should be an array");
        assert!(!arr.unwrap().is_empty(), "modes array should be non-empty");
    }

    #[test]
    fn permissions_catalog_contains_canonical_modes() {
        // Guard against a sync regression that drops or renames the
        // anchor permission modes. These four are the values most
        // commonly set in `permissions.defaultMode` and are stable
        // identifiers in the upstream schema.
        let c = read_catalog_inner().unwrap();
        let arr = c.permissions.get("modes").unwrap().as_array().unwrap();
        for expected in ["default", "acceptEdits", "plan", "bypassPermissions"] {
            assert!(
                arr.iter()
                    .any(|e| e.get("name").and_then(Value::as_str) == Some(expected)),
                "permissions catalog missing mode: {expected}",
            );
        }
    }

    #[test]
    fn keybindings_catalog_parses_and_has_contexts_array() {
        let c = read_catalog_inner().expect("catalogs parse");
        let arr = c.keybindings.get("contexts").and_then(Value::as_array);
        assert!(arr.is_some(), "keybindings.contexts should be an array");
        assert!(!arr.unwrap().is_empty(), "contexts array should be non-empty");
    }

    #[test]
    fn keybindings_catalog_contains_canonical_contexts() {
        // Guard against a sync regression that drops or renames the
        // anchor binding contexts. `Global` and `Chat` are the most
        // load-bearing — Global covers app-wide actions, Chat is the
        // primary input area.
        let c = read_catalog_inner().unwrap();
        let arr = c.keybindings.get("contexts").unwrap().as_array().unwrap();
        for expected in ["Global", "Chat"] {
            assert!(
                arr.iter()
                    .any(|e| e.get("name").and_then(Value::as_str) == Some(expected)),
                "keybindings catalog missing context: {expected}",
            );
        }
    }

    #[test]
    fn cli_reference_catalog_parses_and_has_both_arrays() {
        let c = read_catalog_inner().expect("catalogs parse");
        let cmds = c.cli_reference.get("commands").and_then(Value::as_array);
        let flags = c.cli_reference.get("flags").and_then(Value::as_array);
        assert!(cmds.is_some(), "cli_reference.commands should be an array");
        assert!(flags.is_some(), "cli_reference.flags should be an array");
        assert!(!cmds.unwrap().is_empty(), "commands array should be non-empty");
        assert!(!flags.unwrap().is_empty(), "flags array should be non-empty");
    }

    #[test]
    fn cli_reference_catalog_contains_canonical_anchors() {
        // Guard against a sync regression that drops the most load-
        // bearing entries. `claude` is the bare command; `--model` and
        // `--permission-mode` are the two flags most directly tied to
        // settings keys (`model`, `permissions.defaultMode`) and would
        // anchor any future "CLI layer via process argv" UI consumer.
        let c = read_catalog_inner().unwrap();
        let cmds = c.cli_reference.get("commands").unwrap().as_array().unwrap();
        let flags = c.cli_reference.get("flags").unwrap().as_array().unwrap();
        assert!(
            cmds.iter()
                .any(|e| e.get("name").and_then(Value::as_str) == Some("claude")),
            "cli_reference.commands missing `claude`",
        );
        for expected in ["--model", "--permission-mode"] {
            assert!(
                flags
                    .iter()
                    .any(|e| e.get("name").and_then(Value::as_str) == Some(expected)),
                "cli_reference.flags missing: {expected}",
            );
        }
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
        assert!(json.get("sub_agents").is_some(), "expected snake_case sub_agents on the wire");
        assert!(
            json.get("cli_reference").is_some(),
            "expected snake_case cli_reference on the wire",
        );
        assert!(json.get("settings").is_some());
        assert!(json.get("hooks").is_some());
        assert!(json.get("mcp").is_some());
        assert!(json.get("permissions").is_some());
        assert!(json.get("keybindings").is_some());
    }
}
