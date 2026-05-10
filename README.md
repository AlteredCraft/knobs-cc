# knobs.cc

A local desktop inspector for every knob Claude Code gives you — where it lives, what it's set to, and which layer wins.

![knobs.cc inspector showing the precedence rail, settings list, and key drawer](spec/screenshot.png)

## Status

**Pre-release.** The read-only inspector runs end-to-end via
`npm run tauri dev`. No signed installer or auto-update yet.

Two known gaps in the precedence rail are tracked openly: the `cli`
slot stays empty because knobs.cc can't read another process's flags
([#11](https://github.com/AlteredCraft/knobs-cc/issues/11)), and the
`project` / `project_local` rows resolve relative to knobs.cc's own
working directory rather than a chosen claude session, so they're
greyed out in the rail
([#12](https://github.com/AlteredCraft/knobs-cc/issues/12)). The
managed / env / user / default layers are unaffected.

## Premise

Claude Code has a sprawling configuration surface: settings files
(`~/.claude/settings.json`, project `.claude/settings.json`, local
overrides, enterprise-managed), environment variables, permission
modes, hooks, slash commands, MCP servers, plugins, skills, subagents,
memory files, keybindings, statusline, IDE integrations. Discovering
what's available, what's set in the current environment, and where
each value comes from (global vs project vs env var vs default) is
hard.

knobs.cc lays it all out in one place:

- What Claude Code **can** be configured with
- What **is** configured in the current environment
- **Where** each value is coming from (user / project / local /
  managed / env var / CLI flag / default)

Live updates are wired in: when a watched settings file changes on
disk the snapshot refreshes automatically.

## Positioning

- **Audience.** Claude Code power users and devs setting up teams.
- **Form.** Tauri 2 desktop app — a graphical local inspector with a
  TypeScript/Vite frontend and a narrow Rust backend for filesystem
  and env reads.
- **Relationship to Anthropic.** Third-party, community-built. Not
  "Claude-" prefixed, not endorsed.
- **Distribution.** OSS desktop installers via Tauri 2 (DMG / macOS
  Application Bundle, Windows Installer (.msi / NSIS),
  AppImage / Debian / RPM). Signing, notarization, and auto-update
  come after the first signed build.
- **v1 scope.** Read-only inspection only. Editing settings through
  the app is out of scope for v1.

## Repo layout

Three coordinated surfaces:

- **The Tauri 2 app.** `src/` (React/Vite/TypeScript Inspector UI) and
  `src-tauri/` (Rust backend with the read-only `read_settings_layers`
  and `read_catalog` Tauri commands). Five settings layers (managed /
  env / project_local / project / user), per-leaf provenance, and
  per-element waterfall for array-merged fields like
  `permissions.allow`. The managed tier reads the macOS
  `com.anthropic.claudecode` MDM plist when present and falls back to
  the file-based source otherwise.
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

## Running knobs.cc

```sh
npm install            # install frontend dependencies
npm run tauri dev      # launch the app in development mode
```

The frontend Vite dev server runs on port 1420 (fixed). The Rust
backend is compiled on the fly by `tauri dev`; changes to
`src-tauri/` are picked up automatically.

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

CI runs the same suites on Linux, macOS, and Windows for every push
and pull request — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Contributing

Early days — not accepting code PRs yet. If you've spotted a Claude
Code knob the inventory is missing or has wrong, please open an
issue. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](LICENSE).
