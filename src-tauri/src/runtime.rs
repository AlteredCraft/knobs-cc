//! Attach mode: enumerate running `claude` / `claude-code` processes the
//! current user owns, surface each one's cwd, argv, and environ.
//!
//! Closes #11 (runtime introspection: cli + env) and #12 (project paths
//! grounded in a real session). Spec: `spec/attach-mode.md`.
//!
//! Boundaries:
//! - Only processes belonging to the calling UID. Same-UID is the same
//!   trust boundary as `ps -E` / `printenv` in the user's own shell.
//! - Local-host only. Containers / SSH / remote claude are out of scope
//!   for v1; honest empty state on those targets.
//! - Read-only. We never write to the target process.
//!
//! Platform support:
//! - macOS / Linux: full (cwd + argv + environ).
//! - Windows: `sysinfo::Process::environ()` returns empty on Windows; we
//!   report `platform_status: "unsupported"` and produce an empty
//!   process list. PR 2 (or v-next) revisits via `NtQueryInformationProcess`
//!   + `ReadProcessMemory`.

use std::collections::BTreeMap;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// Process names we consider "claude." Matched case-sensitively against
/// `Process::name()`. The CLI ships as `claude` on the official tarball;
/// `claude-code` is the legacy/alternate binary name some distros use.
const CLAUDE_PROCESS_NAMES: &[&str] = &["claude", "claude-code"];

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlatformStatus {
    Ok,
    Unsupported,
    Error,
}

#[derive(Debug, Serialize)]
pub struct ClaudeProcess {
    pub pid: u32,
    /// Seconds since UNIX epoch — the moment exec() ran for this process.
    pub started_at: u64,
    pub cwd: String,
    /// argv as the kernel sees it. argv[0] is the binary path.
    pub argv: Vec<String>,
    /// Full environ. Order is not preserved; duplicate keys collapse.
    /// BTreeMap so the wire output is deterministic for tests / diffing.
    pub environ: BTreeMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct RuntimeSnapshot {
    pub processes: Vec<ClaudeProcess>,
    pub platform_status: PlatformStatus,
    pub error: Option<String>,
}

/// Pure predicate: does this binary name match the set we consider "claude"?
/// Extracted so the filter can be unit-tested without spinning up sysinfo.
fn matches_claude_name(name: &str) -> bool {
    CLAUDE_PROCESS_NAMES.contains(&name)
}

/// Build a `System` populated only with the fields we need (cwd, cmd,
/// environ, user, exe). Cheaper than `System::new_all()` and avoids
/// pulling in CPU/memory/disk refresh cost.
fn build_system() -> System {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_environ(UpdateKind::Always)
            .with_cwd(UpdateKind::Always)
            .with_user(UpdateKind::Always)
            .with_exe(UpdateKind::Always),
    );
    sys
}

/// Read the calling process's UID via sysinfo (avoids a libc dep). Returns
/// `None` if sysinfo can't see the current process — that would imply
/// something unusual about the runtime environment and we treat it as
/// "no inspectable claudes."
fn current_uid(sys: &System) -> Option<sysinfo::Uid> {
    let pid = sysinfo::get_current_pid().ok()?;
    sys.process(pid)?.user_id().cloned()
}

/// Build a `ClaudeProcess` from a sysinfo Process, *assuming* the caller has
/// already confirmed this is a claude. Skips the name filter — used by
/// `process_for_pid` where the pid is supplied by a caller that's already
/// chosen the process. Still enforces same-UID (a hard trust boundary) and
/// drops processes whose cwd/cmd reads failed.
fn process_to_data(
    p: &sysinfo::Process,
    pid: Pid,
    our_uid: &sysinfo::Uid,
) -> Option<ClaudeProcess> {
    if p.user_id() != Some(our_uid) {
        return None;
    }
    let cwd = p.cwd()?.to_string_lossy().into_owned();
    let argv: Vec<String> = p
        .cmd()
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();
    if argv.is_empty() {
        return None;
    }
    let environ: BTreeMap<String, String> = p
        .environ()
        .iter()
        .filter_map(|entry| {
            let s = entry.to_str()?;
            let (k, v) = s.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect();
    Some(ClaudeProcess {
        pid: pid.as_u32(),
        started_at: p.start_time(),
        cwd,
        argv,
        environ,
    })
}

/// Convert a sysinfo `Process` into a `ClaudeProcess` if it qualifies for
/// the discovery list — additionally requires the binary name to match
/// our claude allowlist. Used by `read_snapshot` when enumerating
/// processes; do *not* use to validate a pid the user has already picked.
fn process_to_claude(
    p: &sysinfo::Process,
    pid: Pid,
    our_uid: &sysinfo::Uid,
) -> Option<ClaudeProcess> {
    let name = p.name().to_str()?;
    if !matches_claude_name(name) {
        return None;
    }
    process_to_data(p, pid, our_uid)
}

pub fn read_snapshot() -> RuntimeSnapshot {
    // Windows: `sysinfo::Process::environ()` returns empty. Without environ
    // the attach mode can't ground the env layer, and surfacing argv-only
    // rows would be misleading. Report unsupported and leave the path-picker
    // fallback as the Windows story until #11 Proposal C lands.
    if cfg!(target_os = "windows") {
        return RuntimeSnapshot {
            processes: Vec::new(),
            platform_status: PlatformStatus::Unsupported,
            error: None,
        };
    }

    let sys = build_system();
    let Some(our_uid) = current_uid(&sys) else {
        return RuntimeSnapshot {
            processes: Vec::new(),
            platform_status: PlatformStatus::Error,
            error: Some("could not resolve calling process UID".into()),
        };
    };

    let mut processes: Vec<ClaudeProcess> = sys
        .processes()
        .iter()
        .filter_map(|(pid, p)| process_to_claude(p, *pid, &our_uid))
        .collect();
    // Stable order: started_at ascending, then pid ascending. Keeps the
    // picker UI deterministic across refreshes.
    processes.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.pid.cmp(&b.pid)));

    RuntimeSnapshot {
        processes,
        platform_status: PlatformStatus::Ok,
        error: None,
    }
}

