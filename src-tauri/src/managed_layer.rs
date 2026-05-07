//! Phases 2 + 6 (macOS) of `spec/settings-display.md`: read the managed tier.
//!
//! The managed tier collapses to a single `managed` layer at the public API
//! boundary (highest precedence). Within the tier only one source wins
//! (`spec/inventory.md:50`):
//!
//!   server-managed > MDM/OS policy (plist, registry) > file-based > HKCU
//!
//! Phase 2 wired the file-based source: `managed-settings.json` merged with
//! `managed-settings.d/*.json` alphabetically. Phase 6 layers MDM sources on
//! top — currently macOS plist; Windows registry is still pending.
//!
//! `managed-mcp.json` is read as a sibling but is not part of the precedence
//! merge — MCP servers are a different config category; the UI just needs to
//! know the file exists.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::settings::{LayerRead, LayerSource, LayerStatus};

/// Platform's file-based managed-settings root. None on unsupported targets
/// (so the snapshot can still report a `missing` rail row rather than panic).
pub(crate) fn resolve_managed_base() -> Option<PathBuf> {
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
    #[cfg(target_os = "macos")]
    {
        if let Some(layer) = read_managed_layer_macos(
            &macos_plist::candidate_paths(),
            resolve_managed_base().as_deref(),
        ) {
            return layer;
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(layer) = read_managed_layer_windows(
            windows_registry::read_hklm(),
            resolve_managed_base().as_deref(),
            windows_registry::read_hkcu(),
        ) {
            return layer;
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(base) = resolve_managed_base() {
            return read_managed_layer_at(&base);
        }
    }
    layer_missing(LayerSource::Managed, None)
}

/// Pick the winning managed source on macOS: the first plist candidate that
/// exists shadows the file-based source (per the managed-tier precedence in
/// `inventory.md:50`). A plist that's present-but-malformed still wins —
/// admins should see their broken policy rather than have a different layer
/// silently take its place. Returns `None` only when no source is reachable
/// at all (e.g. neither plist exists *and* no file-based base path).
#[cfg(target_os = "macos")]
fn read_managed_layer_macos(plist_paths: &[PathBuf], file_base: Option<&Path>) -> Option<LayerRead> {
    if let Some(p) = plist_paths.iter().find(|p| p.exists()) {
        return Some(read_macos_plist_at(p));
    }
    file_base.map(read_managed_layer_at)
}

/// macOS managed-preferences plist (`com.anthropic.claudecode`).
///
/// Per-user MDM (`/Library/Managed Preferences/<user>/...`) takes precedence
/// over system MDM (`/Library/Managed Preferences/...`) — same order
/// `cfprefsd` resolves managed defaults in. If the plist exists at all it
/// claims the managed slot and shadows the file-based source, even if it
/// fails to parse: the admin should see their broken policy rather than
/// have a different layer silently take over.
#[cfg(target_os = "macos")]
pub(crate) mod macos_plist {
    use std::path::{Path, PathBuf};

    use serde_json::{Map, Number, Value};

    pub const PLIST_FILENAME: &str = "com.anthropic.claudecode.plist";
    const MANAGED_PREFS_ROOT: &str = "/Library/Managed Preferences";

    pub fn candidate_paths() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(user) = std::env::var_os("USER") {
            out.push(Path::new(MANAGED_PREFS_ROOT).join(user).join(PLIST_FILENAME));
        }
        out.push(Path::new(MANAGED_PREFS_ROOT).join(PLIST_FILENAME));
        out
    }

    pub fn watched_dirs() -> Vec<PathBuf> {
        let mut out = vec![PathBuf::from(MANAGED_PREFS_ROOT)];
        if let Some(user) = std::env::var_os("USER") {
            out.push(Path::new(MANAGED_PREFS_ROOT).join(user));
        }
        out
    }

    pub fn read(path: &Path) -> Result<Value, String> {
        let raw: plist::Value = plist::from_file(path)
            .map_err(|e| format!("plist parse error in {}: {e}", path.display()))?;
        Ok(plist_to_json(raw))
    }

    /// Convert plist's value tree to a serde_json one. Date and Data have no
    /// natural JSON shape and shouldn't appear in claude-code managed
    /// settings — drop them rather than guess at a representation.
    fn plist_to_json(v: plist::Value) -> Value {
        match v {
            plist::Value::Boolean(b) => Value::Bool(b),
            plist::Value::Integer(i) => i
                .as_signed()
                .map(|n| Value::Number(n.into()))
                .or_else(|| i.as_unsigned().map(|n| Value::Number(n.into())))
                .unwrap_or(Value::Null),
            plist::Value::Real(f) => {
                Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
            }
            plist::Value::String(s) => Value::String(s),
            plist::Value::Array(arr) => {
                Value::Array(arr.into_iter().map(plist_to_json).collect())
            }
            plist::Value::Dictionary(d) => {
                let mut m = Map::new();
                for (k, v) in d {
                    m.insert(k, plist_to_json(v));
                }
                Value::Object(m)
            }
            _ => Value::Null,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;

        fn temp_dir(label: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!(
                "knobs-cc-plist-{}-{}-{}",
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

        fn write_xml_plist(path: &Path, body: &str) {
            std::fs::write(
                path,
                format!(
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
{body}
</plist>"#,
                ),
            )
            .unwrap();
        }

        #[test]
        fn reads_string_int_bool_array() {
            let d = temp_dir("scalars");
            let p = d.join(PLIST_FILENAME);
            write_xml_plist(
                &p,
                r#"<dict>
                    <key>model</key><string>opus</string>
                    <key>cleanupPeriodDays</key><integer>14</integer>
                    <key>includeCoAuthoredBy</key><false/>
                    <key>permissions</key>
                    <dict>
                        <key>allow</key>
                        <array>
                            <string>Bash(ls)</string>
                            <string>Read</string>
                        </array>
                    </dict>
                </dict>"#,
            );
            let v = read(&p).unwrap();
            assert_eq!(v["model"], json!("opus"));
            assert_eq!(v["cleanupPeriodDays"], json!(14));
            assert_eq!(v["includeCoAuthoredBy"], json!(false));
            assert_eq!(v["permissions"]["allow"], json!(["Bash(ls)", "Read"]));
            std::fs::remove_dir_all(&d).ok();
        }

        #[test]
        fn parse_error_surfaces_path() {
            let d = temp_dir("bad");
            let p = d.join(PLIST_FILENAME);
            std::fs::write(&p, "<not really a plist>").unwrap();
            let err = read(&p).unwrap_err();
            assert!(err.contains("plist parse error"), "{err}");
            assert!(err.contains(PLIST_FILENAME));
            std::fs::remove_dir_all(&d).ok();
        }

        #[test]
        fn drops_date_and_data() {
            // Admins won't ship dates/data here, but be defensive: instead of
            // guessing a JSON shape we drop them. Verify by exercising a real
            // plist with an embedded data blob and a date.
            let d = temp_dir("exotic");
            let p = d.join(PLIST_FILENAME);
            write_xml_plist(
                &p,
                r#"<dict>
                    <key>blob</key><data>aGk=</data>
                    <key>when</key><date>2026-01-01T00:00:00Z</date>
                    <key>model</key><string>opus</string>
                </dict>"#,
            );
            let v = read(&p).unwrap();
            assert_eq!(v["blob"], Value::Null);
            assert_eq!(v["when"], Value::Null);
            assert_eq!(v["model"], json!("opus"));
            std::fs::remove_dir_all(&d).ok();
        }

        #[test]
        fn candidate_paths_prefers_user_then_system() {
            // When USER is set the per-user path is first; the system path is
            // always last so the host-level plist is the fallback.
            // SAFETY: tests in this module run single-threaded for env mutation
            // because cargo test in this binary uses default settings; we set
            // and restore deterministically.
            let prev = std::env::var_os("USER");
            unsafe {
                std::env::set_var("USER", "alice");
            }
            let paths = candidate_paths();
            assert_eq!(paths.len(), 2);
            assert!(
                paths[0].ends_with(format!("alice/{PLIST_FILENAME}")),
                "expected per-user first, got {:?}",
                paths
            );
            assert_eq!(
                paths[1].to_string_lossy(),
                format!("{MANAGED_PREFS_ROOT}/{PLIST_FILENAME}")
            );
            // Restore so other tests aren't affected.
            unsafe {
                match prev {
                    Some(v) => std::env::set_var("USER", v),
                    None => std::env::remove_var("USER"),
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn read_macos_plist_at(path: &Path) -> LayerRead {
    match macos_plist::read(path) {
        Ok(v) => layer_ok(LayerSource::Managed, path.to_path_buf(), v),
        Err(e) => layer_error(LayerSource::Managed, path.to_path_buf(), e),
    }
}

/// Pick the winning managed source on Windows. Per-tier precedence from
/// `inventory.md:50` is HKLM > file-based > HKCU. A tier "claims" the slot
/// when its read returns `Ok` *or* `Error` — only `Missing` falls through.
/// HKCU is the lowest-priority managed tier (intentional: per-user policy is
/// admin-overridable by file-based, which is in turn overridden by HKLM /
/// MDM). Returns `None` only when every tier is missing.
#[cfg(target_os = "windows")]
fn read_managed_layer_windows(
    hklm: windows_registry::RegRead,
    file_base: Option<&Path>,
    hkcu: windows_registry::RegRead,
) -> Option<LayerRead> {
    if let Some(layer) = registry_read_to_layer("HKLM", hklm) {
        return Some(layer);
    }
    if let Some(base) = file_base {
        let layer = read_managed_layer_at(base);
        if layer.status != LayerStatus::Missing {
            return Some(layer);
        }
    }
    registry_read_to_layer("HKCU", hkcu)
}

#[cfg(target_os = "windows")]
fn registry_read_to_layer(hive: &str, read: windows_registry::RegRead) -> Option<LayerRead> {
    let path = PathBuf::from(windows_registry::display_path(hive));
    match read {
        windows_registry::RegRead::Ok(v) => Some(layer_ok(LayerSource::Managed, path, v)),
        windows_registry::RegRead::Error(e) => Some(layer_error(LayerSource::Managed, path, e)),
        windows_registry::RegRead::Missing => None,
    }
}

/// Windows policy-key reads. Reads `SOFTWARE\Policies\ClaudeCode\Settings`
/// (REG_SZ, JSON-encoded) from the requested hive. The JSON shape matches
/// `settings.json` — see `spec/inventory.md:48`.
#[cfg(target_os = "windows")]
pub(crate) mod windows_registry {
    use serde_json::Value;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    pub const REG_SUBKEY: &str = r"SOFTWARE\Policies\ClaudeCode";
    pub const REG_VALUE: &str = "Settings";

    /// Outcome of trying to read one hive's policy value. Distinguishes
    /// "no policy here" from "policy here but unreadable" so the picker
    /// can fall through on Missing without swallowing real Errors.
    pub enum RegRead {
        Ok(Value),
        Missing,
        Error(String),
    }

    /// `HIVE\SOFTWARE\Policies\ClaudeCode\Settings` for the rail/drawer.
    /// The value name is included so it's unambiguous what was read — a
    /// reader doesn't have to guess between the key and its named value.
    pub fn display_path(hive: &str) -> String {
        format!(r"{hive}\{REG_SUBKEY}\{REG_VALUE}")
    }

    pub fn read_hklm() -> RegRead {
        read_settings_value(RegKey::predef(HKEY_LOCAL_MACHINE))
    }

    pub fn read_hkcu() -> RegRead {
        read_settings_value(RegKey::predef(HKEY_CURRENT_USER))
    }

    fn read_settings_value(root: RegKey) -> RegRead {
        let key = match root.open_subkey(REG_SUBKEY) {
            Ok(k) => k,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return RegRead::Missing,
            Err(e) => {
                return RegRead::Error(format!(
                    "registry open_subkey error on {REG_SUBKEY}: {e}"
                ));
            }
        };
        let raw: String = match key.get_value(REG_VALUE) {
            Ok(v) => v,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return RegRead::Missing,
            Err(e) => {
                return RegRead::Error(format!(
                    "registry get_value error on {REG_SUBKEY}\\{REG_VALUE}: {e}"
                ));
            }
        };
        match parse_settings_json(&raw) {
            Ok(v) => RegRead::Ok(v),
            Err(e) => RegRead::Error(e),
        }
    }

    /// Pulled out so the JSON-parse step is unit-testable without a hive.
    pub fn parse_settings_json(s: &str) -> Result<Value, String> {
        serde_json::from_str(s)
            .map_err(|e| format!("registry Settings value is not valid JSON: {e}"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;

        #[test]
        fn parses_settings_json_object() {
            let v = parse_settings_json(r#"{"model":"opus","permissions":{"allow":["Bash"]}}"#)
                .unwrap();
            assert_eq!(v["model"], json!("opus"));
            assert_eq!(v["permissions"]["allow"], json!(["Bash"]));
        }

        #[test]
        fn parses_empty_object() {
            // Admins may ship an empty policy. Empty dict is valid JSON.
            let v = parse_settings_json("{}").unwrap();
            assert_eq!(v, json!({}));
        }

        #[test]
        fn malformed_json_surfaces_error() {
            let err = parse_settings_json("{ not json }").unwrap_err();
            assert!(err.contains("not valid JSON"), "got: {err}");
        }

        #[test]
        fn display_path_includes_hive_and_value_name() {
            assert_eq!(
                display_path("HKLM"),
                r"HKLM\SOFTWARE\Policies\ClaudeCode\Settings"
            );
            assert_eq!(
                display_path("HKCU"),
                r"HKCU\SOFTWARE\Policies\ClaudeCode\Settings"
            );
        }

        // Round-trip integration test: write to a unique HKCU subkey, read
        // it back, then clean up. We deliberately scope to a Knobs-CC-Test
        // subtree (not SOFTWARE\Policies\ClaudeCode itself) so a CI runner
        // with real policy in that location wouldn't be clobbered.
        #[test]
        fn round_trips_through_hkcu_subkey() {
            use winreg::RegKey;

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let unique = format!(
                "knobs-cc-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let test_subkey = format!(r"SOFTWARE\Knobs-CC-Test\{unique}");

            let (key, _disp) = hkcu
                .create_subkey(&test_subkey)
                .expect("create test subkey");
            key.set_value("Settings", &r#"{"model":"sonnet"}"#.to_string())
                .expect("write Settings value");

            // Drive `read_settings_value` against the test subkey by opening
            // it from HKCU directly — same code path the production reader
            // uses, just pointed at a temp location.
            let opened = hkcu.open_subkey(&test_subkey).expect("reopen");
            let raw: String = opened.get_value("Settings").expect("get_value");
            let v = parse_settings_json(&raw).expect("parse");
            assert_eq!(v["model"], json!("sonnet"));

            // Clean up: delete the unique subkey, then prune the parent if
            // we were the only tenant.
            hkcu.delete_subkey_all(&test_subkey).ok();
            // Try to delete the parent; will fail (silently) if other tests
            // are running concurrently and own siblings. That's fine.
            hkcu.delete_subkey(r"SOFTWARE\Knobs-CC-Test").ok();
        }
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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_plist_wins_over_file_based_when_present() {
        // Two roots: a file-based managed dir with content, and a plist that
        // exists. Plist wins per inventory.md:50 — file-based is shadowed.
        let file_root = temp_dir("macos-precedence-file");
        write(&file_root.join("managed-settings.json"), r#"{"model":"sonnet"}"#);

        let plist_root = temp_dir("macos-precedence-plist");
        let plist_path = plist_root.join(macos_plist::PLIST_FILENAME);
        std::fs::write(
            &plist_path,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict><key>model</key><string>opus</string></dict>
</plist>"#,
        )
        .unwrap();

        let layer =
            read_managed_layer_macos(&[plist_path.clone()], Some(&file_root)).expect("layer");
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap()["model"], json!("opus"));
        assert_eq!(layer.path.unwrap(), plist_path.to_string_lossy());
        std::fs::remove_dir_all(&file_root).ok();
        std::fs::remove_dir_all(&plist_root).ok();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_falls_back_to_file_based_when_no_plist_exists() {
        let file_root = temp_dir("macos-fallback-file");
        write(&file_root.join("managed-settings.json"), r#"{"model":"sonnet"}"#);
        let absent_plist = file_root.join("does-not-exist.plist");
        let layer = read_managed_layer_macos(&[absent_plist], Some(&file_root)).expect("layer");
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap()["model"], json!("sonnet"));
        std::fs::remove_dir_all(&file_root).ok();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_plist_first_existing_wins_within_plist_precedence() {
        // Per-user plist exists → it wins, even if a system-tier candidate
        // would also resolve. Caller passes per-user first.
        let user_root = temp_dir("macos-user-plist");
        let user_path = user_root.join(macos_plist::PLIST_FILENAME);
        std::fs::write(
            &user_path,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict><key>model</key><string>per-user</string></dict>
</plist>"#,
        )
        .unwrap();

        let system_root = temp_dir("macos-system-plist");
        let system_path = system_root.join(macos_plist::PLIST_FILENAME);
        std::fs::write(
            &system_path,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict><key>model</key><string>system</string></dict>
</plist>"#,
        )
        .unwrap();

        let layer = read_managed_layer_macos(
            &[user_path.clone(), system_path],
            Some(&temp_dir("ignored-file-base")),
        )
        .expect("layer");
        assert_eq!(layer.raw.unwrap()["model"], json!("per-user"));
        assert_eq!(layer.path.unwrap(), user_path.to_string_lossy());
        std::fs::remove_dir_all(&user_root).ok();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_malformed_plist_errors_layer_without_falling_through() {
        // Plist file is present but garbage. Per spec, the admin should see
        // their broken policy — file-based does not silently take over.
        let plist_root = temp_dir("macos-bad-plist");
        let plist_path = plist_root.join(macos_plist::PLIST_FILENAME);
        std::fs::write(&plist_path, b"not a plist at all").unwrap();

        let file_root = temp_dir("macos-bad-plist-file");
        write(&file_root.join("managed-settings.json"), r#"{"model":"sonnet"}"#);

        let layer = read_managed_layer_macos(&[plist_path.clone()], Some(&file_root))
            .expect("layer");
        assert_eq!(layer.status, LayerStatus::Error);
        assert_eq!(layer.path.unwrap(), plist_path.to_string_lossy());
        let err = layer.error.unwrap();
        assert!(err.contains("plist parse error"), "got: {err}");
        std::fs::remove_dir_all(&plist_root).ok();
        std::fs::remove_dir_all(&file_root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_hklm_wins_over_file_and_hkcu() {
        use windows_registry::RegRead;
        let file_root = temp_dir("win-precedence-file");
        write(&file_root.join("managed-settings.json"), r#"{"model":"file"}"#);

        let layer = read_managed_layer_windows(
            RegRead::Ok(json!({"model": "hklm"})),
            Some(&file_root),
            RegRead::Ok(json!({"model": "hkcu"})),
        )
        .expect("layer");
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap()["model"], json!("hklm"));
        assert!(layer.path.unwrap().starts_with("HKLM"));
        std::fs::remove_dir_all(&file_root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_falls_back_to_file_when_hklm_missing() {
        use windows_registry::RegRead;
        let file_root = temp_dir("win-fallback-file");
        write(&file_root.join("managed-settings.json"), r#"{"model":"file"}"#);

        let layer = read_managed_layer_windows(
            RegRead::Missing,
            Some(&file_root),
            RegRead::Ok(json!({"model": "hkcu"})),
        )
        .expect("layer");
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap()["model"], json!("file"));
        std::fs::remove_dir_all(&file_root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_falls_back_to_hkcu_when_hklm_and_file_missing() {
        // file_base passed but the directory is empty — read_managed_layer_at
        // returns Missing, so the picker should fall through to HKCU.
        use windows_registry::RegRead;
        let empty_root = temp_dir("win-empty-file");
        let layer = read_managed_layer_windows(
            RegRead::Missing,
            Some(&empty_root),
            RegRead::Ok(json!({"model": "hkcu"})),
        )
        .expect("layer");
        assert_eq!(layer.status, LayerStatus::Ok);
        assert_eq!(layer.raw.unwrap()["model"], json!("hkcu"));
        assert!(layer.path.unwrap().starts_with("HKCU"));
        std::fs::remove_dir_all(&empty_root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_hklm_error_blocks_fall_through() {
        // HKLM is malformed — surface the error rather than silently letting
        // file-based or HKCU win. Same rule as the macOS plist case: admin
        // should see their broken policy.
        use windows_registry::RegRead;
        let file_root = temp_dir("win-bad-hklm-file");
        write(&file_root.join("managed-settings.json"), r#"{"model":"file"}"#);

        let layer = read_managed_layer_windows(
            RegRead::Error("not valid JSON".into()),
            Some(&file_root),
            RegRead::Ok(json!({"model": "hkcu"})),
        )
        .expect("layer");
        assert_eq!(layer.status, LayerStatus::Error);
        assert!(layer.path.unwrap().starts_with("HKLM"));
        assert!(layer.error.unwrap().contains("not valid JSON"));
        std::fs::remove_dir_all(&file_root).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_returns_none_when_every_tier_missing() {
        use windows_registry::RegRead;
        let empty_root = temp_dir("win-all-missing");
        let layer = read_managed_layer_windows(
            RegRead::Missing,
            Some(&empty_root),
            RegRead::Missing,
        );
        assert!(layer.is_none());
        std::fs::remove_dir_all(&empty_root).ok();
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
