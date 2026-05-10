//! `read_shell_env_vars` — surface the catalog-listed env vars currently
//! set in the user's shell environment.
//!
//! Distinct from the `env` settings layer (Phase 3b, `env_layer.rs`) which
//! folds 8 mapped env vars into the settings precedence merge. This command
//! exists to answer the orthogonal question "what env vars from the
//! 220-entry catalog are live in this process's environment right now?".
//! The frontend joins the result against `settings.json`'s `env` block and
//! the env-vars catalog to produce per-var rows for the EnvVarsPanel.
//!
//! The process env we read is the env knobs.cc itself was launched with,
//! which is *usually* the same env Claude Code would inherit if launched
//! from the same shell — but not always (Finder / Spotlight launches use
//! LaunchServices' env, which can differ). The panel surfaces this caveat
//! in its footnote.

use std::collections::BTreeMap;

const ENV_VARS_JSON: &str = include_str!("../../catalog/env-vars.json");

/// Read the env-vars catalog (compile-time embedded) and pull the names.
/// Returns an error string when the catalog is unparseable, mirroring
/// `read_catalog`'s contract — the caller surfaces it through the existing
/// error UI.
fn catalog_names() -> Result<Vec<String>, String> {
    let v: serde_json::Value = serde_json::from_str(ENV_VARS_JSON)
        .map_err(|e| format!("catalog/env-vars.json parse: {e}"))?;
    let arr = v
        .get("envVars")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "catalog/env-vars.json missing envVars array".to_string())?;
    Ok(arr
        .iter()
        .filter_map(|e| e.get("name").and_then(|n| n.as_str()).map(str::to_string))
        .collect())
}

/// Returns a sorted map of `{name: value}` for catalog-listed env vars
/// that are set in the current process environment. Unset names are
/// omitted — the frontend can list every catalog entry; presence in this
/// map is the "shell-set" signal.
///
/// BTreeMap so the wire output is deterministic (eases test assertions
/// and makes diffs in dev tools meaningful when an env var changes).
#[tauri::command]
pub fn read_shell_env_vars() -> Result<BTreeMap<String, String>, String> {
    let names = catalog_names()?;
    let mut out = BTreeMap::new();
    for name in names {
        if let Ok(v) = std::env::var(&name) {
            out.insert(name, v);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_names_includes_well_known_entries() {
        let names = catalog_names().unwrap();
        // Anchor names that should always be in the upstream catalog.
        // Guards against a sync regression that drops the array shape.
        for expected in ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] {
            assert!(
                names.iter().any(|n| n == expected),
                "catalog missing expected env var: {expected}",
            );
        }
        // 220 entries at time of writing; allow growth/shrinkage but
        // catch a parse that returns near-zero.
        assert!(names.len() > 100, "expected >100 catalog names, got {}", names.len());
    }

    #[test]
    fn read_shell_env_vars_filters_to_catalog() {
        // We can't reliably set arbitrary env vars in a multi-threaded
        // test runner without races. Instead verify the contract: every
        // returned key is in the catalog. The empty case (none set) is
        // valid; the presence of *any* catalog-named var also is.
        let names: std::collections::HashSet<String> =
            catalog_names().unwrap().into_iter().collect();
        let snap = read_shell_env_vars().unwrap();
        for k in snap.keys() {
            assert!(names.contains(k), "returned non-catalog env var: {k}");
        }
    }
}
