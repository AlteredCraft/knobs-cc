# Inspector UI

Phase 4+ UI direction for settings display: a three-pane DevTools-style
inspector that combines a flat searchable settings list with a per-key
provenance waterfall.

This file is design-locked but implementation-open. It records the chosen
layout and the design primitives that distinguish this UI from a generic
settings table. Visual reference: `mocks/01-inspector.html`.

> Implementation status and remaining polish (path-notes click-through,
> related-knobs, rail navigability decision, …) live in
> [`roadmap.md`](./roadmap.md).

## Why this direction

Three directions were prototyped (`mocks/README.md` has the full comparison):

1. **Inspector** — three-pane, density-first. **Chosen.**
2. **Stack View** — typeset documentary. Reserved for a future
   `knobs.cc/` rendering of `inventory.md`, not the desktop app.
3. **Goals** — opinionated cards organized by user intent (speed, cost,
   safety). Deferred to a possible future feature; see `design-notes.md`
   under "Goals view (deferred)".

The desktop audience is engineers debugging "which layer wins, and why,"
which is inherently per-key and benefits from density, keyboard navigation,
and side-by-side comparison of layer contributions. The Inspector serves
that directly. Goals reframes the same data for *intent*, which is a
discovery surface rather than an inspection surface — orthogonal, not
competing, but not the v1 default.

## Layout

Three panes, fixed widths on the rails, fluid in the middle.

### Left rail — precedence stack

Seven rows in precedence order, highest first. Each row:

- Status dot (`ok` / `missing` / `error` / not-inspectable)
- Layer label (mono)
- Truncated path (or empty-state explanation — see below)
- Set-key count

The active layer (the one whose contribution the drawer is currently
showing) gets a left border in the accent colour. Diagnostics dock at the
bottom of the rail.

### Centre — settings list

Toolbar:

- Filter input (live, prefix-aware: `permissions.*`, `hooks.*`)
- Filter chips: `all` · `set` · `shadowed` · `array-merged` · `unset`
- Sort selector (default: precedence order, secondary: alphabetical)

Row columns, left to right:

1. Index (mono, dim)
2. Key, with namespace dot-prefix dimmed (e.g., `permissions.`**defaultMode**)
3. Effective value (truncated for objects; arrays show `[N] first, second, …`)
4. Source badge — the winning layer
5. **Presence indicator** (see Design primitives)
6. Chevron (opens the drawer)

Unset rows (only the catalog default applies) are dimmed. The `unset`
filter chip shows just those; the default view hides them after the set
keys.

### Right drawer — detail

Non-modal. The list and rail remain navigable while the drawer is open.

