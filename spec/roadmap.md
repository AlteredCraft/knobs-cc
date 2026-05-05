# Roadmap

Single source of truth for open work across `spec/`. Each item points back
at the originating spec section for rationale and shape — this file only
tracks what's outstanding.

If you ship something, mark it ✅ here and (where relevant) update the
corresponding spec section. If you discover new work, add it here, not
inline in another spec.

Last reviewed: 2026-05-05.

---

## Settings layers — `settings-display.md`

Phase numbering matches the spec.

- **Phase 2 — file-based managed sources.** Read `managed-settings.json`,
  alphabetic merge of `managed-settings.d/*.json`, surface as `managed`
  layer. Sibling read of `managed-mcp.json`. (`settings-display.md` §
  "Phase 2".)
- **Phase 3 — env vars + array-merge.** ✅ shipped 2026-05-05.
  Phase 3a: array-concat-dedup with per-element provenance for the known
  array-merged paths; `array-merged` chip activated.
  Phase 3b: `env` layer reads process env via the hand-curated mapping at
  `catalog/env-settings-map.json` (eight v1 mappings — `ANTHROPIC_MODEL`,
  `CLAUDE_CODE_*`). Mapping is extensible by JSON edit; future PR can
  migrate to a description-prose-derived `env` field on each settings
  catalog entry once upstream schema gains structured metadata.
- **Phase 5 — drawer catalog cross-reference.** Catalog-sourced
  description / type / default / deprecation in the drawer. Real
  `default` layer flow-through (values nobody set fall through to the
  catalog default and tag as `default`). Per-element waterfall for
  array-merged fields. Related-knobs section (placeholder copy in
  `KeyDrawer.tsx:154`). Depends on Phase 3 + catalog wiring below.
  (§ "Phase 5".)
- **Phase 6 — OS-policy managed sources.** macOS
  `com.anthropic.claudecode` plist; Windows `HKLM`/`HKCU` policy keys.
  Apply managed-tier precedence (`inventory.md:50`). (§ "Phase 6".)
- **Phase 7 — refresh / watch / diagnostics.** Manual refresh ✅ shipped
  (`R` key + topbar button). Outstanding: file watcher (Rust, not the fs
  plugin), per-layer empty-state diagnostics, malformed/permission-denied
  surfaced in UI. (§ "Phase 7".)

### Deferred plan (kept warm, not slated)

- **CLI layer via process argv.** Reading another `claude` process's
  flags through `sysinfo`. Plan written at
  `~/.claude/plans/1-is-interesting-did-steady-seahorse.md`. Currently
  documented as out of v1 in `settings-display.md:200`.

---

## Catalog sync — `catalog-sync.md`

- **Hooks pass #2.** Handler types (`command`, `http`, `mcp_tool`,
  `prompt`, `agent`) and per-event input/output schemas. The current
  `sync-hooks.js` only captures the lifecycle table.
- **New sync scripts.** Each gets one script + one catalog file + one
  test, per the recipe. Likely candidates: `mcp.md`, `sub-agents.md`,
  permissions doc, `keybindings.md`, `cli-reference.md`. None committed.
- **`read_catalog` Tauri command.** Wire `catalog/*.json` into the app,
  retiring the hand-imported `src/lib/catalog.ts`. Unblocks Phase 5.
- **`$ref` resolution policy.** Settings catalog preserves `$ref`
  strings; decide whether consumers expand them at sync time or via a
  sibling `$defs` block.
- **Staleness signal.** ETag or content-hash on fetch — useful once we
  want change-detection beyond raw diff.
- **Cron CI for catalog drift.** GitHub Action that runs the sync
  scripts on schedule and opens a PR on diff. Cheap; nothing blocks it.
- **Coverage thresholds.** `--test-coverage-lines/-branches` floors on
  the sync test suites. Premature now.
- **Inventory's long-term role.** Once catalogs cover the same ground,
  decide what `inventory.md` is for — reference doc, contribution
  surface, or retire. (Open question carried in `catalog-sync.md` §
  "Open questions".)

---

## Inspector polish — `inspector-ui.md`

- **Path-notes click-through.** Open the source file at the right line
  in the user's editor. Spec calls this Phase 7+; nothing wired today.
- **Related-knobs section.** Drawer placeholder; depends on catalog
  wiring (above).
- **Per-element waterfall** for array-merged fields (depends on Phase 3).
- **Real `error` rail row.** The variant exists in the rail's status-dot
  scheme but no layer currently produces it; lights up once Phase 2 / 3
  reads can fail.
- **Rail navigability — undecided.** Spec is silent. Either keep the
  rail informational (current behavior) or wire layer-click → centre
  list filtered to keys won by that layer. Surface as an explicit
  decision before adding the affordance.

---

## Inventory canonicalization — `inventory.md`

- **§3 env-vars gaps.** Top-of-file note (`inventory.md:15`) flags this
  section as a known canonicalization gap; cross-check against live
  docs.
- **§5.1 hook-events gaps.** Same — flagged at line 15.
- **`[!verify]` convention.** `CLAUDE.md` describes the tag as a
  contribution surface, but the inventory currently contains zero such
  tags. Decide: re-tag unverified rows, or drop the convention from
  `CLAUDE.md`.

---

## Design surfaces — `design-notes.md`

These are deferred / open-ended; track here so they don't get lost.

- **Goals view.** Mocked at `mocks/03-goals.html`. Reframes the
  Inspector's data by user intent (speed / cost / safety / quality /
  privacy). Best done after the catalog produces structured tags.
- **Cross-cutting surfaces.** Hook graphs, plugin hierarchies, MCP
  runtime state. Don't fit a flat list; no concrete plan.
- **Landing page** (`knobs.cc/`). Leaning "live inventory" — render
  `spec/inventory.md` as a styled static site for the pre-release
  period.
- **Nomenclature.** "Knob" vs "setting / option / control"; "surface /
  category / group" for the top-level taxonomy. Listed as open.
