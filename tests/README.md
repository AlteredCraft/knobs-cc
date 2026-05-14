# Demo scenarios

Hand-crafted project directories that exercise specific knobs.cc features.
Each subdirectory is a self-contained Claude Code project — its `.claude/`
holds the settings the scenario wants to demonstrate.

## How to use a scenario

Two flows, depending on what the scenario is testing:

1. **Pure file-based scenarios** (most of these). Open knobs.cc and point
   it at the scenario directory using the SessionPill's path-picker
   fallback (no running claude required). The inspector reads the
   `.claude/` files directly.

2. **Attach-mode scenarios** (`04-env-override`, `06-cli-attach`).
   Start `claude` inside the scenario directory with the command in its
   README, then in knobs.cc click the SessionPill and select that
   running process. The env / cli layers light up because they're
   sourced from the live process's environ / argv.

You don't have to actually *converse* with claude — the snapshot is
based on argv + environ + the on-disk `.claude/` files, so claude just
needs to be running. Ctrl+D out of it when done.

## Scenarios

| # | Directory | Demonstrates |
|---|---|---|
| 01 | `01-minimal/` | Single project layer, baseline read. |
| 02 | `02-project-vs-local/` | Project vs local precedence; "local beats project" in the rail. |
| 03 | `03-array-merge/` | `permissions.allow` / `deny` merging across two layers with per-element provenance. |
| 04 | `04-env-override/` | Env layer (via `catalog/env-settings-map.json`) winning over project settings. |
| 05 | `05-env-block/` | EnvVarsPanel sourcing values from `settings.json`'s `env` block; cataloged + user-defined vars. |
| 06 | `06-cli-attach/` | CLI argv layer (e.g. `--model`) winning over env and settings via attach mode. |

## Resetting

Nothing in here is stateful. If a scenario looks weird, `git status` and
`git checkout -- tests/<dir>` will restore it.

## Adding scenarios

Keep them focused — one demonstrated feature per scenario. Real-world
configs that mix everything are useful for testing but make poor demos;
add complexity in a separate kitchen-sink scenario if you need it.
