# Catalog sync — spec

Status: **partial implementation.** `sync-settings.js` shipped 2026-04-28; `sync-env-vars.js` shipped 2026-04-29; `sync-hooks.js` shipped 2026-04-29 (lifecycle table only — handler types and per-event input/output schemas are not yet captured); `sync-sub-agents.js` shipped 2026-05-07 (supported-frontmatter-fields table only); `sync-mcp.js` shipped 2026-05-07 (installation-scopes table only — transport types, managed-mcp.json semantics, and tool-search threshold values are not yet captured); `sync-permissions.js` shipped 2026-05-07 (permission-modes table only — rule-syntax, path-pattern, and managed-only-settings tables are not yet captured).

> Open work — new scripts, the hooks pass #2, the `read_catalog` wire-up, and the open questions at the bottom of this doc — is tracked in [`roadmap.md`](./roadmap.md).

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
├── sync-hooks.test.js
├── sync-sub-agents.js        # implemented
├── sync-sub-agents.test.js
├── sync-mcp.js               # implemented
├── sync-mcp.test.js
├── sync-permissions.js       # implemented
└── sync-permissions.test.js

catalog/
├── settings.json             # written by sync-settings.js
├── env-vars.json             # written by sync-env-vars.js
├── hooks.json                # written by sync-hooks.js
├── sub-agents.json           # written by sync-sub-agents.js
├── mcp.json                  # written by sync-mcp.js
└── permissions.json          # written by sync-permissions.js
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

### Sub-agents — implemented (frontmatter fields only)

| | |
| --- | --- |
| Source | `https://code.claude.com/docs/en/sub-agents.md` |
| Output | `catalog/sub-agents.json` (~16 entries) |
| Script | `scripts/sync-sub-agents.js` |
| Run | `npm run sync:sub-agents` |

The page documents three things: built-in subagents (Explore / Plan / general-purpose / etc.), the YAML frontmatter that defines a custom subagent, and the operational rules around tool restrictions, hooks, and model selection. Of those, only the frontmatter table (`#### Supported frontmatter fields` — `| Field | Required | Description |`) is a single canonical artifact; the built-in agents are in tabbed prose and the operational rules are scattered across `###` sections. The first cut captures the frontmatter table — every key a `~/.claude/agents/<name>.md` file's YAML can carry, with whether it's required and the prose description.

**Approach:**

1. `fetch()` the `.md` URL.
2. Locate the table by header signature `| Field | Required | Description |` (case-insensitive). The page has another 3-column table on the "Other" built-in subagents tab (`| Agent | Model | When Claude uses it |`); the header signature disambiguates.
3. For each row, extract `name` (backtick-stripped), `required` (boolean — "Yes" → `true`, anything else → `false`; upstream uses exactly those two values today), and `description` (prose, preserved verbatim including markdown links and inline code).
4. Sort by `name`, wrap with the standard envelope, write to `catalog/sub-agents.json`.

**Output shape per record:**

```json
{
  "name": "permissionMode",
  "required": false,
  "description": "[Permission mode](#permission-modes): `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, or `plan`. Ignored for [plugin subagents](#choose-the-subagent-scope)"
}
```

Pragmatic acceptance criteria: every row in the upstream frontmatter table appears in the output; `name` and `description` (the only two fields upstream marks required) are flagged `required: true`. Built-in subagent identities, model-resolution order, and per-event hook semantics are out of scope for this cut and remain candidates for follow-up work.

**Test plan:** mirror `sync-env-vars.test.js` and `sync-hooks.test.js`. Pure functions (`parseRow`, `parseTable`, `buildRecords`) get unit tests with small fixture strings; `main()` stays uncovered.

### MCP — implemented (installation scopes only)

| | |
| --- | --- |
| Source | `https://code.claude.com/docs/en/mcp.md` |
| Output | `catalog/mcp.json` (~3 entries) |
| Script | `scripts/sync-mcp.js` |
| Run | `npm run sync:mcp` |

The page is heterogeneous — it documents transport types (HTTP, SSE-deprecated, stdio), per-scope CLI flows, OAuth credential handling, `managed-mcp.json` exclusive-control + allowlist/denylist semantics, tool-search deferral thresholds, and more. Almost all of that lives under prose-heavy `###`/`####` sections rather than in canonical tables; the few tables that exist are niche (two env vars passed to dynamic-header scripts; the five `MCP_TOOL_SEARCH_DEFER_LOAD` values). The single catalog-friendly artifact is the **MCP installation scopes** table at `## MCP installation scopes` — a 4-column reference for where Local / Project / User scopes live and what they share. That's the first cut.

**Approach:**

1. `fetch()` the `.md` URL.
2. Locate the table by header signature `| Scope | Loads in | Shared with team | Stored in |` (case-insensitive). The page's other 2-column tables don't share this signature.
3. For each row, extract `name` (markdown link `[Local](#local-scope)` → `Local`, or backticks stripped from a bare `\`Local\``), `loadsIn`, `shared` (preserved verbatim — qualifier prose like "Yes, via version control" is part of the data), and `storedIn` (preserved verbatim, including code-spans on paths).
4. Sort by `name`, wrap with the standard envelope, write to `catalog/mcp.json`.

**Output shape per record:**

```json
{
  "name": "Project",
  "loadsIn": "Current project only",
  "shared": "Yes, via version control",
  "storedIn": "`.mcp.json` in project root"
}
```

Pragmatic acceptance criteria: every row in the upstream scopes table appears in the output; cell prose preserved verbatim except for the link-wrapping on the name. Transport types, managed-mcp.json semantics, OAuth flows, and tool-search threshold values are out of scope for this cut and remain candidates for follow-up work.

