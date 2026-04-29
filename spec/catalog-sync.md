# Catalog sync — spec

Status: **partial implementation.** `sync-settings.js` shipped 2026-04-28; `sync-env-vars.js` shipped 2026-04-29; `sync-hooks.js` shipped 2026-04-29 (lifecycle table only — handler types and per-event input/output schemas are not yet captured).

## Intent

Every Claude Code config surface (settings, env vars, hooks, MCP, …) has an authoritative upstream representation — usually a docs page, sometimes a JSON Schema. For each surface we want a small, idempotent script that pulls that upstream form and reshapes it into a flat JSON file the desktop app consumes via its planned `read_catalog` Tauri command.

This spec replaces a deliberately heavier earlier draft (5-phase harness, snapshot files, RSS-driven cadence, diff/report artifacts). That elaborate design isn't worth the carry cost while the project is pre-release. Git is a perfectly good diff tool; PR review is a perfectly good change report.

## Design principles

- **One script per upstream source.** Independent, runnable solo, easy to delete or replace.
- **Stdlib only where possible.** Node's built-in `fetch`, `node:test`, and `--experimental-test-coverage` cover the work. No new deps unless a parser genuinely needs one.
- **The output is the contract.** Each script produces `catalog/<source>.json` with a flat array of records under a small envelope (`{ source, fetchedAt, count, <records> }`).
- **Idempotent.** Re-running on unchanged upstream produces a one-line diff (`fetchedAt` only). Records are sorted by a stable key.
- **Reshape on the way in, not on the way out.** Flatten nested schemas to dotted-key rows, drop fields the consumer doesn't use. The committed catalog should be ergonomic for the UI even if the upstream form isn't.
- **Provenance is part of the data.** `source` URL and `fetchedAt` timestamp ride with every catalog file.
- **Git is the diff tool.** No watermarks, no snapshots, no `verify.md` artifact. PR review surfaces drift.

## Repo layout

```
scripts/
├── sync-settings.js          # implemented
├── sync-settings.test.js     # 15 tests, ~93% branch coverage
├── sync-env-vars.js          # implemented
├── sync-env-vars.test.js
├── sync-hooks.js             # implemented
└── sync-hooks.test.js

catalog/
├── settings.json             # written by sync-settings.js
├── env-vars.json             # written by sync-env-vars.js
└── hooks.json                # written by sync-hooks.js
```

## Sources

### Settings — implemented

| | |
| --- | --- |
| Source | `https://json.schemastore.org/claude-code-settings.json` |
| Output | `catalog/settings.json` (~155 entries) |
| Script | `scripts/sync-settings.js` |
| Run | `npm run sync:settings` |

**Why the JSON Schema, not `settings.md`:** the schemastore document has explicit `type`, `default`, `enum`, `description`, and recursive `properties` for object-typed settings (`permissions`, `sandbox`, `statusLine`, …). The markdown page buries those in a 3-column `Key | Description | Example` table where defaults and enum values live in prose and types must be inferred from the example. The schema is a higher-fidelity source for the same data.

**Output shape per record:**

```json
{
  "key": "permissions.defaultMode",
  "type": "string",
  "enum": ["acceptEdits", "bypassPermissions", "default", "delegate", "dontAsk", "plan", "auto"],
  "description": "..."
}
```

Nested object schemas are flattened: `permissions` and `permissions.defaultMode` are sibling rows. A small allowlist of fields (`type`, `const`, `enum`, `default`, `minimum`, `maximum`, `pattern`, `examples`, `description`, `$ref`, `anyOf`/`oneOf`/`allOf`, plus a recursive summary of `items` for arrays) is preserved; everything else is dropped to keep upstream JSON Schema metadata churn out of the catalog.

### Env vars — implemented

| | |
| --- | --- |
| Source | `https://code.claude.com/docs/en/env-vars.md` |
| Output | `catalog/env-vars.json` (~215 entries) |
| Script | `scripts/sync-env-vars.js` |
| Run | `npm run sync:env-vars` |

No JSON Schema sibling exists, so the script parses the markdown directly. The page is structurally simple: one 2-column table (`Variable | Purpose`) covering all variables. Defaults, ranges, and constraints are *not* in a dedicated column — they're embedded as prose inside Purpose (`default: 600000, or 10 minutes; maximum: 2147483647`).

**Approach:**

1. `fetch()` the `.md` URL.
2. Parse the markdown table. Hand-rolled is fine — the page is one table with backtick-wrapped names in column 1 and free-form prose in column 2. Reach for a markdown parser only if the page structure changes.
3. For each row, extract `name`, `purpose`, and a best-effort `default` (regex `default: (\S+)` from the purpose text — record `null` when not present rather than guessing).
4. Sort by `name`, wrap with the standard envelope, write to `catalog/env-vars.json`.

