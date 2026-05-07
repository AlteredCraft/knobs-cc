# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

knobs.cc is a **Tauri 2 desktop app** (pre-release; no signed installer yet) that inspects Claude Code's configuration: what knobs exist, what's currently set, and which layer wins. v1 is **read-only**.

The repo holds three coordinated surfaces:

1. **`spec/`** — design, scope, and roadmap. `inventory.md` catalogs every Claude Code config surface; `settings-display.md` and `inspector-ui.md` describe the app's backend and UI in phases; `catalog-sync.md` describes the harness that keeps catalog files in sync with upstream docs; `design-notes.md` carries open questions; `roadmap.md` is the single source of truth for what's shipped and what's pending.
2. **The Tauri 2 app** (`src/`, `src-tauri/`) — implementation. The Rust backend exposes `read_settings_layers` (five layers — managed / env / project_local / project / user — with per-leaf provenance and array-merge for permissions-style fields) and `read_catalog`, plus a `notify`-based file watcher that emits `settings-changed` so the UI refreshes live (see "Tauri 2 boundaries" — we use `notify` directly, not `tauri-plugin-fs-watch`, to keep the capability surface minimal). The React/Vite frontend is a three-pane DevTools-style Inspector: precedence rail, settings list, key drawer.
3. **The catalog harness** (`scripts/sync-*.js`, `catalog/*.json`) — pulls upstream JSON Schema and docs into `catalog/{settings,env-vars,hooks}.json`, which the app reads through `read_catalog`. `catalog/env-settings-map.json` maps env vars to their settings-key equivalents for the env layer. `.github/workflows/catalog-drift.yml` re-runs the sync scripts weekly (and on `workflow_dispatch`), normalises the always-changing `fetchedAt` field out of the comparison, and opens a single rolling `chore/catalog-drift` PR when real content drifts. Don't run the sync scripts and commit by hand unless you have a specific reason — let the workflow drive.

**Outstanding work is tracked in [`spec/roadmap.md`](spec/roadmap.md)**, the single source of truth. When you ship something or discover new work, update there rather than scattering status across the individual specs.

If a request is ambiguous between "edit the inventory" and "edit the app," ask — both are active surfaces. (Earlier in the project the inventory was the only live work; that's no longer true.)

## Scope rule (non-obvious — read before adding entries to inventory.md)

The inventory covers **config surfaces only**: things that end up in a file on disk, an env var, or a persisted setting — plus commands that are a *path to* configuration (`/config`, `/statusline`, `claude mcp add`, `--model`).

Operational/session commands without config side-effects (`/clear`, `/compact`, `/help`, `/review`, `/init`, `claude -p`, `claude -c`, `--append-system-prompt`, etc.) are **out of scope**. The test: does it read or write a config file / setting / env var / persistent state? If no, don't add it.

Entries tagged `> [!verify]` haven't been cross-checked against live docs. Clearing those is a prerequisite for declaring the inventory canonical — verifying one is a high-value contribution.

## Tauri 2 boundaries (security model is intentional)

v1 is locked to read-only inspection. The capability surface is deliberately tiny:

- `src-tauri/capabilities/default.json` grants `core:default`, `opener:default`, and a scoped `opener:allow-open-path` (whitelist covering the user/project `.claude/` dirs, the macOS managed-prefs plist, and the per-OS managed-settings dirs — needed for the rail's path-note click-through). **Do not add `fs`, `shell`, `process`, `dialog`, or `updater` plugin permissions.** Adding a path to the `opener:allow-open-path` allowlist is an expansion of the trust surface — keep new entries as tight as the file you actually need to open, not the whole parent dir.
- File reads happen through explicit `#[tauri::command]` Rust functions registered via `tauri::generate_handler![...]`, **not** by granting the frontend filesystem-plugin permissions.
- File **watching** uses the `notify` crate from Rust and pushes `settings-changed` events to the frontend. Don't swap to `tauri-plugin-fs-watch` — that would require granting fs-watch capabilities to JS.
- Frontend calls commands via `invoke()` from `@tauri-apps/api/core`. No open-ended plugin APIs from JS.
- No write commands. No editing settings through the app. That's a v2 conversation.

The reasoning is in `spec/design-notes.md` under "Tauri 2 boundaries" and "v1 scope: locked to read-only." If a change pushes against these boundaries, surface it explicitly rather than quietly relaxing them.

## Common commands

```sh
npm install               # one-time
npm run dev               # Vite dev server only (frontend at http://localhost:1420)
npm run tauri dev         # full Tauri dev — spawns Vite + native window
npm run build             # tsc + vite build → dist/
npm run tauri build       # native installers (DMG / .msi / AppImage / etc.)
npm run preview           # serve the built dist/ for sanity checks

# Tests
npm run test:unit                      # vitest run — frontend unit tests under src/
npm run test:unit:watch                # vitest watch mode
npm test                               # node:test on scripts/sync-*.test.js
npm run test:coverage                  # node:test with coverage report
(cd src-tauri && cargo test --lib)     # Rust backend unit tests

# Catalog sync (manual)
npm run sync:settings                  # catalog/settings.json from upstream JSON Schema
npm run sync:env-vars                  # catalog/env-vars.json from upstream docs
npm run sync:hooks                     # catalog/hooks.json from upstream docs
```

Notes:

- The Vite port is **fixed at 1420** (`vite.config.ts` sets `strictPort: true`). `tauri.conf.json#build.devUrl` matches. Don't change one without the other.
- No linter or formatter wired up yet. `tsc` (via `npm run build`) is the static check; vitest + cargo test are the runtime checks.
- Rust changes in `src-tauri/` are picked up automatically by `tauri dev`; the frontend Vite watcher ignores `**/src-tauri/**`.
- Vitest hydrates the catalog from a setup file (`src/test-setup.ts`) so tests run without a Tauri runtime — see `src/lib/catalog.ts` for the production vs test seam (`loadCatalog()` vs `hydrateCatalogForTesting()`).

## Scaffold gotchas

- `spec/catalog-sync.md` references paths under `docs/sync/…` but the spec docs themselves live in `spec/`. The harness's eventual home (`docs/` vs `spec/sync/` vs elsewhere) is an open question — don't assume `docs/` exists.
- `.kilo/` is an unrelated tool's workspace (it ships its own `node_modules` and `package.json`). Treat it as opaque — don't run commands inside it or include it in repo-wide changes.

## When changing the architecture

The big choices below are deliberate and load-bearing. Don't quietly reverse them; flag the trade-off first.

- **Tauri 2, not Electron / Go-Wails / Python.** Chosen to avoid shipping a runtime to the user.
- **React + Vite + TypeScript on the frontend.** Picked for ecosystem breadth (graph views, dashboards) over TUI fidelity.
- **Catalog data flows one way: upstream docs → `catalog.json` → app.** The app does not write to `inventory.md`, and the harness does not write to `inventory.md` either — it proposes diffs that humans merge.
- **Brand:** the project is "knobs.cc"; the legal entity behind it is "Altered Craft" (two words, with a space). Don't write "AlteredCraft."