**Test plan:** mirror `sync-sub-agents.test.js`. Pure functions (`parseRow`, `parseTable`, `buildRecords`) get unit tests with small fixture strings; `main()` stays uncovered.

### Permissions — implemented (modes only)

| | |
| --- | --- |
| Source | `https://code.claude.com/docs/en/permissions.md` |
| Output | `catalog/permissions.json` (~6 entries) |
| Script | `scripts/sync-permissions.js` |
| Run | `npm run sync:permissions` |

The page is structurally rich — it documents the tiered tool-type taxonomy, the permission rule syntax (`Tool` / `Tool(specifier)`), wildcard semantics, tool-specific patterns (Bash, PowerShell, Read/Edit, WebFetch, MCP, Agent), the Read/Edit path-prefix table (4 patterns: `//path` / `~/path` / `/path` / `path`), the managed-only settings table (12 keys), and a working-directories table. Of those, the **`## Permission modes`** table (`| Mode | Description |`) is the single canonical artifact most directly consumable: it enumerates every value `permissions.defaultMode` accepts (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`) with prose richer than the short blurbs in the settings JSON Schema. That's the first cut.

**Approach:**

1. `fetch()` the `.md` URL.
2. Locate the table by header signature `| Mode | Description |` (case-insensitive). The page has other 2-col tables (`Rule | Effect` for rule examples, `Setting | Description` for managed-only settings, plus the 4-col `Pattern | Meaning | Example | Matches` for path syntax) — the `Mode` header disambiguates.
3. For each row, extract `name` (backtick-stripped) and `description` (prose preserved verbatim including inline code spans).
4. Sort by `name`, wrap with the standard envelope, write to `catalog/permissions.json`.

**Output shape per record:**

```json
{
  "name": "acceptEdits",
  "description": "Automatically accepts file edits and common filesystem commands (`mkdir`, `touch`, `mv`, `cp`, etc.) for paths in the working directory or `additionalDirectories`"
}
```

Pragmatic acceptance criteria: every row in the upstream modes table appears in the output; description prose preserved verbatim. The path-pattern table, managed-only-settings table, rule-syntax tables, and tool-specific patterns are out of scope for this cut and remain candidates for follow-up work — particularly the managed-only-settings table, which is the strongest candidate for a second pass since it would let the app annotate settings catalog entries with "managed-only" provenance.

**Test plan:** mirror `sync-mcp.test.js`. Pure functions (`parseRow`, `parseTable`, `buildRecords`) get unit tests with small fixture strings; `main()` stays uncovered.

## Future sources (not committed)

Each gets the same recipe: one script, one catalog file, one test file. Remaining candidates in rough priority order: `keybindings.md`, `cli-reference.md`. A second `hooks.md` pass to capture handler types and per-event input/output schemas also belongs on this list, as does a second `sub-agents.md` pass to capture built-in subagent identities, a second `mcp.md` pass to capture transport types and managed-mcp.json semantics, and a second `permissions.md` pass to capture the path-pattern and managed-only-settings tables. None are committed scope today.

## Automation

- **CI on cron — shipped.** [`.github/workflows/catalog-drift.yml`](../.github/workflows/catalog-drift.yml) runs `npm run sync:settings`, `npm run sync:env-vars`, `npm run sync:hooks`, `npm run sync:sub-agents`, `npm run sync:mcp`, and `npm run sync:permissions` every Monday at 09:00 UTC and on `workflow_dispatch`. The detect step normalises out the always-changing `fetchedAt` field before deciding whether content drifted; if only the timestamp moved, the working tree is restored to HEAD and no PR is opened. Real drift opens (or updates) a single `chore/catalog-drift` PR via `peter-evans/create-pull-request@v8` (paired with `actions/checkout@v5` and `actions/setup-node@v5` for the 2026-06-02 Node 24 cutover). Required permissions: `contents: write` + `pull-requests: write`.

## Future automation (not committed)

- **Coverage thresholds.** `--test-coverage-lines` / `--test-coverage-branches` to fail the run below a target. Premature now; reasonable when there are several scripts.

## What this spec explicitly is not

- Not a multi-phase harness with snapshots and watermarks. The earlier draft of this file proposed `docs/sync/snapshots/`, `manifest.json`, `watermark.txt`, `verify.md`, an RSS-driven trigger, and per-section then merged JSON. All cut. If we need any of that back, it's a real change request, not a defaulting-back.
- Not a write path to upstream or to `spec/inventory.md`. Catalog flows in one direction: upstream → script → `catalog/<source>.json` → app.
- Not a substitute for human review. The catalog is the *current* upstream truth; whether to surface a new field, hide a deprecated one, or annotate a quirk is a UI decision in the Tauri app, not a sync concern.

## Open questions

- **`spec/inventory.md`'s future.** Once `catalog/settings.json` and `catalog/env-vars.json` exist, the sections of `inventory.md` they cover are largely redundant. Decision deferred — but the inventory's hand-edited prose is *not* something this harness should try to regenerate.
- **`$ref` resolution.** `catalog/settings.json` preserves `$ref` strings (`#/$defs/permissionRule`) without expanding them. If a consumer needs the resolved schema (e.g. to validate a permission-rule string), we can either expand at sync time or expose `$defs` as a sibling block in the envelope.
- **Schema staleness signal.** `json.schemastore.org/claude-code-settings.json` has no embedded version or `updated` timestamp. If we want change-detection beyond "did the file content differ," ETag or content hash on fetch is the obvious move.
