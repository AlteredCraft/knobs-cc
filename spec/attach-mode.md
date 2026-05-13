# Attach mode

Pivot spec: ground the Inspector in a real `claude` process the user
selects, rather than in knobs.cc's own current working directory.
Closes the paradoxes described in
[#11](https://github.com/AlteredCraft/knobs-cc/issues/11) (runtime
introspection — `cli` precedence slot + EnvVarsPanel ground truth)
and [#12](https://github.com/AlteredCraft/knobs-cc/issues/12)
(`project` / `project_local` resolved against knobs.cc's launch dir).

This file is the implementation contract for the pivot. Visual
reference and rail/list/drawer conventions stay in
[`inspector-ui.md`](./inspector-ui.md); how the precedence layers
merge stays in [`settings-display.md`](./settings-display.md). This
spec only adds the **attach surface** that those two now front-end
against.

> **Status of attach-mode phases lives in
> [`roadmap.md`](./roadmap.md).** What's shipped vs. pending is
> tracked there.

## Why

Today knobs.cc reads file-based settings layers relative to its own
process CWD, reads the user's shell env from its own process env,
and renders the `cli` precedence row as a permanent empty state.
Each of those is a real product gap:

- `project` / `project_local` reflect whichever directory knobs.cc
  was launched from — not the user's claude session. The rail rows
  are greyed out today as a stopgap (`PrecedenceRail.tsx`, shipped
  2026-05-10).
- The EnvVarsPanel's shell-env column reflects knobs.cc's process
  env, which can differ from the running claude's (Finder/Spotlight
  launches via LaunchServices vs. terminal claude with full shell
  env).
- The `cli` precedence row has no data source — flags passed to
  `claude` (`--model opus`, `--permission-mode auto`, ...) override
  settings layers but can't be observed without reading another
  process's argv.

All three gaps are the same shape: knobs.cc needs to *attach to a
running `claude` process* and read its cwd, argv, and environ. With
those three values, every grounded layer becomes correct.

A separate option ("launch mode" — knobs.cc spawns claude itself) was
considered and rejected for v1: it doesn't help users who launched
claude from a terminal or IDE, which is the dominant workflow. Attach
mode is a *superset* — sessions spawned by knobs.cc would attach the
same way as any other.

## Pivot framing

The product reframes around **grounded inspection**:

- Primary view: the Inspector renders against a *chosen* claude
  session. The rail's `project` / `project_local` rows resolve to
  that session's cwd; the `cli` row populates from its argv; the
  EnvVarsPanel grounds its "shell" column in that session's environ.
- Fallback view: when no claude is detected, the user picks a
  project directory (`#12` proposal 3 — "path picker mode"). The
  Inspector still works but cli/env stay ungrounded.
- The "no session, knobs.cc's CWD as project" behavior is retired.
  That's the paradox; the pivot deletes it.

## Goals

- For any local-host claude the user owns, surface a snapshot of
  its cwd, argv, and environ that the Inspector can ground itself
  against.
- Handle 0 / 1 / many claude processes coherently: 0 → path-picker
  fallback; 1 → auto-attach; many → picker.
- Keep the read-only boundary: attaching reads kernel-visible process
  state, never writes to the target process or anywhere on disk.
- Mask credential-shaped values in the attached environ by default
  (extend the existing EnvVarsPanel mask), with a UI toggle to
  reveal.
- Stay inside the Tauri 2 capability posture: no new JS-side plugin
  permissions beyond what attach mode strictly requires.

## Non-goals (v1)

- **Windows.** `sysinfo::Process::environ()` returns empty on
  Windows; cross-process env reading needs `NtQueryInformationProcess`
  + `ReadProcessMemory` (the PEB-walking path). Deferred per #11.
  Windows users see an "attach mode not available on this platform"
  empty state with the path picker still usable.
- **Containerised / sandboxed claude.** Host knobs.cc can't see into
  a container's PID namespace. Out of scope; honest empty state
  ("no inspectable claude processes").
- **Remote / SSH claude.** `sysinfo` reads local `/proc` and
  `sysctl` only. Headless / remote mode is a separate v-next
  conversation; see "Out of scope" below.
- **Root-owned claude.** Same-UID requirement applies. If a claude
  process is running as root and the user isn't, we don't try to
  read it.
- **Editing the attached claude's state.** Read-only stays the
  v1 boundary. No `kill`, no `setenv` injection, no config writes
  triggered from the attach UI.
- **Polling beyond user-triggered refresh + window-focus.** The
  data we read is frozen at exec time anyway; aggressive polling
  buys nothing.

## Mechanism

Implementation lives in a new `src-tauri/src/runtime.rs` module.
Backed by the [`sysinfo`](https://docs.rs/sysinfo) crate.

### Process discovery

`sysinfo::System::processes()` returns a map of every visible PID.
Filter to processes whose `name()` is `claude` or `claude-code` and
whose `user_id()` matches the calling user. Each surviving entry
becomes a `ClaudeProcess`.

### Per-process reads

For each surviving process:

| Field        | macOS source                              | Linux source                |
|--------------|-------------------------------------------|-----------------------------|
| `cwd`        | `proc_pidinfo` `PROC_PIDVNODEPATHINFO`    | `/proc/<pid>/cwd` symlink   |
| `argv`       | `KERN_PROCARGS2` sysctl                   | `/proc/<pid>/cmdline`       |
| `environ`    | `KERN_PROCARGS2` sysctl (env block)       | `/proc/<pid>/environ`       |
| `started_at` | `proc_pidinfo` `start_time`               | `/proc/<pid>/stat`          |

All of these are wrapped by `sysinfo::Process::{cwd, cmd, environ,
start_time}`. No additional crates or unsafe code required at the
attach-mode layer.

### Tauri command

New command registered alongside the existing handlers:

```rust
#[tauri::command]
fn read_runtime_layer() -> RuntimeSnapshot;
```

Wire shape (snake-case at the IPC boundary, mirroring the existing
`SettingsSnapshot` convention):

```ts
interface RuntimeSnapshot {
  // 0..N processes the user can pick from.
  processes: ClaudeProcess[];
  // The platform's capability status. "ok" on supported Unix; "unsupported"
  // on Windows; "error" if sysinfo itself failed.
  platform_status: "ok" | "unsupported" | "error";
  // Set when platform_status === "error".
  error: string | null;
}

interface ClaudeProcess {
  pid: number;
  // Seconds since UNIX epoch — the moment exec() ran for this process.
  started_at: number;
  cwd: string;
  // Parsed argv (argv[0] = the binary, argv[1..] = flags + prompt).
  argv: string[];
  // Full environ as a flat object. Order is not preserved (rarely matters);
  // duplicate keys collapse to the last occurrence.
  environ: Record<string, string>;
}
```

`read_runtime_layer` does **not** select a process. Selection is a
frontend-side concern: the UI persists the chosen `pid` in app
state, and `read_settings_layers` accepts that pid (or a fallback
path) as input — see "Wiring into existing commands" below.

### Wiring into existing commands

The two existing commands take optional grounding hints so they can
resolve against the chosen session rather than knobs.cc's CWD:

```rust
#[tauri::command]
fn read_settings_layers(
  // The selected attach target. If supplied, the snapshot's
  // project/project_local layers read from this process's cwd.
  attached_pid: Option<u32>,
  // Fallback when no claude is running and the user picked a dir.
  // Mutually exclusive with attached_pid; if both are set,
  // attached_pid wins.
  project_root_override: Option<String>,
) -> SettingsSnapshot;
```

Backwards compatibility: passing neither argument falls back to the
current behavior (read relative to knobs.cc's CWD), so the existing
test suite continues to pass during the migration. Once attach mode
ships, the production UI never calls it that way — the fallback is
retained only for test convenience and an explicit "browse the
catalog cold" view that may land later.

`read_shell_env_vars` follows the same pattern — given an
`attached_pid`, it returns that process's environ projected through
the env-var catalog (so the EnvVarsPanel's "shell" column becomes a
"running claude env" column). The pid-less call still returns
knobs.cc's own process env, used by the path-picker fallback.

### Refresh cadence

- **On user action.** A refresh button in the topbar + the existing
  `R` keybinding (already wired for `read_settings_layers`) call
  both commands.
- **On window-focus.** Tauri's `WindowEvent::Focused(true)` fires
  the same refresh — common UX expectation when the user
  alt-tabs back from a terminal where they just started/stopped
  claude.
- **Not periodic polling.** Process env, argv, and cwd are frozen
  at exec time. The only thing that changes is the set of running
  processes, and the focus-event + manual-refresh combo covers
  that without burning CPU/battery.

When the *attached* process disappears between refreshes (the user
killed claude in their terminal), the snapshot returns it with
`status: "exited"` and the UI surfaces a "session ended" affordance
in the topbar pill — see "UX states" below.

## UX states

The Inspector's topbar grows a new **session pill** that's the
primary attach affordance. It's the analogue of the existing
managed-mcp / errors / diagnostics pills, but persistent (not
conditional on data presence) and load-bearing for the inspector's
ground-truth.

### States

Four states total: three driven by process count, plus a brief
loading state during the initial runtime-snapshot fetch on app
boot.

1. **Loading** (initial fetch only).
   - Pill: `detecting…` with an empty status dot.
   - Renders for the few hundred ms between `App.tsx` mounting and
     `read_runtime_layer` returning. The inspector body shows its
     existing "reading settings…" spinner state during this window;
     the pill picks up its real state on the first successful
     `RuntimeSnapshot`.

2. **Zero claude processes detected.**
   - Pill: `no claude · pick a project ▾`.
   - On open: path-picker fallback CTA — "pick a project directory
     to ground the inspector against, or start a claude session in
     a terminal and we'll pick it up automatically."
   - Inspector renders against the picked path; `cli` and `env`
     rail rows are greyed; project / project_local resolve relative
     to the picker dir.

3. **Exactly one claude process detected.**
   - Auto-attach. Pill: `attached · claude PID 4172 · ~/Projects/foo`.
   - No picker required; the user can still click the pill to see
     the full process list (useful when a second session starts).
   - All rail rows render normally; `cli` populates from argv;
     EnvVarsPanel grounds its shell column in the attached environ.

4. **Two or more claude processes detected.**
   - No auto-attach. Pill: `pick session ▾  (2 running)`.
   - On open: list of detected processes, each row showing pid,
     cwd, started-at, and the first ~3 argv entries. Clicking a row
     attaches; selection persists for the app's lifetime (no disk
     persistence in v1).
   - Inspector renders against the chosen process. Rail rows
     identical to state 3.

Plus an **unsupported** state for Windows (until #11 Proposal C
lands): the pill reads "attach unsupported" with the path picker
still usable; cli + env rail rows stay greyed; project files
resolve against the picked directory.

### Path picker mechanism

Native folder picker via Tauri's `dialog` plugin. **Adds a new
capability** (`dialog:default` + `dialog:allow-open`) — the only
new JS-side capability the pivot needs. The grant is scoped to the
file-picker open primitive only; nothing else.

Justification: dragging or hand-typing a project path is meaningfully
worse UX than a native picker for an action this central to the
new flow, and `dialog:allow-open` is a narrow grant (read-only,
returns a path string — doesn't open or read the file/folder).

Considered alternatives, rejected:
- Plain text input ("paste a path"): no capability change but
  worse ergonomic, especially for users with deep monorepos.
- Drag-and-drop only: discoverable for some users, not for others;
  needs a fallback anyway.
- Tauri's `fs` plugin: huge scope expansion for one read-only
  picker operation. Not worth it.

### Stale / exited session

When the attached pid no longer exists in the next refresh:

- Pill state: `session ended · PID 4172 · re-attach ▾`.
- Inspector renders the *last successful snapshot* in dimmed state
  with a "session ended — re-attach to refresh" banner above the
  list. Better than wiping the view; the user was just looking at
  it.
- Clicking re-attach reopens the picker.

### Privacy: masking + reveal

The existing EnvVarsPanel masks values whose key name matches
`/key|token|secret|password/i` to `•••••••• abcd` (last 4 chars).
That mask extends transparently to the attached environ — same
regex, same affordance, same reveal-on-click.

No explicit "enable runtime introspection" opt-in flow. Rationale:
reading another process's env is a same-UID operation — anything
knobs.cc can read this way, the user can already read with
`ps -E` or `printenv`. The mask-by-default + reveal-toggle pattern
is sufficient privacy hygiene, and aligns with how API-key
dashboards typically present credentials.

## Capability surface impact

| Change                         | Surface              | Notes                                                                                       |
|--------------------------------|----------------------|---------------------------------------------------------------------------------------------|
| `sysinfo` crate dep            | Rust only            | No JS-side cap. Already proposed in #11.                                                    |
| `dialog:default` capability    | JS                   | New grant. Scoped to the open-dialog primitive only.                                        |
| `dialog:allow-open` capability | JS                   | New grant. Returns a path string; does not read files.                                      |
| No `fs` plugin                 | (no change)          | Path reads stay inside `#[tauri::command]` Rust functions.                                  |
| No `shell` / `process` plugin  | (no change)          | We're *reading* another process, not spawning. Launch mode is not v1.                       |
| Tauri builder                  | Rust only            | Register `read_runtime_layer`; add the window-focus listener that fires `runtime-changed`.  |

The "no shell, no process, no dialog, no fs" rule from `CLAUDE.md`
and `design-notes.md` is relaxed in exactly one spot — `dialog` for
the path picker — and the rationale is documented above. No other
plugin grants needed for the pivot.

## What landed

Both halves of the pivot shipped together on `feat/attach-mode`.
Closes #11 and #12.

### Grounding mechanism

- New `runtime.rs` module + `sysinfo` dep.
- New `read_runtime_layer` Tauri command — same-UID claude process
  enumeration with cwd / argv / environ per process. Unit tests
  cover the filter logic; self-attach exercises the live-process
  path.
- `read_settings_layers` accepts `attached_pid` /
  `project_root_override`; `#[tauri::command(rename_all = "snake_case")]`
  is required because Tauri 2 defaults to camelCase for command
  args while the rest of this project's wire format is snake_case.
- Frontend: `SessionPill` topbar UI, three-state picker (0 / 1 /
  2+ claudes), path-picker fallback via the `dialog:allow-open`
  capability grant, `R`-key + window-focus refresh wiring.
- Rail: project / project_local rows un-greyed when grounded;
  fall back to greyed when neither attached nor picked.

### `cli` row + env layer attached + EnvVarsPanel attached column

- New `catalog/cli-settings-map.json` — hand-curated 5 entries
  (`--model`, `--permission-mode`, `--effort`, `--agent`,
  `--add-dir`). Schema: `flag`, `settings` (dotted path), `kind`
  (`string` | `stringArrayMulti`). The `string` kind consumes
  the next argv token (supporting both `--flag value` and
  `--flag=value` forms); `stringArrayMulti` mirrors clap's
  `<arg...>` variadic — consumes tokens until the next
  `-`-prefixed flag.
- `cli_layer.rs` parses argv against the map, emits a synthetic
  settings object as the `cli` LayerRead's `raw`. Unmapped flags
  are skipped silently — claude has many flags this map doesn't
  cover, and erroring on unknown flags would poison the layer.
- `env_layer.rs` grows `read_env_layer_attached(environ)` —
  same parser as `read_env_layer()`, but reads the attached
  claude's environ instead of knobs.cc's own. `settings.rs::read_snapshot`
  routes between the two based on attach state.
- EnvVarsPanel: new `attached` column (green badge) alongside
  `shell`. Per-row `Δ` badge when attached and shell values
  disagree. Two new filter chips: `attached` and `Δ diff`.
  Mask + reveal extended to the new column.

### Notable refinement during smoke

The `MERGED` chip on array-merged paths originally fired whenever
the backend emitted `elements`, even when only one layer
contributed. That misleads users into thinking single-source
arrays are multi-sourced. Refined: when an array-merge path has
only one contributor, the row downgrades to `state: "set"` with
that layer as `winner`. `elements` stays populated so the drawer's
per-element list still renders. The `MERGED` chip only fires for
genuine multi-source merges.

## Out of scope (v-next conversations)

These are real product surfaces that the pivot exposes but doesn't
solve:

- **Headless / CLI / server mode.** Inspecting claude inside a
  Docker container, on an SSH-mounted server, or in a CI runner
  requires knobs.cc-the-Tauri-desktop-app to grow a sibling
  knobs.cc-the-data-collector binary that runs in those contexts
  and feeds a remote frontend. Real architectural shift; v-next.
- **Persistent attach across sessions.** When the attached claude
  exits and the user starts a new one with the same cwd, should
  knobs.cc auto-reattach? Probably yes, but the policy
  ("same cwd? same argv? same parent shell?") needs design.
- **Multi-claude diff view.** When N claudes are running, the
  picker shows them but doesn't let the user compare. Probably
  worth a dedicated "compare sessions" surface eventually.
- **Recording snapshots for debug reports.** "Export this snapshot
  as JSON" is a natural extension once the snapshot is grounded
  in a real session. Out of scope; doesn't change the data model.

## Open questions (still open)

- **Picker UI shape if metadata grows.** Topbar dropdown handles
  the 2-3-process case fine. If process metadata grows (live
  status, last-message timestamp, token usage), the dropdown may
  feel cramped — revisit as a modal or cmd+K quick-switcher then.
- **Persistence of the selected project root.** Currently
  app-lifetime only (the pid is rightly transient; the path
  picker resets on each launch when no claude is running). A
  small `~/.config/knobs.cc/state.json` for "remember the last
  picked directory" is a v-next decision — flag if users start
  asking.
- **Watcher target.** `notify`-based file watcher in `watcher.rs`
  still watches `cwd/.claude`, not the attached / picked project
  dir. Manual refresh + window-focus cover it; dynamic rebinding
  is a focused follow-up if file edits to the attached project
  feel laggy in practice.

## Related

- [#11](https://github.com/AlteredCraft/knobs-cc/issues/11) — runtime
  introspection (argv + env). Closed.
- [#12](https://github.com/AlteredCraft/knobs-cc/issues/12) — project
  paths grounded in a real session. Closed.
- [`settings-display.md`](./settings-display.md) — precedence merge
  semantics. Unchanged; this spec adds the *grounding input* the
  merge runs against.
- [`inspector-ui.md`](./inspector-ui.md) — rail/list/drawer layout.
  This spec adds the session pill; otherwise no UI shape changes.
- [`design-notes.md`](./design-notes.md) "Tauri 2 boundaries" —
  amended by the `dialog:allow-open` grant for the path picker.
