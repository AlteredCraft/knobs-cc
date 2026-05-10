# Settings display

This spec describes how knobs.cc determines a user's effective Claude Code
settings and renders them in the UI alongside their provenance ("where this
value was set"). v1 is read-only; nothing in this spec writes back.

The spec is a phased plan. Phase 1 is the only one being implemented now;
later phases describe scope, not commitments.

> **Status of open phases lives in [`roadmap.md`](./roadmap.md).** The phase
> sections below stay as design references; what's shipped vs. pending is
> tracked there.

## Goals

- For every setting Claude Code might read, show the **effective value** the
  user's session would see, plus the **layer** that produced it.
- Make "which layer wins, and why" debuggable without reading docs — the
  precedence chain in `inventory.md:55` should be legible from the UI.
- Stay inside the Tauri 2 read-only boundary: explicit `#[tauri::command]`
  reads, no fs/shell/dialog plugin permissions, no write commands.

## Non-goals (v1)

- Editing settings.
- Reading settings of an *active* `claude` session (CLI flags passed to a
  running process, in particular).
- Reasoning about plugin/skill/agent frontmatter as a settings source.

## Layers (highest precedence first)

Per `spec/inventory.md:55`, plus env vars folded in:

| # | Layer                  | Source                                                            | Phase |
|---|------------------------|-------------------------------------------------------------------|-------|
| 1 | `managed`              | Server-managed > MDM (plist/registry) > file-based > HKCU         | 2 / 6 |
| 2 | `cli`                  | Flags passed to `claude` (out of v1 scope — not inspectable)      | —     |
| 3 | `env`                  | Process env + dotenv files Claude Code reads                      | 3     |
| 4 | `project_local`        | `<project>/.claude/settings.local.json`                           | 1     |
| 5 | `project`              | `<project>/.claude/settings.json`                                 | 1     |
| 6 | `user`                 | `~/.claude/settings.json`                                         | 1     |
| 7 | `default`              | Claude Code's compiled-in defaults (catalog-derived)              | 5     |

CLI flags are listed for completeness but cannot be inspected from a separate
process. The UI should display the slot with an explanatory empty state.

## Merge semantics

- **Scalars and objects:** last-wins by precedence (highest layer present).
- **Array-merged fields:** concatenated and de-duplicated *across all layers*,
  not replaced. Inventory calls this out in `inventory.md:58`. Known
  array-merged fields include `permissions.allow`, `permissions.ask`,
  `permissions.deny`, `permissions.additionalDirectories`,
  `sandbox.filesystem.allowWrite`, and similar list-shaped permission fields.
  For these, **each element carries its own provenance**; the field as a whole
  has no single source.
- **Managed-tier internal merge:** within the managed tier, only one source
  applies (`inventory.md:50`); but file-based managed tier merges
  `managed-settings.json` with `managed-settings.d/*.json` alphabetically.
  This is collapsed into a single `managed` layer at the public API boundary.

## Data shape (target)

A single Tauri command returns one snapshot. The shape is stable across
phases — later phases populate more fields but don't reshape existing ones.

```ts
type LayerSource =
  | "managed" | "cli" | "env"
  | "project_local" | "project" | "user"
  | "default";

interface LayerRead {
  source: LayerSource;
  // Absolute path that was read. Null for env/cli/default.
  path: string | null;
  // "ok" if parsed; "missing" if file absent; "error" if present but unreadable.
  status: "ok" | "missing" | "error";
  // Parsed JSON, or null if missing/error.
  raw: unknown | null;
  // Set when status === "error".
  error: string | null;
}

interface ProvenancedValue {
  // The effective value at this leaf.
  value: unknown;
  // Single source for scalars/objects. For array-merged fields, null at the
  // field level; each element has its own source in `elements`.
  source: LayerSource | null;
  // Only set for array-merged fields.
  elements?: { value: unknown; source: LayerSource }[];
}

interface SettingsSnapshot {
  // Each layer that was attempted, in precedence order (highest first).
  layers: LayerRead[];
  // Effective tree, leaves replaced with ProvenancedValue.
  effective: Record<string, unknown>;
  // Project root used for resolution; null if not in a project.
  project_root: string | null;
  // Diagnostics not tied to a single layer (e.g., HOME unresolvable).
  diagnostics: { level: "warn" | "error"; message: string }[];
  // Sibling read of `managed-mcp.json` (Phase 2). Not part of the
  // precedence merge; surfaced so the UI can indicate admin-shipped
  // MCP policy. Same LayerRead shape as a precedence layer.
  managed_mcp: LayerRead;
}
```

## Phases

### Phase 1 — Local files + raw + last-wins effective tree (THIS PHASE)

**Scope:** the three file-based layers a user always has on their own machine.

- Backend: new `settings` module in `src-tauri/src/`. Tauri command
  `read_settings_layers` registered alongside `greet`.
- Read these files in this precedence order:
  1. `<cwd>/.claude/settings.local.json` (`project_local`)
  2. `<cwd>/.claude/settings.json` (`project`)
  3. `~/.claude/settings.json` (`user`)
- Project root for Phase 1 = the Tauri app's current working directory. Walking
  up to find the nearest `.claude/` is Phase 4.
- Each layer reports `ok` / `missing` / `error` independently — a malformed
  user file does not block reading the project file.
- `effective` is computed last-wins. Array-merge semantics are deferred to
  Phase 3; for Phase 1, arrays follow the same last-wins rule and we accept
  that this is *wrong* for `permissions.*`. The spec records the limitation
  so it isn't forgotten.
- `ProvenancedValue` is emitted for every leaf, with `elements` always unset.
- Frontend: replace the boilerplate App with a minimal view that invokes
  `read_settings_layers` on mount and renders the snapshot as syntax-shaped
  JSON. No styling work yet — this is a vertical-slice smoke test that the
  IPC, types, and path resolution all line up.

**Out of phase 1:** managed sources, env vars, array merge, project-root
discovery, catalog cross-reference, list/badge UI, refresh, file watcher.

### Phase 2 — File-based managed sources

- Resolve managed paths per OS (`inventory.md:46`–`48`).
- Merge `managed-settings.d/*.json` alphabetically into `managed-settings.json`.
- Add a `managed` layer to the snapshot (file-tier only; plist/registry in
  Phase 6).
- Surface `managed-mcp.json` as a sibling read (it's not part of the merge but
  the UI should know it exists).

### Phase 3 — Env vars + array-merge semantics

- New module reads the env-var subset documented in `inventory.md` §3
  (auth, endpoints, model selection, feature toggles, timeouts, shell/tooling).
- Folded into the snapshot as the `env` layer. Env vars don't share a JSON
  shape with settings.json, so the merge is per-knob: each catalog entry
  records which env var (if any) maps to it.
- Implement array-concat-dedup for the known array-merged fields. Populate
  `elements` for those fields, set `source: null` at the field level.

> The `env` *settings-precedence* layer (described above) projects 8
> mapped OS env vars onto settings keys via `catalog/env-settings-map.json`
> — that's its only job. The orthogonal "what env vars from the full
> 220-entry catalog is Claude Code seeing right now?" surface is the
> **EnvVarsPanel** (see `inspector-ui.md` § "Sibling surfaces"), which
> reads the user's process env via the `read_shell_env_vars` Tauri
> command and joins it with settings.json's `env` block per layer. The
> two surfaces don't overlap: inspector `env.*` rows are filtered out
> entirely; the panel owns that question end-to-end.

### Phase 4 — Settings list UI with provenance badges

UI direction is locked: a three-pane DevTools-style **Inspector**
(precedence rail / settings list / detail drawer). Layout, design
primitives (presence indicator, source badges, layer waterfall), empty-
state copy, and keyboard model are specified in
[`inspector-ui.md`](./inspector-ui.md). Visual reference:
`mocks/01-inspector.html`.

Phase 4 work items:

- Replace the JSON dump with the Inspector layout.
- Flat searchable/sortable settings list (driven by the catalog; unset
  entries shown greyed and hidden by default).
- Implement source badges and the presence indicator (the two reusable
  components that appear across the rail, list, and drawer).
- Project-root discovery: walk up from cwd to find the nearest `.claude/`,
  with a manual override.

### Phase 5 — Layer-stack drawer + catalog cross-reference

- Click a row → drawer showing every layer's contribution to that key, with
  the winning layer highlighted.
- For array-merged fields, render per-element provenance.
- Pull description, type, default, deprecation, and `verify` flag from
  `catalog.json` (when the catalog-sync harness produces one) or from a
  hand-extracted subset of `inventory.md` until then.
- For `env.<VAR>` rows, cross-reference the env-vars catalog by name
  and surface the env-var's `purpose` prose instead of the generic
  parent-`env` description. (Shipped 2026-05-07 — the first
  drawer-side consumer of a non-settings catalog, validating the
  multi-catalog cross-reference seam.)
- "Default" layer becomes meaningful here — values not set anywhere fall
  through to the catalog-declared default and are tagged `default`.

### Phase 6 — OS-policy managed sources

- macOS: read `com.anthropic.claudecode` managed-preferences plist.
  *Shipped 2026-05-06.* `read_managed_layer` checks
  `/Library/Managed Preferences/<user>/com.anthropic.claudecode.plist`
  (per-user MDM) and `/Library/Managed Preferences/com.anthropic.claudecode.plist`
  (system MDM) in that order — same order `cfprefsd` resolves managed
  defaults. A present plist shadows the file-based source per
  `inventory.md:50`; if the plist exists but is malformed, the layer
  reports `error` rather than silently falling back to file-based — the
  admin should see their broken policy, not have a different source
  invisibly take over. Plist values are converted from `plist::Value` →
  `serde_json::Value` (Date/Data are dropped — they have no clean JSON
  shape and shouldn't appear in claude-code policy). The `plist` crate
  is a macOS-only `[target.'cfg(target_os = "macos")']` dependency, so
  Linux and Windows builds don't pull it in. Watcher + opener-scope
  updated for the new paths.
- Windows: read `HKLM\SOFTWARE\Policies\ClaudeCode` and
  `HKCU\SOFTWARE\Policies\ClaudeCode`. *Shipped 2026-05-06.* Each hive's
  `Settings` value is a `REG_SZ` containing a JSON-encoded settings
  document (`inventory.md:48`). The reader uses the `winreg` crate as a
  Windows-only `[target.'cfg(target_os = "windows")']` dep so other
  targets don't pull it in. Per-tier order on Windows is
  HKLM > file-based > HKCU — HKCU is intentionally the lowest-priority
  managed source per `inventory.md:50`, because per-user policy is
  meant to be admin-overridable by file-based, which is in turn
  overridden by HKLM/MDM. Same "present-but-malformed surfaces error
  rather than silently falling through" rule as the macOS plist
  case — admins should see their broken policy. Display path on the
  rail/drawer is `HIVE\SOFTWARE\Policies\ClaudeCode\Settings` so the
  value name is unambiguous. The frontend's `WaterfallRow.PathNote`
  detects registry-style paths (`isRegistryPath`) and renders them as
  a non-clickable label — the opener plugin can't do anything with a
  registry path, and dangling a button that silently no-ops is worse
  UX than rendering plain text.
- Apply managed-tier precedence (`inventory.md:50`) to pick the single
  managed source that wins.

### Phase 7 — Refresh, watch, diagnostics polish

- File watcher (via Rust, not the fs plugin) for live updates when settings
  files change on disk.
- Surface malformed-JSON / permission-denied / missing-HOME diagnostics in
  the UI.
- Empty states for each layer slot, including the unreachable-by-design
  `cli` slot.

## Out of v1 entirely

- Resolving CLI flags of a running `claude` process.
- Plugin/skill/agent frontmatter as a settings source.
- Any write path.
