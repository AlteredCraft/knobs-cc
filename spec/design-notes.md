# Design notes

Open questions carried from the concept phase. This file is a scratchpad — expect it to churn.

> Open items that have a place in the implementation roadmap (Goals view, cross-cutting surfaces, landing page, nomenclature) are tracked in [`roadmap.md`](./roadmap.md). The deeper rationale stays here.

## Ideas...

- User could express a 'Goal' : I want to make Claude faster, I want to reduce token usage.
- Configs could have attributes we assign to them: "performance", "cost", "quality". User could then ask "show me all the knobs that affect performance" or "what are the cost-saving knobs I can turn?" Use emojis for quick scanning: ⚡️ for performance, 💰 for cost, 🎯 for quality.

## App stack decision

Decision: build knobs.cc as a Tauri 2 desktop app.

Default stack:

| Layer | Choice | Notes |
| --- | --- | --- |
| App shell | Tauri 2 | Lightweight desktop packaging using system webview (WebView2/WebKitGTK/WKWebView). Commands registered via `invoke_handler` with permissions controlled by the capability system (`src-tauri/capabilities/`). |
| Frontend | TypeScript + Vite + React | Fast iteration, broad UI ecosystem, enough room for custom dashboards, filters, and graph views. |
| Backend | Rust Tauri 2 commands | Narrow local operations: read Claude config files, inspect env vars, resolve precedence, and expose typed data to the UI. Functions are annotated with `#[tauri::command]`, registered via `generate_handler![]`, and invoked from the frontend via `invoke()` from `@tauri-apps/api/core`. Access to `AppHandle`, managed `State<T>`, and window handles via Tauri 2's injection system. |
| Catalog | `docs/sync/catalog.json` | Canonical generated artifact consumed by the app once the sync harness exists. |

Why not a TUI for v1:

- The product needs graphical affordances for source precedence chains, hook graphs, MCP state, warnings, search facets, and detail panes.
- Terminal graphics would make real knobs, graphs, and canvas-like interactions depend on fragile terminal protocols.
- Tauri still gives a normal local install path while avoiding Go, Python, or Node as a user runtime.

A CLI/TUI companion can still exist later, but it should reuse the same catalog and resolution logic rather than drive the initial product shape.

## Tauri 2 boundaries

v1 should keep the desktop security model tight:

- No write commands — v1 is read-only by design.
- No `fs` plugin — file reads are done via explicit Rust commands, not by granting the frontend filesystem plugin permissions.
- No `shell` plugin — no shell execution permitted.
- No `updater` plugin until signing and release flow are stable.
- Expose explicit commands (`read_settings_layers`, `read_env_snapshot`, `read_catalog`) registered via `generate_handler![]` instead of granting generic file access.
- Capability files in `src-tauri/capabilities/` (`default.json` for cross-platform plus per-OS files `default-macos.json` / `default-linux.json` / `default-windows.json` gated via `platforms`) grant only `core:default` + `opener:default` + a tightly-scoped `opener:allow-open-path` — no `fs`, `shell`, or `updater`. The per-OS split is load-bearing: Tauri compiles every glob on every target, and a Windows backslash pattern (`C:\Program Files\…\**`) fails to compile on macOS/Linux unless gated.

## Security model (Tauri 2 capabilities)

Tauri 2 permissions are managed through capability files (`src-tauri/capabilities/<id>.json`). For v1:

- The default capability file grants `core:default` + `opener:default` plus a scoped `opener:allow-open-path` whitelist for the path-notes click-through. Platform-specific managed-tier paths live in sibling capability files gated by `platforms` (split because Tauri compiles every scope glob on every target — a Windows backslash pattern in a shared file fails to compile on macOS/Linux).
- No `fs`, `shell`, `process`, `dialog`, or `updater` plugin permissions.
- Our Rust commands (`#[tauri::command]`) are registered in the builder via `invoke_handler(tauri::generate_handler![...])`.
- The frontend calls commands through `@tauri-apps/api/core` (`invoke`), not through open-ended plugin APIs.

## v1 scope: locked to read-only

v1 is an inspector, not an editor. Explicit non-goals:

