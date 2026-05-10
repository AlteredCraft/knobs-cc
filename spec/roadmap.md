# Roadmap

Single source of truth for open work across `spec/`. Each item points back
at the originating spec section for rationale and shape — this file only
tracks what's outstanding.

If you ship something, mark it ✅ here and (where relevant) update the
corresponding spec section. If you discover new work, add it here, not
inline in another spec.

Last reviewed: 2026-05-10 (Phase 2 + read_catalog + Phase 5 + Phase 7 +
path-notes click-through + Phase 6 fully shipped + three-OS CI +
managed-mcp.json topbar pill + catalog-drift cron + sync-sub-agents +
in-app error log + per-OS capability split + sync-mcp + sync-permissions
+ drawer cross-references env-vars catalog + sync-keybindings +
sync-cli-reference + hooks catalog pass #2 + drawer cross-references
permissions.modes as a value-conditional annotation under EFFECTIVE +
issue #7 filed for generalizing the annotation seam + EnvVarsPanel
shipped, closing #6).

## Next-up candidates

A digest of what's open across the four tracks below — pick from
here, then jump to the relevant section for shape and rationale.

- **Drawer cross-reference for `hooks.events`** (inspector polish) —
  concrete follow-up to the env-vars + permissions.modes drawer
  wire-ups. Catalog already loads through `read_catalog`; main
  open question is whether the array-typed `hooks.<EventName>` rows
  fit the existing drawer shape. See Inspector polish § "Open work".
- **Generalize value-conditional drawer annotation** (inspector
  polish) — the annotation that ships today only fires for
  `permissions.defaultMode`. Other multi-value enums (`effortLevel`,
  `teammateMode`, `viewMode`, ...) would benefit but lack a
  structured per-value source upstream. Tracked at
  [#7](https://github.com/AlteredCraft/knobs-cc/issues/7); solution
  space and a recommended starting step (`model-config.md` for
  `effortLevel`) live in the issue body.
- **Rail navigability decision** (inspector polish) — spec question,
  not coding work; needs a fork-vs-fork call before any UI lands.
- **Inventory canonicalization** — `inventory.md:15` flags §3
  env-vars and §5.1 hook-events as gaps. Separately, the `[!verify]`
  convention `CLAUDE.md` describes is unused (zero tags in the
  inventory) — decide whether to re-tag unverified rows or retire
  the convention.
- **New sync scripts** (catalog sync) — slate complete for now.
  (`sub-agents.md`, `mcp.md`, and `permissions.md` shipped 2026-05-07;
  `keybindings.md` and `cli-reference.md` shipped 2026-05-08; see
  catalog-sync section below.)
- **CI / drift hardening** (catalog sync) — `$ref` resolution policy;
  staleness signal. (Cron-driven sync with PR-on-diff shipped
  2026-05-06.)

Deferred / open-ended (kept warm, not slated): CLI layer via process
argv, goals view, cross-cutting surfaces, landing page, nomenclature.
See "Deferred plan" and "Design surfaces" further down.

---

## Settings layers — `settings-display.md`

Phase numbering matches the spec.

- **Phase 2 — file-based managed sources.** ✅ shipped 2026-05-05.
  `managed-settings.json` + alphabetic last-wins merge of
  `managed-settings.d/*.json` (within-tier; the cross-layer
  array-concat-dedup post-pass still runs). OS roots resolved per
  `inventory.md:46-48`. A malformed file in the managed tier fails the
  whole layer with the offending path named — admins should see their
  policy isn't loading rather than a silently-skipped file. Sibling read
  of `managed-mcp.json` exposed on the snapshot as `managed_mcp`
  (UI surfacing shipped 2026-05-06 as the topbar pill). Plist / registry
  policy sources shipped 2026-05-06 in Phase 6.
- **Phase 3 — env vars + array-merge.** ✅ shipped 2026-05-05.
  Phase 3a: array-concat-dedup with per-element provenance for the known
  array-merged paths; `array-merged` chip activated.
  Phase 3b: `env` layer reads process env via the hand-curated mapping at
  `catalog/env-settings-map.json` (eight v1 mappings — `ANTHROPIC_MODEL`,
  `CLAUDE_CODE_*`). Mapping is extensible by JSON edit; future PR can
  migrate to a description-prose-derived `env` field on each settings
  catalog entry once upstream schema gains structured metadata.
- **Phase 5 — drawer catalog cross-reference.** Mostly shipped
  2026-05-05.
  ✅ Description / type / default in the drawer header (default shown
  inline as "default: X" when the entry has one and the row isn't
  unset).
  ✅ Default-layer flow-through — unset rows already pull `value` from
  catalog `default` and tag with `winner: "default"`; the waterfall
  surfaces it as the winning row.
  ✅ Per-element waterfall (Phase 3a).
  ✅ Related-knobs section — `findRelatedKnobs(keyPath)` in
  `src/lib/catalog.ts` returns immediate siblings under the same
  parent; drawer renders them as clickable rows; clicking
  navigates the drawer + list cursor in lockstep.
  Outstanding: **deprecation copy.** The settings catalog has no
  structured `deprecated` field — only one entry
  (`includeCoAuthoredBy`) mentions it informally in description prose.
  Either lobby upstream JSON Schema for a flag, or build a
  description-prose matcher when more entries gain that copy. Not slated.
  Known minor limitation: clicking a related knob that's currently
  filtered out (chip / search) snaps to the first visible row instead
  of clearing the filter. Acceptable for v1; track if it bites.
  (§ "Phase 5".)
- **Phase 6 — OS-policy managed sources.** ✅ shipped 2026-05-06.
  macOS `com.anthropic.claudecode` plist read via the `plist` crate
  (macOS-only `[target.'cfg(...)']` dep). Per-user MDM
  (`/Library/Managed Preferences/<user>/...`) takes precedence over
  system MDM (`/Library/Managed Preferences/...`); a present plist
  shadows the file-based source even when it fails to parse — admins
  see the broken policy rather than have a different layer silently
  take over. Plist paths added to the file watcher and to the
  `opener:allow-open-path` scope so the rail's path-note remains
  clickable.
  Windows `HKLM\SOFTWARE\Policies\ClaudeCode\Settings` and
  `HKCU\SOFTWARE\Policies\ClaudeCode\Settings` (REG_SZ JSON) read via
  the `winreg` crate (Windows-only target dep). Per-tier order is
  HKLM > file-based > HKCU per `inventory.md:50` — HKCU is
  intentionally lowest because per-user policy is admin-overridable by
  file-based, which is in turn overridden by HKLM. Same "present-but-
  malformed wins" rule as macOS plist. Frontend `WaterfallRow.PathNote`
  detects registry-style paths and renders them as a non-clickable
  label (the opener plugin can't do anything with a registry path).
  Round-trip Windows test writes to a unique `HKCU\SOFTWARE\Knobs-CC-
  Test\<unique>` subkey to avoid clobbering real policy locations on a
  shared CI runner. (§ "Phase 6".)
- **Phase 7 — refresh / watch / diagnostics.** ✅ shipped 2026-05-05.
  Manual refresh shipped earlier (`R` key + topbar button). Phase 7
  added:
  ✅ File watcher via `notify` (not the fs plugin — capability surface
  stays at `core:default` + `opener:default` plus a tightly-scoped
  `opener:allow-open-path` allowlist; no fs/shell/process/dialog/updater
  plugins). Watches each settings dir
  non-recursively, filters by filename, emits `settings-changed` to the
  main window; the frontend debounces by 250ms and re-runs
  `read_settings_layers`.
  ✅ Per-layer error promotion — layer-level parse / IO errors now
  appear in the diagnostics dock alongside snapshot-level diagnostics
  (HOME/cwd unresolvable). Previously the dock said "Diagnostics · 0"
  while a rail row was red.
  ✅ Better empty-state copy when a file-based layer has no resolvable
  path (`user` → "$HOME not set", `project`/`project_local` → "no
  project root"). The bare "—" was uninformative.
  Existing empty states (managed / cli / env / default) continue
  verbatim from `inspector-ui.md:131-139`. (§ "Phase 7".)

### Deferred plan (kept warm, not slated)

- **CLI layer via process argv.** Reading another `claude` process's
  flags through `sysinfo`. Plan written at
  `~/.claude/plans/1-is-interesting-did-steady-seahorse.md`. Currently
  documented as out of v1 in `settings-display.md:200`.

---

## Catalog sync — `catalog-sync.md`

- **Hooks pass #2.** ✅ shipped 2026-05-08. `scripts/sync-hooks.js` now
  walks the page heading-aware (h2..h5) and extracts three additional
  artifacts on top of the lifecycle table: (1) handler-fields tables
  under `### Hook handler fields` — `common`, `command`, `http`,
  `mcp_tool`, and `prompt_and_agent` (the doc collapses prompt + agent
  into a single shared section because both types accept the same
  fields), each `{field, required, description}`; (2) the
  `### Common input fields` tables (the section has two stacked tables
  — main + the `--agent`/subagent extras — both belong to it, so
  they're concatenated into a single `commonInput` array of
  `{field, description}`, 8 fields total); (3) per-event input/output
  schemas keyed by event name, each `{inputFields, inputExample,
  outputFields}`. `inputExample` is the verbatim body of the first
  ```` ```json ```` fence inside `#### <Event> input`; `outputFields`
  pulls from either `#### <Event> decision control` or
  `#### <Event> output`, whichever the upstream doc uses for that
  event. The new envelope lands as
  `{source, fetchedAt, count, events, handlers, commonInput}`; existing
  `events` shape is preserved, just enriched with the three new
  per-event fields. Required two upstream-driven parser refinements:
  GFM-aware `splitCells` that handles `\|` escapes (load-bearing for
  the `Edit\|Write` matcher fixture) and a heading-aware table walker
  that reset deeper levels when a higher heading reopens. Out of scope
  for pass #2 (tracked as future passes): per-tool nested
  `tool_input` tables under `#### PreToolUse input` (Bash / Edit /
  Write / Read / Glob / Grep / WebFetch / WebSearch / Agent /
  AskUserQuestion — 4-col `Field | Type | Example | Description`
  shape, deliberately skipped because pass #2 captures only the shared
  2-col shape); the `### Matcher patterns` cross-reference table
  (different fields per event); the `### JSON output` universal-fields
  table (could become a `commonOutput` array in a future pass);
  exit-code-2 behavior, HTTP response handling, prompt-hook response
  schema, async-hook config — all prose-rich. Wired through
  `read_catalog` as `hooks` on the wire (no UI consumer yet — Rust
  loads it as `serde_json::Value`, so the new keys flow through
  transparently). Cron sync covers the new shape.
- **New sync scripts.** Each gets one script + one catalog file + one
  test, per the recipe. No remaining candidates from the
  documentation index — every page that exposes a canonical tabular
  artifact is now synced.
- **CLI reference catalog (commands + flags).** ✅ shipped 2026-05-08.
  `scripts/sync-cli-reference.js` reads
  `https://code.claude.com/docs/en/cli-reference.md`'s two top-level
  reference tables and writes `catalog/cli-reference.json`
  (20 commands + 63 flags at time of writing). Both tables share a
  3-col `| X | Description | Example |` shape and are extracted by
  the same parser parameterized over the header pattern. The page's
  `### System prompt flags` subsection uses `Flag | Behavior |
  Example` (not `Description`) and is deliberately skipped — its
  four entries are a re-statement of flags already in the main
  table. Required two upstream-driven parser refinements over the
  keybindings template: tighter `stripBackticks` (`[^`]+` body) so
  multi-span flag names like `--continue`, `-c` keep their inline
  code formatting, and unescaped-pipe-aware splitting so the
  `cat file \| claude -p "query"` row parses cleanly. Wired through
  `read_catalog` as `cli_reference` (snake-case on the wire to match
  `env_vars` / `sub_agents`); no UI consumer yet. Cron sync covers
  the new script. Future use: this catalog is load-bearing for the
  deferred "CLI layer via process argv" plan — each documented flag
  is a candidate input the eventual flag-name → settings-key mapping
  (parallel to `catalog/env-settings-map.json`) will draw on.
- **Keybindings catalog (contexts only).** ✅ shipped 2026-05-08.
  `scripts/sync-keybindings.js` reads
  `https://code.claude.com/docs/en/keybindings.md`'s
  `## Contexts` table and writes `catalog/keybindings.json`
  (20 records — `Global`, `Chat`, `Autocomplete`, `Settings`,
  `Confirmation`, `Tabs`, `Help`, `Transcript`, `HistorySearch`,
  `Task`, `ThemePicker`, `Attachments`, `Footer`, `MessageSelector`,
  `DiffDialog`, `ModelPicker`, `Select`, `Plugin`, `Scroll`,
  `Doctor`). The page is rich (per-context action tables, keystroke
  syntax, reserved shortcuts, terminal conflicts, vim-mode
  interaction) but the contexts table is the single canonical
  artifact most directly consumable: it enumerates every value the
  `context` field accepts inside a `bindings` block of
  `~/.claude/keybindings.json`. Wired through `read_catalog` as
  `keybindings` on the wire (no UI consumer yet, parallel to
  env-vars / hooks / sub-agents / mcp / permissions). Cron sync
  covers the new script. Future passes: per-context `Action |
  Default | Description` action tables (would need to be associated
  with their owning `### foo actions` heading), reserved shortcuts
  and terminal conflicts tables, keystroke-syntax modifier rules.
- **Permissions catalog (modes only).** ✅ shipped 2026-05-07.
  `scripts/sync-permissions.js` reads
  `https://code.claude.com/docs/en/permissions.md`'s
  `## Permission modes` table and writes `catalog/permissions.json`
  (6 records — `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`,
  `bypassPermissions`). The page is structurally rich (rule syntax,
  tool-specific patterns, path-prefix table, managed-only settings
  table, working-directories table) but the modes table is the
  single canonical artifact most directly consumable: it enumerates
  every value `permissions.defaultMode` accepts with prose richer
  than the short blurbs in the settings JSON Schema. Wired through
  `read_catalog` as `permissions` on the wire (no UI consumer yet,
  parallel to env-vars / hooks / sub-agents / mcp). Cron sync covers
  the new script. Future passes: the path-pattern table
  (`### Read and Edit`'s `//path` / `~/path` / `/path` / `path`
  prefixes), the managed-only-settings annotation table (which would
  let the app flag managed-only settings catalog entries), and the
  per-tool rule-syntax tables.
- **MCP catalog (installation scopes).** ✅ shipped 2026-05-07.
  `scripts/sync-mcp.js` reads
  `https://code.claude.com/docs/en/mcp.md`'s
  `## MCP installation scopes` table and writes `catalog/mcp.json`
  (3 records — Local, Project, User). The page is heterogeneous and
  most of it lives in prose-heavy `###`/`####` sections; the scopes
  table is the single canonical tabular artifact. Each record carries
  `name`, `loadsIn`, `shared` (preserved verbatim — "No" /
  "Yes, via version control" / "No"), and `storedIn` (preserved
  verbatim, code-spans intact). Wired through `read_catalog` as `mcp`
  on the wire (no UI consumer yet, parallel to env-vars / hooks /
  sub-agents). Cron sync covers the new script. Future passes:
  transport types (HTTP / SSE / stdio), managed-mcp.json exclusive-
  control + allowlist/denylist semantics, OAuth credential handling,
  tool-search deferral thresholds.
- **Sub-agents catalog (frontmatter pass).** ✅ shipped 2026-05-07.
  `scripts/sync-sub-agents.js` reads
  `https://code.claude.com/docs/en/sub-agents.md`'s
  `#### Supported frontmatter fields` table and writes
  `catalog/sub-agents.json` (16 fields — `name`, `description`,
  `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`,
  `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`,
  `isolation`, `color`, `initialPrompt`). The catalog is wired through
  `read_catalog` as `sub_agents` (snake-case on the wire to match
  `env_vars`); no UI consumer yet, parallel to the env-vars/hooks
  catalogs. Cron sync covers the new script. Future pass: built-in
  subagent identities (Explore / Plan / general-purpose / etc.) and
  the operational rules around tool restrictions and hooks.
- **`read_catalog` Tauri command.** ✅ shipped 2026-05-05. Rust now
  owns `catalog/{settings,env-vars,hooks}.json` via `include_str!` and
  serves them through `read_catalog`. The frontend's `src/lib/catalog.ts`
  is now async-hydrated (`loadCatalog()` at boot, sync accessors
  thereafter); a vitest setup file feeds the same JSON into
  `hydrateCatalogForTesting()` so unit tests skip IPC. The env-vars
  and hooks catalogs are exposed on the wire but not yet consumed by
  the UI — Phase 5 and inspector polish will pick them up. Unblocks
  Phase 5.
- **`$ref` resolution policy.** Settings catalog preserves `$ref`
  strings; decide whether consumers expand them at sync time or via a
  sibling `$defs` block.
- **Staleness signal.** ETag or content-hash on fetch — useful once we
  want change-detection beyond raw diff.
- **Cron CI for catalog drift.** ✅ shipped 2026-05-06.
  `.github/workflows/catalog-drift.yml` runs the sync scripts every
  Monday 09:00 UTC (and on `workflow_dispatch`). Detect step
  normalises out the always-changing `fetchedAt` field; if only the
  timestamp moved, the working tree is restored and no PR opens.
  Real drift opens (or updates) a single `chore/catalog-drift` PR
  via `peter-evans/create-pull-request@v8` (bumped from v7 alongside
  `actions/checkout@v5` and `actions/setup-node@v5` for the 2026-06-02
  Node 24 cutover). (§ "Automation" in `catalog-sync.md`.)
- **Coverage thresholds.** `--test-coverage-lines/-branches` floors on
  the sync test suites. Premature now.
- **Inventory's long-term role.** Once catalogs cover the same ground,
  decide what `inventory.md` is for — reference doc, contribution
  surface, or retire. (Open question carried in `catalog-sync.md` §
  "Open questions".)

---

## Inspector polish — `inspector-ui.md`

Open work (what to pick up next within this track):

- **Drawer cross-references — `hooks.events` for `hooks.<EventName>`.**
  Hooks pass #2 (2026-05-08) lifted handler types and per-event
  schemas into `catalog/hooks.json`. The natural drawer consumers are
  rows whose keyPath is `hooks.<EventName>` (e.g. `hooks.PreToolUse`,
  `hooks.Stop`): surface the event's `when` cadence in the header.
  Stretch — collapsible detail with `inputFields` / `outputFields` /
  `inputExample` and a "common input fields" reference; if any of
  that doesn't fit cleanly into the existing drawer affordances,
  scope back to header-only and track the detail panel as a third
  pass. `hooks.<EventName>` rows hold matcher-group arrays rather
  than scalars, so the drawer's value rendering may need to handle
  the array case before the cross-reference is useful — verify
  with a live row before designing the detail panel.
- **Rail navigability — undecided.** Spec is silent. Either keep the
  rail informational (current behavior) or wire layer-click → centre
  list filtered to keys won by that layer. Needs an explicit decision
  before any work — surface as a question, not a ticket.
- **Generalize value-conditional drawer annotation.** Today's
  annotation only fires for `permissions.defaultMode` because
  permissions.md upstream has a structured per-mode table. Other
  multi-value enums (`effortLevel`, `teammateMode`, `viewMode`,
  `env.CLAUDE_CODE_DEBUG_LOG_LEVEL`, ...) would benefit but lack a
  structured per-value source upstream. Tracked at
  [#7](https://github.com/AlteredCraft/knobs-cc/issues/7) — solution
  space (sync more upstream tables vs. hand-curated overlay vs.
  description-prose parser vs. ship as-is) and a recommended starting
  step (`model-config.md` for `effortLevel`) live in the issue body.
  Surfaced by live smoke of the permissions.modes drawer wire-up.
- **`mcp.scopes` enrichment for the managed-mcp pill.** Lower-bar
  follow-up: the pill currently shows server count and links to
  `openInEditor` on the JSON file. The MCP catalog's 3-record `scopes`
  array (Local / Project / User, each with `loadsIn` / `shared` /
  `storedIn`) could fold into a tooltip or popover so users see scope
  semantics without leaving the app. Smaller surface than the two
  drawer items above; pick up only if there's a clear UX win — the
  existing "open the file" affordance may be sufficient.

Shipped:

- **EnvVarsPanel — SSOT for env vars.** ✅ shipped 2026-05-10. The
  inspector-side `env` settings-precedence layer only projects 8
  mapped OS env vars (`catalog/env-settings-map.json`) onto settings
  keys; the upstream env-vars catalog has 220 entries, so ~95% of
  documented env vars never showed up in the inspector at all. The
  new topbar-pill-driven panel (modeled on `ErrorPanel`/`HelpView`)
  lists every cataloged env var as a row with: shell-set value (read
  via the new `read_shell_env_vars` Tauri command), settings.json
  `env.<NAME>` contributors per layer in precedence order, an
  effective-value badge (shell wins when both routes set the same
  name), and full `purpose` prose on click-expand. Names matching
  `/key|token|secret|password/i` mask their value to `•••••••• abcd`
  (last 4 chars) until clicked — demo-safe by default. Filter chips:
  `all` / `set` / `shell` / `settings.json` / `unset`; substring
  search across name and purpose. **Non-catalog entries** — names
  users set under `env.<NAME>` in `settings.json` that aren't in the
  upstream catalog — surface at the top of the panel in their own
  group with a `non-catalog` chip, so explicit user intent that's
  invisible everywhere else gets first-class billing. Shell-set
  names that aren't in the catalog are deliberately *not* surfaced
  (a user's shell carries hundreds of unrelated vars; only
  settings.json `env` is treated as Claude-Code-specific intent).
  Sister structural change: `env.*` rows are now filtered out of
  the inspector entirely (`buildRows` skips the `env` subtree) and
  a one-line banner above the inspector's column header points
  users at the panel — closes [#6](https://github.com/AlteredCraft/knobs-cc/issues/6).
  Caveat surfaced in the panel footnote: knobs.cc reads its own
  process env, which usually matches the user's shell but can
  differ for Finder/Spotlight launches that use LaunchServices'
  env. Dotenv files Claude Code reads at startup are out of scope
  for this pass.
- **Drawer cross-references `permissions.modes` for
  `permissions.defaultMode`.** ✅ shipped 2026-05-08. When a row's
  keyPath is `permissions.defaultMode` and the row's effective value
  (set or `catalog.default` for unset) matches one of the 6 cataloged
  modes, the drawer surfaces that mode's specific prose as a
  *value-conditional annotation* below the EFFECTIVE block — keeping
  the header description ("Default permission mode.") tied to the
  knob itself, not its current value. The structural separation
  matters: a header that silently changes prose when the value
  changes would be misleading; an annotation labelled by position
  (under EFFECTIVE, prefixed `→`) makes it obvious the prose
  describes the *value*. Joins through `findPermissionMode(name)` in
  `src/lib/catalog.ts` (name-indexed Map built at hydration time) and
  a new `resolveValueAnnotation(row)` helper in `KeyDrawer.tsx`,
  parallel to `resolveDescription`. Case-sensitive lookup — mode
  names are camelCase ASCII and case-folding would feed false matches
  for user typos. Defensive: only attempts the lookup when
  `typeof row.value === "string"`, so a malformed settings.json with
  a non-string value renders no annotation rather than misleading
  prose. Undocumented enum values (`delegate` — experimental
  agent-team only, in the JSON Schema enum but not in the upstream
  permissions docs) also render no annotation. The annotation
  preserves the full multi-line catalog prose (no first-line
  truncation) since it lives in its own block — qualifiers like
  "Currently a research preview" stay visible. Second drawer-side
  consumer of a non-settings catalog after env-vars; further
  validates the seam for `hooks.events` next, where the same
  value-vs-knob distinction will apply.
- **Drawer cross-references env-vars catalog.** ✅ shipped 2026-05-07.
  When a row's keyPath is `env.<VAR>` and `<VAR>` is documented in the
  env-vars catalog (220 entries upstream), the drawer header surfaces
  the env-var's `purpose` prose instead of the generic parent-`env`
  description the settings-catalog walk-up returns. This is the first
  drawer-side consumer of a non-settings catalog — `findEnvVar(name)`
  in `src/lib/catalog.ts` joins to a name-indexed Map built at
  hydration time; `resolveDescription(row)` and `envVarNameFromKeyPath`
  in `KeyDrawer.tsx` are pure helpers exported for unit testing.
  Case-sensitive on lookup (env-var convention is upper-case ASCII;
  case-folding would feed false matches for user typos). Validates
  the seam for future drawer consumers — `permissions.modes` for
  `permissions.defaultMode`, `hooks.events` for `hooks.<EventName>`,
  `mcp.scopes` for the managed-mcp pill.
- **In-app error log + per-OS capability split.** ✅ shipped 2026-05-07.
  `src/lib/errorLog.ts` is a 50-entry in-memory ring buffer with
  `subscribe`/`reportError`/`markAllSeen`/`clearErrors` and an
  `installGlobalHandlers` bridge for `window.onerror` and
  `unhandledrejection`. `openInEditor`'s catch now routes to
  `reportError` instead of silently `console.error`-ing. The Topbar
  surfaces a red `errors` pill (visible only when entries > 0, glows
  red while there are unseen entries); clicking opens an `ErrorPanel`
  modeled on `HelpView` that lists timestamp / source / message /
  detail with a `clear` button. Diagnostics (config-side) and runtime
  errors (UI-side) stay as separate pills so users can tell "my config
  is broken" from "the inspector is broken." Surfaced an existing bug:
  `opener:allow-open-path` was failing every call on macOS because
  Tauri compiles every scope glob on every target, and a Windows
  backslash pattern (`C:\Program Files\ClaudeCode\**`) fails to
  compile on macOS/Linux. Fix: split `capabilities/default.json` into
  cross-platform + `default-macos.json` / `default-linux.json` /
  `default-windows.json` gated via `platforms` so each pattern is only
  compiled on its own target.
- **`managed-mcp.json` topbar pill.** ✅ shipped 2026-05-06.
  `describeMcpPolicy(snapshot.managed_mcp)` (`src/lib/managedMcp.ts`)
  drives a small clickable pill in the topbar that only renders when
  the file is present (`status: "ok"` or `"error"`). Reports the
  server count from the parsed `mcpServers` object (`"3 servers"` /
  `"1 server"` / `"0 servers"` for present-but-empty); error state
  surfaces the parse error in the tooltip and renders a red dot.
  Click opens the JSON via `openInEditor` — added
  `C:\Program Files\ClaudeCode\**` to `opener:allow-open-path` so
  Windows users get click-through too (pre-existing gap, surfaced now
  that the pill makes the path actionable). Drill-down into the
  parsed contents stays out of scope — the file's small enough that
  opening it in the user's editor is the right primary action.
- **Path-notes click-through.** ✅ shipped 2026-05-06 (per-OS capability
  split followed 2026-05-07 — see "In-app error log" above for the why).
  Path notes in the drawer waterfall are now clickable; click invokes
  `@tauri-apps/plugin-opener`'s `openPath` to open the file in the OS
  default editor. Required adding `opener:allow-open-path` to the
  capability files (default opener perms cover URLs + reveal-in-dir
  but not path-open) **and** scoping the grant to a whitelist of
  settings-file globs (`$HOME/.claude/**`, `**/.claude/settings.json`,
  `**/.claude/settings.local.json`) plus per-OS managed-tier paths
  gated by `platforms` (macOS `/Library/Managed Preferences/*/...plist`
  + `/Library/Application Support/ClaudeCode/**`; Linux
  `/etc/claude-code/**`; Windows `C:\Program Files\ClaudeCode\**`).
  Without a scope the runtime denies every call; the scope keeps the
  v1 boundary tight by limiting the webview to opening only the files
  we surface. Line targeting (`:7`) is deferred — `openPath` doesn't
  take a line, and adding a `vscode://file` URL scheme would expand
  the capability surface for VS-Code-only users.
- **Related-knobs section.** ✅ shipped with Phase 5
  (`KeyDrawer.tsx` `RelatedKnobs`).
- **Per-element waterfall** for array-merged fields. ✅ shipped with
  Phase 3a (`KeyDrawer.tsx` `ElementList`).
- **Real `error` rail row.** ✅ shipped with Phase 2 — managed-file
  parse failures now produce an `err` row in the rail. (Project / user
  files have produced `error` since Phase 1; Phase 2 closed the last
  layer that couldn't.)

---

## Inventory canonicalization — `inventory.md`

- **§3 env-vars gaps.** Top-of-file note (`inventory.md:15`) flags this
  section as a known canonicalization gap; cross-check against live
  docs.
- **§5.1 hook-events gaps.** Same — flagged at line 15.
- **`[!verify]` convention.** `CLAUDE.md` describes the tag as a
  contribution surface, but the inventory currently contains zero such
  tags. Decide: re-tag unverified rows, or drop the convention from
  `CLAUDE.md`.

---

## Design surfaces — `design-notes.md`

These are deferred / open-ended; track here so they don't get lost.

- **Goals view.** Mocked at `mocks/03-goals.html`. Reframes the
  Inspector's data by user intent (speed / cost / safety / quality /
  privacy). Best done after the catalog produces structured tags.
- **Cross-cutting surfaces.** Hook graphs, plugin hierarchies, MCP
  runtime state. Don't fit a flat list; no concrete plan.
- **Landing page** (`knobs.cc/`). Leaning "live inventory" — render
  `spec/inventory.md` as a styled static site for the pre-release
  period.
- **Nomenclature.** "Knob" vs "setting / option / control"; "surface /
  category / group" for the top-level taxonomy. Listed as open.
