# knobs.cc

A local desktop inspector for every knob Claude Code gives you — where it lives, what it's set to, and which layer wins.

## Status

**Concept — no release yet.** Domain acquired 2026-04-24.

No app code, no release, no install path yet. The repo currently holds:

- [`spec/inventory.md`](spec/inventory.md) — working inventory of Claude Code's configuration surface.
- [`spec/catalog-sync.md`](spec/catalog-sync.md) — spec for the harness that keeps the inventory in sync with upstream docs (RSS-driven, no code yet).
- [`spec/design-notes.md`](spec/design-notes.md) — open questions (stack, hero screen, landing page).

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

1. ✅ Domain acquired
2. ✅ Repo bootstrapped, inventory doc seeded
3. ✅ Catalog-sync harness spec drafted ← *you are here*
4. ✅ Verify inventory against current docs (entries tagged `[!verify]`)
5. ⬜ Implement catalog-sync harness v0 (manual, per spec)
6. ✅ Pick app stack: Tauri 2 + TypeScript/Vite + Rust backend
7. ✅ Scaffold the Tauri 2 app shell via `create-tauri-app` (React + TypeScript + Vite template)
8. ⬜ Sketch the desktop dashboard/search/detail flow
9. ⬜ Minimal prototype with explicit Tauri 2 commands (`read_settings_layers`, `read_env_snapshot`, `read_catalog`) registered via `invoke_handler`, with a minimal capability file in `src-tauri/capabilities/`
10. ⬜ Landing page at knobs.cc

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

```sh
npm test                 # run the unit test suite (Node's built-in test runner)
npm run test:coverage    # run tests with a per-file coverage report
```

The catalog-sync script (`scripts/sync-settings.js`) is the only code under test today; its `main()` function (network fetch + filesystem write) is intentionally excluded from coverage.

## Contributing

Early days — not accepting code PRs yet. If you've spotted a Claude Code knob the inventory is missing or has wrong, please open an issue. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](LICENSE).