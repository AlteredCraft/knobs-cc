# Deep dives

Mid-level technical explanations of non-obvious mechanics in knobs.cc.
Less terse than the README, less exhaustive than the specs in `spec/`.

## Contents

- [How env vars shadow settings keys](#how-env-vars-shadow-settings-keys)

---

## How env vars shadow settings keys

Setting `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1` in your shell flips
the `includeGitInstructions` row in the inspector from `true`
(source: `PROJ`) to `false` (source: `ENV`), with the project value
shown shadowed in the layer waterfall.

How does the app pull that off when the env var and the settings key
have different names and opposite boolean polarity?

Three pieces working together — and the cleverness is that the **env
layer pretends to be a file layer**, so the rail / drawer / waterfall
code never has to special-case env-driven values.

### 1. The seam: `catalog/env-settings-map.json`

A hand-curated JSON table with one entry per known env↔setting pair:

```json
{
  "env": "CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS",
  "settings": "includeGitInstructions",
  "type": "bool",
  "invert": true
}
```

Nine entries today. This is the only place in the codebase where the
OS-env world is bridged to the settings-key world.

The map is hand-maintained because Claude Code's upstream JSON Schema
doesn't expose env equivalents as structured metadata — the pairings
live in prose like *"Takes precedence over the `includeGitInstructions`
setting"* inside the env-var docs page (and therefore inside
`catalog/env-vars.json` after sync). Issue
[#16](https://github.com/AlteredCraft/knobs-cc/issues/16) tracks the
open question of how to keep this map automatically aligned with that
prose drift.

### 2. The projection: `src-tauri/src/env_layer.rs`

When the backend builds a snapshot, `build_raw` walks the map, reads
each env var from the right source (the attached claude's environ via
`sysinfo` when something's attached, the host shell's env via
`std::env::var` otherwise), then for each hit:

1. Coerces the string into the declared type (`string`, `bool`, or
   `int`).
2. Flips the bool if `invert: true`.
3. Writes the result at the dotted settings path via
   `set_dotted_path`, which supports nested keys like
   `permissions.defaultMode`.

For `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`:

```
"1" --coerce("bool")--> true --invert--> false
    --set_dotted_path("includeGitInstructions")--> { "includeGitInstructions": false }
```

The output is a synthesized settings-shaped `serde_json::Value` that
lives only in memory. It has the same shape as if someone had written
`{"includeGitInstructions": false}` into a real settings.json file —
but no file exists.

The function is intentionally permissive: a malformed env var (e.g.
`CLAUDE_CODE_DISABLE_THINKING=maybe`) returns `None` from `coerce` and
is silently skipped rather than surfaced as a layer error. A busted
env var shouldn't drop the whole inspector to a broken state.

### 3. The merge: layer-agnostic precedence

That synthesized blob enters the precedence machinery as
`LayerRead { source: Env, raw: <json>, ... }` — one of seven layers in
the snapshot. Six come from the Rust backend (`Managed`, `Cli`, `Env`,
`ProjectLocal`, `Project`, `User`); `Default` is synthesized at the UI
as a fallback for unset keys.

The merger walks layers in precedence order
(`managed > cli > env > project_local > project > user > default`)
and produces per-leaf provenance plus per-layer waterfalls. It treats
every layer identically. It doesn't know — or need to know — that the
`Env` layer's `raw` was synthesized rather than read from disk.

That's why the "shadowed" badge in the inspector lights up
automatically: the merger sees two layers (`Env` and `Project`) both
contributing to `includeGitInstructions`, picks the higher-precedence
one as the winner, and records the lower one as shadowed. Same
mechanism that lets `Project` shadow `User` (or any layer shadow any
lower one) for any other key.

### What this means in practice

- **Adding a new env↔setting pair is a one-line JSON edit** to
  `catalog/env-settings-map.json`. No Rust changes, no React changes,
  no merger changes. The map is embedded at compile time via
  `include_str!`, so a recompile is needed — but no code is edited.
- **Map edits don't reflect via Cmd+R refresh.** They're compiled into
  the binary, not read at runtime. Other catalog files
  (`settings.json`, `env-vars.json`, etc.) are runtime-loaded by the
  `read_catalog` Tauri command and live-update; this map is the odd
  one out. There's no strong reason it has to be, beyond historical
  shape.
- **Inversion is pure data** in the map (`"invert": true`). The Rust
  code is generic — it doesn't have a hardcoded list of "disable" env
  vars. That's also why a wrong polarity in the map (e.g. forgetting
  `invert` on a `DISABLE_*` var) produces clean, predictable bugs
  rather than weird behavior.

### Where to read more

- [`src-tauri/src/env_layer.rs`](../src-tauri/src/env_layer.rs) — the
  projection (~140 lines, well commented; the tests at the bottom of
  the file are a good way to learn the contract).
- [`catalog/env-settings-map.json`](../catalog/env-settings-map.json) — the seam.
- [`spec/settings-display.md`](../spec/settings-display.md) Phase 3 —
  the design rationale.
- Issue [#16](https://github.com/AlteredCraft/knobs-cc/issues/16) — the
  open question about keeping the map aligned with upstream docs
  drift.