#[tauri::command]
pub fn read_runtime_layer() -> RuntimeSnapshot {
    read_snapshot()
}

/// Look up an attached process by pid and surface the same fields
/// `read_runtime_layer` would have returned for it — cwd, argv, environ,
/// started_at. Used by `read_settings_layers` to ground the project/cli/env
/// layers in one sysinfo pass per snapshot read.
///
/// Returns `None` if the process no longer exists or isn't owned by the
/// calling user. Callers are expected to fall back gracefully (the UI
/// surfaces "session ended").
pub fn process_for_pid(pid: u32) -> Option<ClaudeProcess> {
    if cfg!(target_os = "windows") {
        return None;
    }
    let sys = build_system();
    let our_uid = current_uid(&sys)?;
    let pid_obj = Pid::from_u32(pid);
    // process_to_data — not process_to_claude — because by the time the
    // frontend hands us a pid it's already picked one from the discovery
    // list. The name filter is for discovery, not validation.
    process_to_data(sys.process(pid_obj)?, pid_obj, &our_uid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_claude_name_accepts_known_names() {
        assert!(matches_claude_name("claude"));
        assert!(matches_claude_name("claude-code"));
    }

    #[test]
    fn matches_claude_name_rejects_others() {
        // Case matters: kernel-level Process::name() is exact. We don't
        // case-fold because that would feed "Claude.app"-style matches that
        // aren't the CLI.
        assert!(!matches_claude_name("Claude"));
        assert!(!matches_claude_name("CLAUDE"));
        assert!(!matches_claude_name("claude-helper"));
        assert!(!matches_claude_name("anthropic-claude"));
        assert!(!matches_claude_name("node"));
        assert!(!matches_claude_name(""));
    }

    #[test]
    fn snapshot_has_expected_shape() {
        // We can't reliably assert *which* processes will be visible — the
        // test runner may or may not have a claude session running — but we
        // can assert the contract: on Unix the call returns Ok status and
        // never panics. Every returned process passes our same-UID +
        // claude-name filter.
        let snap = read_snapshot();
        if cfg!(target_os = "windows") {
            assert_eq!(snap.platform_status, PlatformStatus::Unsupported);
            assert!(snap.processes.is_empty());
            return;
        }
        assert!(matches!(
            snap.platform_status,
            PlatformStatus::Ok | PlatformStatus::Error
        ));
        for p in &snap.processes {
            assert!(!p.argv.is_empty(), "argv must not be empty for an attached process");
            assert!(!p.cwd.is_empty(), "cwd must not be empty for an attached process");
        }
    }

    #[test]
    fn snapshot_processes_sorted_by_start_time_then_pid() {
        let snap = read_snapshot();
        let mut prev: Option<(u64, u32)> = None;
        for p in &snap.processes {
            if let Some((pst, ppid)) = prev {
                let cur = (p.started_at, p.pid);
                assert!(
                    cur >= (pst, ppid),
                    "processes out of order: ({pst}, {ppid}) -> ({}, {})",
                    p.started_at,
                    p.pid,
                );
            }
            prev = Some((p.started_at, p.pid));
        }
    }

    #[test]
    fn process_for_pid_returns_none_for_unknown_pid() {
        // Pid 1 belongs to init/launchd; it's not ours, so the same-UID
        // filter rejects it. Returns None.
        assert!(process_for_pid(1).is_none());
    }

    #[test]
    fn process_for_pid_returns_none_for_nonexistent_pid() {
        // Pick a pid that's almost certainly unused. u32::MAX is well above
        // any real pid limit on macOS / Linux.
        assert!(process_for_pid(u32::MAX).is_none());
    }

    #[test]
    fn process_for_pid_returns_data_for_live_owned_process() {
        if cfg!(target_os = "windows") {
            return;
        }
        let p = process_for_pid(std::process::id())
            .expect("our own pid should resolve via sysinfo");
        // argv and cwd should be populated; environ may be large.
        assert!(!p.argv.is_empty());
        assert!(!p.cwd.is_empty());
    }

    #[test]
    fn current_uid_resolves_on_unix() {
        if cfg!(target_os = "windows") {
            return;
        }
        let sys = build_system();
        assert!(
            current_uid(&sys).is_some(),
            "could not resolve our own UID via sysinfo on a Unix host",
        );
    }

    /// Manual diagnostic — print whatever attach mode would surface.
    /// Run with `cargo test --lib runtime::tests::dump_snapshot -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn dump_snapshot() {
        let snap = read_snapshot();
        eprintln!("platform_status: {:?}", snap.platform_status);
        eprintln!("error: {:?}", snap.error);
        eprintln!("processes: {} found", snap.processes.len());
        for p in &snap.processes {
            eprintln!(
                "  pid={} started_at={} environ_keys={} argv={:?}",
                p.pid,
                p.started_at,
                p.environ.len(),
                p.argv,
            );
            eprintln!("    cwd: {}", p.cwd);
        }
    }
}
