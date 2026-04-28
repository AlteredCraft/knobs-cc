# Catalog sync harness — spec

`docs/inventory.md` is the data model knobs.cc will render. Claude Code ships frequently; the inventory will drift from upstream within days of neglect. This document specifies a harness that **harvests**, **diffs**, and **verifies** our catalog against the upstream docs, driven on cadence by the Claude Code changelog RSS feed.

Status: **spec only**. No code yet. Nothing in this doc prescribes a language or CI system.

## Goals

1. **Catch drift automatically.** Any settings field / env var / hook event / permission mode / CLI flag that appears, disappears, or changes shape in the upstream docs is surfaced as a concrete diff against our inventory.
2. **Make the inventory auditable.** Every row in `inventory.md` should be traceable to a specific line in a specific upstream doc snapshot.
3. **Stay cheap and idempotent.** Re-running the harness on an unchanged upstream is a no-op.
4. **Stay spec-stable while the project is pre-code.** A human running the harness manually in a terminal is a valid v0; CI automation is a later layer.

## Non-goals

- Parsing upstream prose for behavioural descriptions. The harness verifies *identity* (field exists, type is `string`, enum has these values) — not *semantics*.
- Deep-linking into the eventual desktop app. The harness writes static artifacts; the app reads them later (or doesn't).
- Auto-committing changes to `inventory.md`. Sync proposes; humans merge.
- Keeping third-party MCP servers / community plugins in sync — only the Claude-Code-published surface.

## Upstream sources

All are served as plain Markdown when `.md` is appended to the URL. The RSS feed drives cadence.

| URL | Role in the harness |
| --- | --- |
| `https://code.claude.com/docs/en/changelog/rss.xml` | Cadence trigger. Each `<item>` with a publish date newer than our last-synced watermark kicks off a fetch cycle. |
| `https://code.claude.com/docs/en/changelog.md` | Human-readable change log. Parsed loosely (keyword scan) to flag items that likely touched a config surface. |
| `https://code.claude.com/docs/en/settings.md` | Source of truth for §1, §2, §4, §13 of the inventory. |
| `https://code.claude.com/docs/en/env-vars.md` | Source of truth for §3. |
| `https://code.claude.com/docs/en/hooks.md` | Source of truth for §5. |
| `https://code.claude.com/docs/en/slash-commands.md` | Source of truth for §6 (user-authored commands). |
| `https://code.claude.com/docs/en/skills.md` | Source of truth for §6 (skills frontmatter). |
| `https://code.claude.com/docs/en/sub-agents.md` | Source of truth for §7. |
| `https://code.claude.com/docs/en/plugins.md`, `plugin-marketplaces.md` | Source of truth for §8. |
| `https://code.claude.com/docs/en/mcp.md` | Source of truth for §9. |
| `https://code.claude.com/docs/en/memory.md` | Source of truth for §10. |
| `https://code.claude.com/docs/en/keybindings.md` | Source of truth for §11. |
| `https://code.claude.com/docs/en/statusline.md` | Source of truth for §12. |
| `https://code.claude.com/docs/en/cli-reference.md` | Source of truth for §15. |
| `https://code.claude.com/docs/en/iam.md` | Permission-rule semantics, supplemental to §4. |
| `https://code.claude.com/docs/en/vs-code.md`, `jetbrains.md` | Source of truth for §14. |

The URL list lives in a version-controlled manifest (`docs/sync/sources.yaml` or similar) so new/moved pages can be added without touching the harness code.

## Architecture

Five phases, each producing a file committed to (or diffable against) the repo. Everything is content-addressed by the SHA of the raw Markdown, so a stable upstream yields stable outputs.

```
  1. FETCH      2. PARSE       3. NORMALIZE   4. DIFF        5. REPORT
  ─────────    ──────────    ────────────   ──────────    ──────────
  raw .md   →  structured   → canonical   →  per-section →  verify.md
  snapshot     AST-ish        catalog        delta          (or exit 1
                                                             in CI)
```

### Phase 1 — Fetch

- For each URL in the manifest, GET the `.md` endpoint with a conditional `If-None-Match` / `If-Modified-Since` where available.
- Write the raw body to `docs/sync/snapshots/<slug>.md`. These files are **committed** so diffs across syncs show up in `git log` of the repo itself.
- Record a fetch manifest `docs/sync/snapshots/manifest.json` with `{url, fetchedAt, etag, sha256}` per entry.
- The RSS feed is fetched the same way; its latest `<pubDate>` becomes the watermark written to `docs/sync/watermark.txt`.

### Phase 2 — Parse

Each source type gets a dedicated parser. Parsers are small, readable, and intentionally dumb — they extract identity, not meaning.

- `settings.md` → walk the "settings fields" table(s), yield `{name, type, validValues?, managedOnly, purpose_text}` records.
- `env-vars.md` → walk env-var tables, yield `{name, purpose_text, group?}` records.
- `hooks.md` → enumerate event names and handler types as string sets.
- `cli-reference.md` → parse flag definitions into `{flag, equivalentSetting?, acceptsArg}`.
- etc.

Each parser writes a JSON file to `docs/sync/catalog/<section>.json`.

### Phase 3 — Normalize

All per-section JSON files are merged into a single canonical catalog:

```
docs/sync/catalog/catalog.json
```

Schema (informal):

```
{
  "version": "<git sha or timestamp>",
  "fetchedAt": "<iso8601>",
  "settingsFields": [ { "name": "...", "type": "...", "managedOnly": false, ... } ],
  "envVars":        [ { "name": "...", "group": "auth", ... } ],
  "hookEvents":     [ "PreToolUse", "PostToolUse", ... ],
  "hookHandlers":   [ "command", "prompt", ... ],
  "permissionModes":[ "default", "acceptEdits", "plan", ... ],
  "cliFlags":       [ { "flag": "--model", "equivalentSetting": "model" } ],
  ...
}
```

This file is **committed**. It's the version we compare against.

### Phase 4 — Diff

Diff the new `catalog.json` against the committed one. Output categories:

- **Added** — present upstream, absent in our inventory.
- **Removed** — present in our inventory, absent upstream.
- **Changed** — same identity, different shape (type changed, new enum value, etc.).
- **Unchanged** — no-op.

A second diff pass compares `catalog.json` against claims made in `inventory.md` itself — because the inventory is hand-written prose, its claims can drift from even our own canonical catalog. Extraction from `inventory.md` uses a lightweight convention: fields listed in tables under known H2/H3 headers.

### Phase 5 — Report

Write `docs/sync/verify.md`:

```markdown
# Catalog verify report — <date>

## Upstream vs our catalog
- Added: settings.foo (string)
- Removed: settings.bar
- Changed: permissions.defaultMode — new enum value "strict"

## Our inventory vs our catalog
- inventory.md §2.1 lists `availableModels` as boolean; catalog says array. FIX.
- inventory.md §4 lists `mcpPermissions` as a field; catalog says not present. REMOVE.

## Changelog entries since last sync (<watermark>)
- 2026-04-21 — "Add skills.disable-model-invocation" → likely touches §6
- 2026-04-18 — "Rework permissions.defaultMode" → likely touches §4
```

In CI this report is the human output. Exit status is non-zero iff any diff is non-empty.

## Changelog integration

The RSS feed is the cheap signal; the full doc pages are the expensive verification.

- **Cron** (daily is plenty): fetch RSS. If no new entries since `watermark.txt`, exit.
- **On new entry**: run phases 1–5 end-to-end. Attach the report to an auto-generated issue (or a PR that bumps `catalog.json`), with the changelog snippets quoted inline so the reviewer sees "why we re-synced".
- **Keyword heuristic**: changelog items containing any of `settings`, `env`, `hook`, `permission`, `plugin`, `mcp`, `skill`, `agent`, `memory`, `CLAUDE.md`, `keybinding`, `statusline`, `sandbox`, `--<flag>`, `/<command>` are flagged as "likely touches config".
- **Changelog items without any keyword**: still trigger a full sync, but the report says "changelog touched no obvious config surface — diff should be empty".

## Repo layout the harness assumes

```
docs/
├── inventory.md               # human-authored, the thing we ship
├── catalog-sync.md            # this file
└── sync/
    ├── sources.yaml           # URL manifest, human-edited
    ├── watermark.txt          # last RSS pubDate processed
    ├── snapshots/
    │   ├── manifest.json      # fetch metadata per source
    │   ├── settings.md
    │   ├── env-vars.md
    │   └── …                  # raw .md, one per source
    ├── catalog/
    │   ├── settings-fields.json
    │   ├── env-vars.json
    │   └── …                  # per-section parsed JSON
    ├── catalog.json           # merged canonical catalog
    └── verify.md              # latest diff report
```

## Failure modes the spec must account for

1. **Upstream moves a page.** A 404 is a hard failure — the harness must not silently skip. `sources.yaml` is the place to patch the URL.
2. **Upstream removes a field without announcing it.** The diff will flag it; the verify report distinguishes "removed without changelog mention" from "removed per changelog `<x>`".
3. **Upstream changes a field's type.** Flagged as a "Changed" entry with before/after types.
4. **Upstream adds a field via prose, not a table.** Parsers are table-driven by design; prose additions leak through. Mitigation: the second pass (inventory-vs-catalog) surfaces the inverse — we claim things not in the catalog — but prose-only upstream additions will only be caught by a human reading the changelog entry. Live with it; don't try to parse prose.
5. **RSS feed changes format.** Fetch with a tolerant parser; log and keep the old watermark if parsing fails; don't throw the watermark away.
6. **Network / rate-limit transient errors.** Retry with backoff, cap at N tries, fail loudly rather than writing a partial snapshot.
7. **Upstream doc switches renderer and introduces cosmetic diff churn.** SHA-based change detection will over-trigger. Mitigation: before hashing, strip HTML entities and collapse whitespace in raw bodies.

## What the harness does NOT do

- Does not write to `inventory.md`. Sync proposes diffs; the humans who edit `inventory.md` decide whether/how to reflect them. Preserving the prose voice of the inventory matters more than automation throughput.
- Does not validate that a real Claude Code installation honours the settings described. That's a separate system — a "live probe" that reads `~/.claude/settings.json`, starts a subprocess, and introspects `/status`. Out of scope here.
- Does not publish to `knobs.cc/`. The eventual landing page and desktop app are separate renderers that may consume `catalog.json`; their build pipelines are not this harness.
- Does not replace human judgment about deprecations. If upstream removes a field, the harness flags it; we decide whether to drop it from the inventory or keep it with a "removed in v2.1.xxx" marker.

## Phasing

- **v0 (manual).** A developer runs the harness locally, inspects `verify.md`, edits `inventory.md` accordingly, commits. No CI. Stack undecided.
- **v1 (scripted).** Same behaviour, but exposed as a single command. Still no CI.
- **v2 (CI on cron).** GitHub Actions cron hits the RSS feed daily; on drift, opens a PR titled "catalog sync: <date>" with updated snapshots + `catalog.json` + `verify.md`. Humans merge.
- **v3 (alerting).** If a keyword-flagged changelog entry appears and no drift is detected after 24h, nudge a maintainer — either upstream changed prose (that our parsers miss) or our `sources.yaml` needs a new page.

The spec is intentionally silent on the implementation stack. The Tauri 2 app will use Rust at the local boundary (commands registered via `#[tauri::command]` and `generate_handler![]`), which makes Rust a strong candidate for shared catalog/parsing code, but nothing here requires that.

## Open questions

- **Where does `catalog.json` actually live?** Repo vs separate artifact branch vs GitHub Releases. Committing it into `main` means every sync is a visible diff — probably the right default, but it bloats `git log`.
- **How do we represent "deprecated but not yet removed" in the catalog?** Needs a `status` field on each record — at least `current` / `deprecated` / `removed`.
- **Do we need a second upstream — source code of Claude Code itself?** The settings doc is reliably current for documented fields, but undocumented / experimental fields exist. If we ever want to surface those, we need a different source. Defer.
- **Parsing HTML vs Markdown.** The `.md` endpoint is cleaner, but not all pages may offer it. Fall back to HTML + pandoc if needed — not today's problem.
