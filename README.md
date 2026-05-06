# knobs.cc

A local desktop inspector for every knob Claude Code gives you — where it lives, what it's set to, and which layer wins.

## Status

**Concept — no release yet.** Domain acquired 2026-04-24. No installer
or signed build, but the read-only inspector runs end-to-end via
`npm run tauri dev`.

The repo holds three working surfaces:

- **The Tauri 2 app.** `src/` (React/Vite/TypeScript Inspector UI) and
  `src-tauri/` (Rust backend with the read-only `read_settings_layers`
  and `read_catalog` Tauri commands). Five settings layers (managed /
  env / project_local / project / user), per-leaf provenance, and
  per-element waterfall for array-merged fields like `permissions.allow`.
- **The specs.** [`spec/roadmap.md`](spec/roadmap.md) is the single
  source of truth for what's shipped vs pending. Other live specs:
  [`spec/inventory.md`](spec/inventory.md) (every Claude Code knob),
  [`spec/settings-display.md`](spec/settings-display.md) (backend
  phases), [`spec/inspector-ui.md`](spec/inspector-ui.md) (UI spec —
  visual reference at [`mocks/01-inspector.html`](mocks/01-inspector.html)),
  [`spec/catalog-sync.md`](spec/catalog-sync.md), and
  [`spec/design-notes.md`](spec/design-notes.md).
- **The catalog harness.** `scripts/sync-{settings,env-vars,hooks}.js`
  pull upstream JSON Schema and docs into `catalog/*.json`, which the
  app consumes through `read_catalog`.

## Premise

Claude Code has a sprawling surface area of configuration: settings files (`~/.claude/settings.json`, project `.claude/settings.json`, local overrides, enterprise-managed), environment variables, permission modes, hooks, slash commands, MCP servers, plugins, skills, subagents, memory files, keybindings, statusline, IDE integrations. Discovering what's available, what's set in the current environment, and where each value is coming from (global vs project vs env var vs default) is hard.

knobs.cc is a Tauri 2 desktop app that lays it all out:

- What Claude Code **can** be configured with
- What **is** configured in the current environment
- **Where** each knob's value is coming from (user / project / local / managed / env var / CLI flag / default)

## Positioning

- **Audience**: Claude Code power users and devs setting up teams.
- **Form**: Tauri 2 desktop app — graphical local inspector with a TypeScript/Vite frontend and a narrow Rust backend for filesystem/env reads.
- **Relationship to Anthropic**: third-party, community-built. Not "Claude-" prefixed, not endorsed.
- **Distribution**: OSS desktop installers via Tauri 2 (DMG / macOS Application Bundle, Windows Installer (.msi / NSIS), AppImage / Debian / RPM). Signing, notarization, and auto-update come after the first working build.
- **v1 scope**: **read-only inspection** only. Editing settings through the app is out of scope for v1.

## Roadmap

[`spec/roadmap.md`](spec/roadmap.md) is the live tracker. High-level
snapshot:

1. ✅ Domain acquired
2. ✅ Repo bootstrapped, inventory doc seeded
3. ✅ Catalog-sync harness spec drafted
4. ✅ Verify inventory against current docs
5. ✅ Catalog-sync harness v0 — `scripts/sync-{settings,env-vars,hooks}.js`
6. ✅ Pick app stack: Tauri 2 + TypeScript/Vite + Rust backend
7. ✅ Scaffold the Tauri 2 app shell
8. ✅ Inspector UI sketched
   ([`mocks/01-inspector.html`](mocks/01-inspector.html),
   [`spec/inspector-ui.md`](spec/inspector-ui.md))
9. ✅ Tauri 2 commands shipped — `read_settings_layers` (managed,
   env, project_local, project, user; per-leaf provenance;
   array-merge for permissions-style fields) and `read_catalog`. The
   capability file is kept minimal (`core:default` + `opener:default`).
   `read_env_snapshot` was folded into `read_settings_layers` as the
   `env` layer rather than shipping as a separate command.
10. ⬜ Landing page at knobs.cc

Inspector polish, OS-policy managed sources, and the file watcher
remain — see [`spec/roadmap.md`](spec/roadmap.md).

## Running knobs.cc

```sh
npm install            # install frontend dependencies
npm run tauri dev      # launch the app in development mode
```

The frontend Vite dev server runs on port 1420 (fixed). The Rust backend is compiled on the fly by `tauri dev`; changes to `src-tauri/` are picked up automatically.

```sh
npm run build          # type-check + build the frontend
npm run tauri build    # build a native installer (DMG / .msi / AppImage)
```

## Tests

Three suites live in this repo:

```sh
npm run test:unit                    # vitest run — frontend (src/)
npm run test:unit:watch              # vitest watch mode
npm test                             # node:test on scripts/sync-*.test.js
npm run test:coverage                # node:test with coverage report
(cd src-tauri && cargo test --lib)   # Rust backend unit tests
```

`main()` in the catalog-sync scripts (network fetch + filesystem
write) is intentionally excluded from coverage.

## Contributing

Early days — not accepting code PRs yet. If you've spotted a Claude Code knob the inventory is missing or has wrong, please open an issue. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](LICENSE).