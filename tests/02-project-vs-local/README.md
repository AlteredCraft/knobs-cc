# 02 — Project vs local precedence

**Demonstrates:** two layers active simultaneously, "local beats project"
visualised in the rail and provenance chips, and the drawer waterfall
showing the full value cascade.

## Run Claude command

```shell
claude
```

No env vars, no CLI flags — precedence comes entirely from the two
`.claude/settings*.json` files.

## What's set

`.claude/settings.json` (project layer):

- `model: "sonnet"`
- `effortLevel: "medium"`
- `defaultShell: "/bin/zsh"`

`.claude/settings.local.json` (project_local layer, gitignored in real
projects):

- `model: "opus"` — *overrides* project
- `defaultShell: "/bin/bash"` — *overrides* project
- (does not set `effortLevel` — that one falls through to project)

## How to demo

1. SessionPill → path-picker → pick `tests/02-project-vs-local/`.
2. Rail: two layers active — `project_local` (count 2) and `project`
   (count 3). Both dotted.
3. Settings list:
   - `model` row: value `"opus"`, provenance chip `project_local`.
   - `defaultShell` row: value `"/bin/bash"`, provenance chip `project_local`.
   - `effortLevel` row: value `"medium"`, provenance chip `project`.
4. Click `model` → drawer shows the **waterfall** — both layers
   contributed values, with `project_local` winning and `project`
   shown beneath it (shadowed / struck-through styling).

## Talking points

- The waterfall is what answers "what *would* my value have been if I
  removed the override?" — a question single-layer tools can't answer.
- `effortLevel` shows that not every setting has to be overridden; rows
  cleanly attribute to whichever layer last touched them.
