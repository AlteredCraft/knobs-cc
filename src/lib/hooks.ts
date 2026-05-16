// Parsing + formatting for the value of a `hooks.<EventName>` row. The
// raw value is whatever the user wrote in settings.json — typically an
// array of "matcher groups", each with an optional `matcher` regex and
// a `hooks` array of handlers. We defend against partial / malformed
// shapes throughout so a typo in the user's JSON doesn't crash the UI.
//
// Upstream shape (Claude Code hooks reference):
//   [
//     {
//       "matcher": "Bash",           // optional for some events
//       "hooks": [
//         { "type": "command", "command": "echo …", "timeout": 5 },
//         { "type": "http", "url": "https://…" },
//         { "type": "mcp_tool", "server": "…", "tool": "…" },
//         { "type": "prompt" | "agent", "prompt": "…" }
//       ]
//     }
//   ]

export interface ParsedHandler {
  /** Raw `type` field — preserved as-is for the type chip. */
  type: string;
  /**
   * One-line implementation preview suitable for the drawer summary
   * (command body / URL / mcp tool name / prompt body). Empty string
   * when the handler has no recognisable impl field.
   */
  implPreview: string;
  /** Full handler record — for the modal to render every field. */
  raw: Record<string, unknown>;
}

export interface ParsedMatcherGroup {
  /** `matcher` field if present and a string; null otherwise. */
  matcher: string | null;
  handlers: ParsedHandler[];
  /** Raw group object — for the modal to render extra fields if any. */
  raw: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Defensive: a handler's impl lives in a different field depending on
 * its `type`. Pick the first recognisable one; return "" when nothing
 * fits so the UI can render the type chip alone.
 */
function pickImplPreview(handler: Record<string, unknown>): string {
  const type = typeof handler.type === "string" ? handler.type : "";
  // The recognised handler types map to specific fields. We pick the
  // most useful field for a one-line preview, leaving the modal to
  // show the rest. Ordering inside each branch matters — `command`
  // and `prompt` are the long fields users want to see first.
  switch (type) {
    case "command":
      if (typeof handler.command === "string") return handler.command;
      break;
    case "http":
      if (typeof handler.url === "string") return handler.url;
      break;
    case "mcp_tool":
      // Upstream uses `server` + `tool`; combine into one preview.
      if (typeof handler.tool === "string") {
        return typeof handler.server === "string"
          ? `${handler.server}::${handler.tool}`
          : handler.tool;
      }
      break;
    case "prompt":
    case "agent":
      if (typeof handler.prompt === "string") return handler.prompt;
      break;
  }
  // Fallback: pick the first string field that isn't `type` so we
  // surface SOMETHING for unrecognised handler shapes.
  for (const [k, v] of Object.entries(handler)) {
    if (k === "type") continue;
    if (typeof v === "string") return v;
  }
  return "";
}

function parseHandler(value: unknown): ParsedHandler | null {
  if (!isPlainObject(value)) return null;
  const type = typeof value.type === "string" ? value.type : "unknown";
  return {
    type,
    implPreview: pickImplPreview(value),
    raw: value,
  };
}

/**
 * Parse the row value into matcher groups. Returns `[]` when the value
 * isn't an array (including unset / null / object). Skips elements
 * that aren't plain objects so a malformed entry in the middle of an
 * otherwise-valid array doesn't drop everything that follows.
 */
export function parseMatcherGroups(value: unknown): ParsedMatcherGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: ParsedMatcherGroup[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const matcher =
      typeof entry.matcher === "string" && entry.matcher.length > 0
        ? entry.matcher
        : null;
    const rawHandlers = Array.isArray(entry.hooks) ? entry.hooks : [];
    const handlers = rawHandlers
      .map(parseHandler)
      .filter((h): h is ParsedHandler => h !== null);
    groups.push({ matcher, handlers, raw: entry });
  }
  return groups;
}

/**
 * Summary string for the drawer's EFFECTIVE block. Replaces the
 * generic `[N] {…}` that formatValue produces with a hooks-aware view:
 *   - 0 groups   → "no matcher groups"
 *   - 1 group    → "1 matcher group · command"
 *   - N groups   → "N matcher groups · command, http"
 * Handler-type list is deduplicated and ordered by first appearance.
 */
export function formatHooksValue(value: unknown): string {
  const groups = parseMatcherGroups(value);
  if (groups.length === 0) return "no matcher groups";
  const types: string[] = [];
  for (const g of groups) {
    for (const h of g.handlers) {
      if (!types.includes(h.type)) types.push(h.type);
    }
  }
  const head = `${groups.length} matcher group${groups.length === 1 ? "" : "s"}`;
  return types.length === 0 ? head : `${head} · ${types.join(", ")}`;
}

/**
 * Per-group one-liner for the drawer's matcher-groups list.
 *   matcher: "Bash"   → 1 command
 *   (any)             → 2 command, http
 */
export function summarizeMatcherGroup(group: ParsedMatcherGroup): string {
  const types: string[] = [];
  for (const h of group.handlers) {
    if (!types.includes(h.type)) types.push(h.type);
  }
  const count = group.handlers.length;
  const typesPart =
    count === 0
      ? "no handlers"
      : types.length === 1
        ? `${count} ${types[0]}`
        : `${count} ${types.join(", ")}`;
  return typesPart;
}