**Output shape per record:**

```json
{
  "name": "API_TIMEOUT_MS",
  "purpose": "Timeout for API requests in milliseconds — default: 600000, or 10 minutes; maximum: 2147483647",
  "default": "600000"
}
```

Pragmatic acceptance criteria: every row in the upstream table appears in the output; defaults extracted when present; no entry silently dropped. Lossy parsing (e.g. for vars whose purpose mentions multiple numbers) is acceptable as long as raw `purpose` is preserved verbatim — the consumer can re-parse if needed.

**Test plan:** mirror `sync-settings.test.js`. Pure functions (table parser, default extractor) get unit tests with small fixture strings; `main()` stays uncovered.

### Hooks — implemented (lifecycle table only)

| | |
| --- | --- |
| Source | `https://code.claude.com/docs/en/hooks.md` |
| Output | `catalog/hooks.json` (~29 entries) |
| Script | `scripts/sync-hooks.js` |
| Run | `npm run sync:hooks` |

The page documents far more than just the event list — handler types (`command`, `http`, `mcp_tool`, `prompt`, `agent`), per-event input schemas, decision-control fields, exit-code semantics, and matcher rules — but those live under prose-heavy `###`/`####` sections, not in a single canonical table. The first cut captures only the lifecycle summary table (`| Event | When it fires |`) at the top of the page, which is the smallest useful artifact and the natural parallel to env-vars.

**Approach:**

1. `fetch()` the `.md` URL.
2. Locate the lifecycle table by header signature `| Event | When it fires |` (case-insensitive). The page has other tables whose first column header is "Event" — the second column disambiguates.
3. For each row, extract `name` (backtick-stripped) and `when` (cadence prose, preserved verbatim).
4. Sort by `name`, wrap with the standard envelope, write to `catalog/hooks.json`.

**Output shape per record:**

```json
{
  "name": "PreToolUse",
  "when": "Before a tool call executes. Can block it"
}
```

Pragmatic acceptance criteria: every row in the upstream lifecycle table appears in the output; cadence prose preserved verbatim. Handler types and per-event JSON schemas are out of scope for this cut and remain candidates for follow-up work.

**Test plan:** mirror `sync-env-vars.test.js`. Pure functions (`parseRow`, `parseTable`, `buildRecords`) get unit tests with small fixture strings; `main()` stays uncovered.

## Future sources (not committed)

Each gets the same recipe: one script, one catalog file, one test file. Likely candidates in rough priority order: `mcp.md`, `sub-agents.md`, `permissions` doc, `keybindings.md`, `cli-reference.md`. A second `hooks.md` pass to capture handler types and per-event input/output schemas also belongs on this list. None are committed scope today.

## Future automation (not committed)

- **CI on cron.** A GitHub Actions workflow could run `npm run sync:settings && npm run sync:env-vars && npm run sync:hooks` on a schedule and open a PR when `catalog/` changes. Cheap to add when there's a reason; nothing about the current scripts blocks it.
- **Coverage thresholds.** `--test-coverage-lines` / `--test-coverage-branches` to fail the run below a target. Premature now; reasonable when there are several scripts.

## What this spec explicitly is not

- Not a multi-phase harness with snapshots and watermarks. The earlier draft of this file proposed `docs/sync/snapshots/`, `manifest.json`, `watermark.txt`, `verify.md`, an RSS-driven trigger, and per-section then merged JSON. All cut. If we need any of that back, it's a real change request, not a defaulting-back.
- Not a write path to upstream or to `spec/inventory.md`. Catalog flows in one direction: upstream → script → `catalog/<source>.json` → app.
- Not a substitute for human review. The catalog is the *current* upstream truth; whether to surface a new field, hide a deprecated one, or annotate a quirk is a UI decision in the Tauri app, not a sync concern.

## Open questions

- **`spec/inventory.md`'s future.** Once `catalog/settings.json` and `catalog/env-vars.json` exist, the sections of `inventory.md` they cover are largely redundant. Decision deferred — but the inventory's hand-edited prose is *not* something this harness should try to regenerate.
- **`$ref` resolution.** `catalog/settings.json` preserves `$ref` strings (`#/$defs/permissionRule`) without expanding them. If a consumer needs the resolved schema (e.g. to validate a permission-rule string), we can either expand at sync time or expose `$defs` as a sibling block in the envelope.
- **Schema staleness signal.** `json.schemastore.org/claude-code-settings.json` has no embedded version or `updated` timestamp. If we want change-detection beyond "did the file content differ," ETag or content hash on fetch is the obvious move.