- No writing to `~/.claude/settings.json` or project settings.
- No enabling/disabling plugins through the app.
- No permission-rule editor.

Rationale: the failure modes of writing to hand-edited JSON files (merge surprises, lost comments, corruption) are much more expensive than the failure modes of a read-only viewer. Editing can land in v2 once the mental model of the data is solid.

## Desktop hero flow

What's the first view a user sees when they open knobs.cc? Candidate framings:

1. **Status dashboard.** One screen answers "am I set up sanely?" — model, permission mode, active hooks count, MCP server count, plugin count, warnings for unusual settings. Strength: actionable. Weakness: opinionated about what "sane" means.
2. **Search-first catalog.** Global search plus filters for settings, env vars, hooks, MCP, plugins, skills, subagents, and CLI flags. Strength: fast path for known knobs. Weakness: less useful for first-time discovery.
3. **Source-aware detail pane.** Selecting a knob shows resolved value, winning layer, shadowed layers, docs context, and related knobs. Strength: directly explains "why is this value active?" Weakness: depends on strong data modeling.
4. **Topology views.** Hook graphs, plugin-contributed surfaces, and MCP server state use visual layout instead of terminal approximations. Strength: uses the desktop format well. Weakness: more custom UI work.

**Decision (2026-05-03):** the v1 hero is a combined **search-first + source-aware** view, captured as the Inspector spec at [`inspector-ui.md`](./inspector-ui.md) (mocked in `mocks/01-inspector.html`). It folds #2 and #3 into one three-pane layout: rail, list, drawer. #4 stays separate (hooks/MCP get their own surfaces later). #1 is reframed as the deferred Goals view below.

## Goals view (deferred)

Captured here so the idea isn't lost. Mocked at `mocks/03-goals.html`.

The "user-intent" framing from the *Ideas...* section above — `⚡ make Claude faster`, `💰 reduce token usage`, `🛡 stay safe`, etc. — works as a *first-run* and *discovery* surface that the Inspector doesn't serve well. Each card groups the knobs that affect a goal, shows their current values with provenance, and adds a one-line hint per knob explaining why it matters for that goal.

Reasons to defer past v1:

- Requires curation: somebody has to decide which knobs belong to which goal, and what the per-knob hints say. Best done after the catalog-sync harness produces structured `catalog.json` so goals can be expressed as tags on entries rather than a parallel hand-edited list.
- Inspector and Goals serve different users; shipping both at once doubles the surface area without sharpening the value of either. Build the Inspector first; revisit Goals as a `?goal=speed`-style entry point that hands off to the Inspector for the deep dive.

Worth keeping warm: the goal taxonomy itself (speed / cost / safety / quality / privacy / hooks) is a useful organising idea even before there's a Goals surface — it could tag entries in `inventory.md` so the eventual harness has structured data to draw on.

## Representing cross-cutting surfaces

Some knobs don't fit a single flat list:

- **Hook graphs** — a PreToolUse hook on `Bash` with a command handler that calls a separate script. How do you show the event → matcher → handler → side-effect chain?
- **Plugin hierarchies** — a plugin contributes commands, skills, agents, hooks, MCP servers all at once. Group by plugin, or interleave into the normal category views?
- **MCP server state** — connected / disconnected / erroring; tool list per server. More than a static config view — runtime info too.
- **Precedence conflicts** — when a setting is defined in multiple layers, show the resolved value *and* the shadow chain.

## Landing page

`knobs.cc/` currently has nothing behind it. What does it show before there's a release?

Options:

- **Placeholder.** One-line pitch + GitHub link + "coming soon".
- **Live inventory.** Render `docs/inventory.md` as a styled static site. Turns the pre-release period into something useful.
- **Signup.** Email capture for launch notifications.

Leaning toward **live inventory** — the research we're doing has standalone value and doubles as SEO for the eventual desktop app.

## Open nomenclature questions

- Is "knob" the right metaphor? It's concrete (every setting is a dial) but arguably cute. Alternatives: "settings," "options," "controls." Keeping "knob" for now because the domain is `knobs.cc`.
- "Surface" vs "category" vs "group" for the top-level taxonomy — inventory uses "category"; the desktop app might benefit from a different word.
