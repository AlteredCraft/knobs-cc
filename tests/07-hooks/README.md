# 07 — Hooks drawer cross-reference

**Demonstrates:** the drawer's `hooks.events` catalog cross-reference.
When a row's keyPath is `hooks.<EventName>` and the event is documented
in `catalog/hooks.json`, the drawer header surfaces the upstream
`when` cadence ("Before a tool call executes. Can block it") instead
of the thinner settings-catalog description ("Hooks that run before
tool calls"). Same pattern as the env-vars and `permissions.modes`
drawer wire-ups — the third drawer-side catalog cross-reference.

## Run Claude command

```shell
claude
```

No env vars, no CLI flags — pure file-based read.

## What's set

`.claude/settings.json` (project):

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "…blocks rm -rf / sudo" }] }
  ],
  "Stop": [
    { "hooks": [{ "type": "command", "command": "osascript … display notification" }] }
  ]
}
```

Two events configured. Every other hook event stays `unset` so you
can compare the rendering on both sides.

## How to demo

1. SessionPill → path-picker → pick `tests/07-hooks/`.
2. Rail: `project` row active, count includes the two hook rows.
3. Settings list — filter `hooks.` to bring the family together.
4. Click into `hooks.PreToolUse`:
   - Header description reads from the **hooks catalog** —
     "Before a tool call executes. Can block it" — rather than the
     settings catalog's "Hooks that run before tool calls".
   - EFFECTIVE block reads `1 matcher group · command` instead of the
     generic `[1] {…}`.
   - **Matcher Groups** section in the drawer body lists each group
     as `01 · matcher: "Bash" → 1 command [⯈]`. Click the row to open
     the hook details modal.
5. In the hook details modal:
   - Triggers section repeats the catalog `when`.
   - Matcher groups list shows the full implementation: the
     `command` body in a preformatted block, with the `timeout`
     field below.
   - Event schema section (from the hooks catalog) lists `inputFields`
     / `outputFields` and the canonical `inputExample`.
   - Esc closes the modal; the drawer stays open underneath.
6. Click into `hooks.Stop`:
   - Same pattern, no matcher field — drawer shows `(any) → 1 command`.
   - The modal renders `matcher: (any)` for groups without a matcher.
7. Click into any `unset` hook row (e.g. `hooks.SessionStart`,
   `hooks.UserPromptSubmit`):
   - The header cross-reference still fires — the description reads
     the event's `when` from the catalog. The body shows
     `— unset —`, no Matcher Groups section, and the inspect modal
     isn't reachable (nothing to inspect).

## Talking points

- The hooks catalog (29 events at time of writing) is **curated
  upstream prose** about event semantics — when the event fires, what
  it can do (block? audit-only?), what it provides. The settings JSON
  Schema description is sometimes thinner (`PreToolUse`, `Stop`,
  `SessionStart`) and sometimes richer (`ConfigChange`,
  `FileChanged`). The drawer prefers the hooks-catalog prose because
  it's consistently event-semantic across all 29 entries.
- The drawer's **Matcher Groups** list and the **hook details modal**
  exist because the generic `[N] {…}` summary `formatValue` produces
  for array-of-object values is useless for hooks — users care about
  the matcher / handler-type / implementation. The drawer summarises;
  the modal carries the full impl (long command bodies, URLs,
  mcp_tool names) plus the catalog event schema.
- Per-handler rendering knows about the upstream handler types
  (`command`, `http`, `mcp_tool`, `prompt`, `agent`) so each one
  surfaces its impl field (`command` / `url` / `tool` / `prompt`)
  rather than a flat key/value dump.
- The modal also surfaces the per-event input/output schemas that
  were lifted into `catalog/hooks.json` by hooks-sync pass #2 — the
  first UI consumer of that data. Tracked at
  [#17](https://github.com/AlteredCraft/knobs-cc/issues/17).
