# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

knobs.cc is a **Tauri 2 desktop app** (concept phase, no release) that inspects Claude Code's configuration: what knobs exist, what's currently set, and which layer wins. v1 is **read-only**.

The repo currently holds two distinct things, and conflating them is the most common mistake:

1. **`spec/`** — the live deliverable right now. `inventory.md` (the catalog of every Claude Code config surface) and `catalog-sync.md` (a spec for the harness that keeps it in sync with upstream docs). Both are hand-edited prose; the catalog-sync harness is **spec only — no code yet**.
2. **The Tauri 2 scaffold** (`src/`, `src-tauri/`) — the bare `create-tauri-app` template (React + TypeScript + Vite + Rust). The current "greet" command is boilerplate; the planned commands are `read_settings_layers`, `read_env_snapshot`, `read_catalog`. None of those exist yet.

If a request is ambiguous between "edit the inventory" and "edit the app," ask. The inventory has far more activity than the app right now.

## Scope rule (non-obvious — read before adding entries to inventory.md)

The inventory covers **config surfaces only**: things that end up in a file on disk, an env var, or a persisted setting — plus commands that are a *path to* configuration (`/config`, `/statusline`, `claude mcp add`, `--model`).

Operational/session commands without config side-effects (`/clear`, `/compact`, `/help`, `/review`, `/init`, `claude -p`, `claude -c`, `--append-system-prompt`, etc.) are **out of scope**. The test: does it read or write a config file / setting / env var / persistent state? If no, don't add it.

Entries tagged `> [!verify]` haven't been cross-checked against live docs. Clearing those is a prerequisite for declaring the inventory canonical — verifying one is a high-value contribution.

## Tauri 2 boundaries (security model is intentional)

v1 is locked to read-only inspection. The capability surface is deliberately tiny:

- `src-tauri/capabilities/default.json` grants only `core:default` + `opener:default`. **Do not add `fs`, `shell`, `process`, `dialog`, or `updater` plugin permissions.**
- File reads happen through explicit `#[tauri::command]` Rust functions registered via `tauri::generate_handler![...]`, **not** by granting the frontend filesystem-plugin permissions.
- Frontend calls commands via `invoke()` from `@tauri-apps/api/core`. No open-ended plugin APIs from JS.
- No write commands. No editing settings through the app. That's a v2 conversation.

The reasoning is in `spec/design-notes.md` under "Tauri 2 boundaries" and "v1 scope: locked to read-only." If a change pushes against these boundaries, surface it explicitly rather than quietly relaxing them.

## Common commands

```sh
npm install               # one-time
npm run dev               # Vite dev server only (frontend at http://localhost:1420)
npm run tauri dev         # full Tauri dev — spawns Vite + native window
npm run build             # tsc --noEmit + vite build → dist/
npm run tauri build       # native installers (DMG / .msi / AppImage / etc.)
npm run preview           # serve the built dist/ for sanity checks
```

Notes:

- The Vite port is **fixed at 1420** (`vite.config.ts` sets `strictPort: true`). `tauri.conf.json#build.devUrl` matches. Don't change one without the other.
- No test runner, linter, or formatter is wired up yet. `tsc` (via `npm run build`) is the only static check.
- Rust changes in `src-tauri/` are picked up automatically by `tauri dev`; the frontend Vite watcher ignores `**/src-tauri/**`.

## Scaffold gotchas

- `spec/catalog-sync.md` references paths under `docs/sync/…` but the spec docs themselves live in `spec/`. The harness's eventual home (`docs/` vs `spec/sync/` vs elsewhere) is an open question — don't assume `docs/` exists.
- `.kilo/` is an unrelated tool's workspace (it ships its own `node_modules` and `package.json`). Treat it as opaque — don't run commands inside it or include it in repo-wide changes.

## When changing the architecture

The big choices below are deliberate and load-bearing. Don't quietly reverse them; flag the trade-off first.

- **Tauri 2, not Electron / Go-Wails / Python.** Chosen to avoid shipping a runtime to the user.
- **React + Vite + TypeScript on the frontend.** Picked for ecosystem breadth (graph views, dashboards) over TUI fidelity.
- **Catalog data flows one way: upstream docs → `catalog.json` → app.** The app does not write to `inventory.md`, and the harness does not write to `inventory.md` either — it proposes diffs that humans merge.
- **Brand:** the project is "knobs.cc"; the legal entity behind it is "Altered Craft" (two words, with a space). Don't write "AlteredCraft."
