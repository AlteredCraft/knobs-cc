# Contributing

knobs.cc is in early development. The Tauri 2 app shell has been scaffolded (React + TypeScript + Vite frontend, Rust backend), but no custom Tauri commands or UI have been implemented yet. The project is still in concept phase — see `spec/` for the working inventory of Claude Code's configuration surface and the catalog-sync harness design.

## What's useful right now

- **Corrections to the inventory.** Entries tagged `> [!verify]` are places we're least confident. If you've tested a knob and can confirm the behaviour, file an issue or PR against `spec/inventory.md`.
- **Missing knobs.** If you know of a Claude Code configuration surface — env var, setting, hook event, IDE quirk — that's absent from the inventory, file an issue.
- **Design input.** Opinions on app stack, hero flow, how to represent hook graphs, etc. belong in issues tagged `design`.

## What's not useful yet

Code PRs. The prototype milestone hasn't been reached — the Tauri 2 scaffold is in place but no app-specific functionality has been built. If you're excited to contribute, watch the repo for the prototype milestone.

## Ground rules

- Be respectful. This is a community, spare-time project, not an Anthropic one.
- Keep issues specific. "It would be cool if…" belongs in Discussions (when we turn them on); bug-shaped feedback belongs in Issues.