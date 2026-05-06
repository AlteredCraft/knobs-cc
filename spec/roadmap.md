# Roadmap

Single source of truth for open work across `spec/`. Each item points back
at the originating spec section for rationale and shape — this file only
tracks what's outstanding.

If you ship something, mark it ✅ here and (where relevant) update the
corresponding spec section. If you discover new work, add it here, not
inline in another spec.

Last reviewed: 2026-05-05 (Phase 2 + read_catalog + Phase 5 shipped).

---

## Settings layers — `settings-display.md`

Phase numbering matches the spec.

- **Phase 2 — file-based managed sources.** ✅ shipped 2026-05-05.
  `managed-settings.json` + alphabetic last-wins merge of
  `managed-settings.d/*.json` (within-tier; the cross-layer
  array-concat-dedup post-pass still runs). OS roots resolved per
  `inventory.md:46-48`. A malformed file in the managed tier fails the
  whole layer with the offending path named — admins should see their
  policy isn't loading rather than a silently-skipped file. Sibling read
  of `managed-mcp.json` exposed on the snapshot as `managed_mcp`; UI
  surfacing of MCP-policy presence is a follow-up. Plist / registry
  policy sources remain Phase 6.
- **Phase 3 — env vars + array-merge.** ✅ shipped 2026-05-05.
  Phase 3a: array-concat-dedup with per-element provenance for the known
  array-merged paths; `array-merged` chip activated.
  Phase 3b: `env` layer reads process env via the hand-curated mapping at
  `catalog/env-settings-map.json` (eight v1 mappings — `ANTHROPIC_MODEL`,
  `CLAUDE_CODE_*`). Mapping is extensible by JSON edit; future PR can
  migrate to a description-prose-derived `env` field on each settings
  catalog entry once upstream schema gains structured metadata.
- **Phase 5 — drawer catalog cross-reference.** Mostly shipped
  2026-05-05.
  ✅ Description / type / default in the drawer header (default shown
  inline as "default: X" when the entry has one and the row isn't
  unset).
  ✅ Default-layer flow-through — unset rows already pull `value` from
  catalog `default` and tag with `winner: "default"`; the waterfall
  surfaces it as the winning row.
  ✅ Per-element waterfall (Phase 3a).
  ✅ Related-knobs section — `findRelatedKnobs(keyPath)` in
  `src/lib/catalog.ts` returns immediate siblings under the same
  parent; drawer renders them as clickable rows; clicking
  navigates the drawer + list cursor in lockstep.
  Outstanding: **deprecation copy.** The settings catalog has no
  structured `deprecated` field — only one entry
  (`includeCoAuthoredBy`) mentions it informally in description prose.
  Either lobby upstream JSON Schema for a flag, or build a
  description-prose matcher when more entries gain that copy. Not slated.
  Known minor limitation: clicking a related knob that's currently
  filtered out (chip / search) snaps to the first visible row instead
  of clearing the filter. Acceptable for v1; track if it bites.
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
- **`read_catalog` Tauri command.** ✅ shipped 2026-05-05. Rust now
  owns `catalog/{settings,env-vars,hooks}.json` via `include_str!` and
  serves them through `read_catalog`. The frontend's `src/lib/catalog.ts`
  is now async-hydrated (`loadCatalog()` at boot, sync accessors
  thereafter); a vitest setup file feeds the same JSON into
  `hydrateCatalogForTesting()` so unit tests skip IPC. The env-vars
  and hooks catalogs are exposed on the wire but not yet consumed by
  the UI — Phase 5 and inspector polish will pick them up. Unblocks
  Phase 5.
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
- **Related-knobs section.** ✅ shipped with Phase 5
  (`KeyDrawer.tsx` `RelatedKnobs`).
- **Per-element waterfall** for array-merged fields. ✅ shipped with
  Phase 3a (`KeyDrawer.tsx` `ElementList`).
- **Real `error` rail row.** ✅ shipped with Phase 2 — managed-file
  parse failures now produce an `err` row in the rail. (Project / user
  files have produced `error` since Phase 1; Phase 2 closed the last
  layer that couldn't.)
- **`managed-mcp.json` surface.** Backend exposes the sibling read at
  `snapshot.managed_mcp` (Phase 2). UI placement TBD — likely a small
  "MCP policy" indicator near the topbar or a row in the rail's
  diagnostics dock. Out of scope for the inspector main flow.
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
