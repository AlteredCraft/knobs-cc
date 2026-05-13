# Contributing

knobs.cc is in pre-release. The Tauri 2 desktop inspector runs end-to-end via `npm run tauri dev` — settings-precedence rendering, a session picker that grounds the inspector against a running `claude` process (or a picked project directory), per-leaf provenance, per-element waterfall for array-merged paths, and a sibling EnvVarsPanel with attached/shell diff. No signed installer yet.

## What's useful right now

- **Corrections to the inventory.** Entries tagged `> [!verify]` are places we're least confident. If you've tested a knob and can confirm the behaviour, file an issue or PR against `spec/inventory.md`.
- **Missing knobs.** If you know of a Claude Code configuration surface — env var, setting, hook event, IDE quirk — that's absent from the inventory, file an issue.
- **Inspector bugs / UX feedback.** Run `npm run tauri dev`, attach to a session, file what feels off.
- **Design input.** Opinions on hero flow, how to represent hook graphs, goals view, landing page, etc. belong in issues tagged `design`.

## What's not useful yet

Substantial code PRs without an issue first — let's discuss the shape before you write it. The roadmap in `spec/roadmap.md` is the source of truth for what's slated and what's deferred.

## Ground rules

- Be respectful. This is a community, spare-time project, not an Anthropic one.
- Keep issues specific. "It would be cool if…" belongs in Discussions (when we turn them on); bug-shaped feedback belongs in Issues.