- Header: key name, type info, scalar/array marker, shadowing flag
- Description from the catalog (Phase 5+; for Phase 4, fall back to the
  key alone). Rendered as markdown (see catalog-sync.md "Prose fields
  are markdown") — links open in the system browser via the opener
  plugin, with site-relative URLs resolved against the docs root.
  Env vars are not surfaced here — `env.*` rows are filtered out of
  the inspector entirely; see "Sibling surfaces" below.
- Effective-value block — value + winning layer badge, accent-coloured
- **Layer waterfall** (see Design primitives)
- Path notes for set layers (`./.claude/settings.json`) — clickable to
  open the file in the user's default editor (shipped). Line targeting
  (`:7`) is deferred — `openPath` doesn't accept a line and a
  `vscode://file` URL would lock click-through to a single editor.
- Related-knobs section, seeded from the catalog (Phase 5+)
- Catalog-source footer pointing back at `inventory.md`

## Design primitives

These are the elements that make the inspector legible. Implementations
can change typography, spacing, and colour, but should preserve the
information density and the layer-presence semantics.

### Presence indicator

Seven small cells in a row, one per layer in precedence order
(`managed cli env project_local project user default`). Each cell encodes
one of:

| State | Visual |
|---|---|
| Layer didn't contribute | hollow outline cell |
| Layer contributed but was shadowed | dim filled cell |
| Layer contributed and won | accent-coloured filled cell |
| Layer contributed an array element (no single winner) | filled cell, no winner emphasis |

This lets the eye scan the list and immediately see *where* a value is
coming from without reading the source badge. Particularly useful for
spotting array-merged fields (multiple filled cells, no single accent).

### Source badges

Short uppercase mono badges with consistent per-layer colour treatment
across rail, list, drawer, and waterfall:

- `MGD` / managed — red tint (compliance / policy)
- `ENV` — blue tint (process boundary)
- `P.LOCAL` — bright amber tint (personal override)
- `PROJ` — amber tint (team-shared)
- `USER` — neutral grey
- `DEFAULT` — muted, no tint
- `CLI` — never appears in v1 (not inspectable)

### Waterfall

Top-to-bottom in precedence order (highest first). Critical: **every layer
appears, not just contributors.** The absence of a value is information
("env didn't override this even though it could have"). Shadowed layers
keep their value but are visually demoted (struck-through value, dimmed
row). For array-merged fields, replace the per-layer waterfall with a
per-element list (each element shows its source).

## Empty-state copy

Three layers will be absent for typical users. Copy matters because
generic "—" or "missing" is misleading.

- `managed` (no MDM): **"no MDM policy detected"**
- `cli` (sibling process can't read): **"not inspectable from sibling proc"**
- `env` (no relevant vars): **"$ANTHROPIC_MODEL not set for this key"**
  (per-key, not per-layer; applies to the 8 settings keys ENV projects
  via `catalog/env-settings-map.json` — the rest of the env-vars
  surface lives in the EnvVarsPanel)
- `default` (always present): **"catalog (compiled-in)"**

Per `settings-display.md`, a malformed user file does not block reading
the project file — surface per-layer errors via the rail row's status dot,
not as a global blocking error.

## Interaction model

Keyboard-first. The mock implies (and Phase 4 should ship):

- `⌘K` / `/` — focus the filter input
- `J` / `K` — move between rows
- `↵` — toggle drawer for the focused row
- `Esc` — close drawer
- `R` — refresh snapshot

Mouse interactions mirror the keyboard. The drawer is non-modal so the
user can J/K through neighbouring rows while the drawer updates in place.

## Out of scope (for the inspector itself)

- Editing — read-only per `settings-display.md`.
- Per-key history or time-travel diffs.
- Comparing snapshots across machines or moments in time.
- Goal-framed grouping — deferred (see `design-notes.md`).
- Env vars — `env.*` rows are filtered out of the inspector entirely;
  the EnvVarsPanel (below) is the SSOT.

## Sibling surfaces

The inspector is one of two top-level surfaces. Each owns a different
question; deliberate separation, not duplication.

### EnvVarsPanel (modal takeover)

Topbar-pill-driven takeover panel; full-pane modal modeled on
`ErrorPanel` / `HelpView`. Owns the env-var surface end-to-end:

- One row per cataloged env var (220 entries from
  `catalog/env-vars.json`), plus a top section for **non-catalog**
  names — `env.<NAME>` set in `settings.json` but not documented
  upstream, surfaced as the highest-signal entries since they're
  invisible everywhere else. Shell-set names that aren't in the
  catalog are deliberately *not* surfaced (a user's shell carries
  hundreds of unrelated vars: `PATH`, `HOME`, …).
- Each row joins shell-set values (read via `read_shell_env_vars`)
  with `settings.json` `env.<NAME>` contributors per layer, in
  precedence order. Shell wins when both routes set the same name.
- Names matching `/key|token|secret|password/i` mask their value to
  `•••••••• abcd` until clicked — demo-safe by default.
- Filter chips: `all` / `set` / `shell` / `settings.json` / `unset`;
  substring search across name and purpose.
- Click a row to expand inline — full markdown `purpose` prose,
  default, contributor list (winner first; shadowed values
  struck-through with their layer + path).
- Caveat in the panel footnote: knobs.cc reads its own process env,
  which usually matches the user's shell but can differ for
  Finder/Spotlight launches via LaunchServices. Dotenv files Claude
  Code reads at startup are out of scope. Closing this gap (reading
  another `claude` process's actual environ) is tracked at
  [#11](https://github.com/AlteredCraft/knobs-cc/issues/11) alongside
  the related `cli` precedence-slot gap.

The inspector's column-header banner points users at this panel so a
filter for `env` in the inspector (which now returns zero rows)
isn't a dead end.

### ErrorPanel and HelpView

Existing modal takeovers, unchanged by the EnvVarsPanel work. Same
pattern: topbar-button-driven, full-pane, Esc to close.

## Implementation notes

- Recommended stack: **shadcn/ui + Tailwind**. Components vendor as source
  into the repo so the "shadcn aesthetic" is restylable down to typography
  and spacing — important for a precision-instrument tool. Radix
  primitives underneath give keyboard nav, focus management, and ARIA for
  free. Full framework comparison in `mocks/README.md`.
- Add `cmdk` for the ⌘K palette and `lucide-react` for icons.
- The drawer is a `Sheet` with `modal={false}` (or an inline `<aside>`) so
  list navigation stays live.
- The presence indicator and source badges should be small, reusable
  components — they appear in multiple panes and should look identical
  everywhere.
