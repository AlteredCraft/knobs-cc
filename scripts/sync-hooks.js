#!/usr/bin/env node
// Fetches the Claude Code hooks docs page (markdown) and writes a
// reshaped catalog of hook events, handler types, and per-event
// input/output schemas to catalog/hooks.json. Companion to
// sync-settings.js, sync-env-vars.js, and friends.
//
// What we parse:
//   1. Lifecycle table near the top of the page (`| Event | When it
//      fires |`), one record per event.
//   2. Handler-fields tables under `### Hook handler fields` — one for
//      `#### Common fields` and one each for command, http, mcp_tool,
//      and the combined `#### Prompt and agent hook fields` (which the
//      doc collapses into a shared section because both types accept
//      the same fields).
//   3. Common-input table(s) under `### Common input fields`. The
//      section has two stacked tables — the second covers the
//      subagent-only `agent_id`/`agent_type` extras. Both belong to
//      the section, so we concatenate them into a single `commonInput`
//      array.
//   4. Per-event input/output schemas: for each event under
//      `## Hook events`, look up its `#### <Event> input` subsection
//      and capture (a) the first `| Field | Description |` table as
//      `inputFields` and (b) the first ```json``` code fence as
//      `inputExample`. Then look up `#### <Event> decision control` or
//      `#### <Event> output` (some events use the latter heading) and
//      capture its `| Field | Description |` table as `outputFields`.
//
// What we don't parse (tracked as future passes in spec/roadmap.md):
//   - Per-tool input variants under `#### PreToolUse input` (Bash,
//     Edit, Write, Read, Glob, Grep, WebFetch, WebSearch, Agent,
//     AskUserQuestion). Those are nested `#####` subsections each with
//     a 4-column `Field | Type | Example | Description` table; pass #2
//     captures only the shared 2-col `Field | Description` shape.
//   - `### Matcher patterns` cross-reference table (different fields
//     per event, inherently heterogeneous).
//   - `### JSON output` universal-fields table (could become a
//     `commonOutput` array in a later pass).
//   - Exit-code-2 behavior table, HTTP response handling, prompt-hook
//     response schema, async-hook config — all prose-rich, no single
//     canonical artifact worth pulling forward.
//
// Idempotence: re-running on unchanged upstream produces a one-line
// diff (fetchedAt only). Records inside `events` are sorted by name,
// `handlers` follows the doc order (common, command, http, mcp_tool,
// prompt_and_agent), and `commonInput` follows the table order.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/hooks.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'hooks.json');

// Strip a single layer of wrapping backticks (`NAME` -> NAME). Leaves
// strings without wrapping backticks (or with multiple internal
// backticks) untouched.
function stripBackticks(s) {
  const m = /^`([^`]+)`$/.exec(s);
  return m ? m[1] : s;
}

// Split a GFM table row line into trimmed cell strings. Handles `\|`
// escapes — backslash-pipe inside a cell renders as a literal pipe and
// must not split. Returns [] if the line doesn't look like a row.
//
// "| name | when |" splits on unescaped `|` into
//   ["", " name ", " when ", ""]
// We drop the leading and trailing empty strings (caused by the outer
// pipes), trim, and unescape `\|` -> `|`.
export function splitCells(line) {
  if (!line.startsWith('|')) return [];
  const raw = line.split(/(?<!\\)\|/);
  if (raw.length < 3) return [];
  return raw.slice(1, raw.length - 1).map((p) => p.replace(/\\\|/g, '|').trim());
}

// Parse a single 2-cell GFM table row into {name, when}. Returns null
// for lines that don't look like a 2+ cell row. Used by parseTable for
// the lifecycle table (kept for backward compatibility with the v1
// API).
export function parseRow(line) {
  const parts = line.split('|');
  // "| name | when |" splits into ["", " name ", " when ", ""].
  if (parts.length < 4) return null;
  const name = stripBackticks(parts[1].trim());
  // Defensive join in case a stray pipe appears in the cadence cell.
  const when = parts.slice(2, parts.length - 1).join('|').trim();
  if (!name || !when) return null;
  return { name, when };
}

// Find the lifecycle table (header `| Event | When it fires |`) and
// return its data rows. Returns [] if no such table exists in
// `markdown`. The page has other tables whose first column header is
// "Event" (matcher mapping, decision patterns) — the second column
// disambiguates.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Event\s*\|\s*When it fires\s*\|/i.test(line)) {
        inTable = true;
      }
      continue;
    }
    // Skip the alignment row (`| :--- | :--- |`) right after the header.
    if (/^\|\s*:?-+:?\s*\|/.test(line)) continue;
    // First non-pipe line ends the table.
    if (!line.startsWith('|')) break;
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  return rows;
}

// Walk a markdown document and return every GFM table along with the
// h2..h5 heading path that encloses it. A table is defined as a header
// pipe-line immediately followed by an alignment line — bare pipe
// lines that look like a row but aren't a real table are ignored.
//
// Returns [{ path: { h2, h3, h4, h5 }, headers, rows }], where
// `headers` and `rows` are arrays of trimmed cell strings.
export function extractAllTables(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  const path = { h2: null, h3: null, h4: null, h5: null };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{2,5})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 2) Object.assign(path, { h2: title, h3: null, h4: null, h5: null });
      else if (level === 3) Object.assign(path, { h3: title, h4: null, h5: null });
      else if (level === 4) Object.assign(path, { h4: title, h5: null });
      else if (level === 5) Object.assign(path, { h5: title });
      continue;
    }
    // Detect a table: header `| ... |` followed by alignment row.
    if (line.startsWith('|') && /^\|\s*:?-+:?\s*\|/.test(lines[i + 1] || '')) {
      const headers = splitCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = splitCells(lines[i]);
        if (cells.length === headers.length && cells.some((c) => c.length > 0)) {
          rows.push(cells);
        }
        i++;
      }
      // Step back so the outer for-loop advances naturally past the row
      // that ended the table.
      i--;
      out.push({ path: { ...path }, headers, rows });
    }
  }
  return out;
}

// Map a `#### <SubName>` under `### Hook handler fields` to its catalog
// `name` key. The doc's prompt+agent section is shared, so it expands
// to a single `prompt_and_agent` entry.
const HANDLER_HEADINGS = {
  'Common fields': 'common',
  'Command hook fields': 'command',
  'HTTP hook fields': 'http',
  'MCP tool hook fields': 'mcp_tool',
  'Prompt and agent hook fields': 'prompt_and_agent',
};

// Extract the five handler-field tables under `### Hook handler fields`.
// Returns an array of `{name, fields}` in canonical order — common,
// command, http, mcp_tool, prompt_and_agent — restricted to whatever
// subsections actually appear in the input. Tables under unrelated
// `####` headings are ignored.
export function parseHandlerSections(markdown) {
  const tables = extractAllTables(markdown);
  const seen = new Map();
  for (const t of tables) {
    if (t.path.h3 !== 'Hook handler fields') continue;
    const name = HANDLER_HEADINGS[t.path.h4 || ''];
    if (!name) continue;
    if (seen.has(name)) continue;
    if (
      t.headers.length !== 3 ||
      t.headers[0] !== 'Field' ||
      t.headers[1] !== 'Required' ||
      t.headers[2] !== 'Description'
    ) {
      continue;
    }
    const fields = t.rows.map(([f, req, desc]) => ({
      field: stripBackticks(f),
      required: req,
      description: desc,
    }));
    seen.set(name, fields);
  }
  const order = ['common', 'command', 'http', 'mcp_tool', 'prompt_and_agent'];
  return order.filter((n) => seen.has(n)).map((n) => ({ name: n, fields: seen.get(n) }));
}

// Extract the `### Common input fields` tables. The doc has two stacked
// tables under the same heading (main + subagent extras); we
// concatenate them in document order.
export function parseCommonInput(markdown) {
  const tables = extractAllTables(markdown);
  const out = [];
  for (const t of tables) {
    if (t.path.h3 !== 'Common input fields') continue;
    if (
      t.headers.length !== 2 ||
      t.headers[0] !== 'Field' ||
      t.headers[1] !== 'Description'
    ) {
      continue;
    }
    for (const [f, d] of t.rows) {
      out.push({ field: stripBackticks(f), description: d });
    }
  }
  return out;
}

// Read the first ```json``` fenced code block whose enclosing heading
// path matches the predicate. Returns the verbatim block body (newline-
// joined, no trailing newline) or null if none matches.
function findFirstJsonBlock(markdown, matchPath) {
  const lines = markdown.split('\n');
  const path = { h2: null, h3: null, h4: null, h5: null };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{2,5})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 2) Object.assign(path, { h2: title, h3: null, h4: null, h5: null });
      else if (level === 3) Object.assign(path, { h3: title, h4: null, h5: null });
      else if (level === 4) Object.assign(path, { h4: title, h5: null });
      else if (level === 5) Object.assign(path, { h5: title });
      continue;
    }
    if (/^```json\b/.test(line) && matchPath(path)) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith('```')) {
        body.push(lines[j]);
        j++;
      }
      return body.join('\n');
    }
  }
  return null;
}

// Map per-event subsection headings (`#### <Event> input`,
// `#### <Event> decision control`, `#### <Event> output`) to the event
// name and the kind of section. Returns null if it's not a per-event
// schema heading.
function classifyEventSubheading(h4) {
  if (!h4) return null;
  let m = /^(.+) input$/.exec(h4);
  if (m) return { event: m[1], kind: 'input' };
  m = /^(.+) decision control$/.exec(h4);
  if (m) return { event: m[1], kind: 'output' };
  m = /^(.+) output$/.exec(h4);
  if (m) return { event: m[1], kind: 'output' };
  return null;
}

// Build a Map<eventName, {inputFields, inputExample, outputFields}> for
// every event found under `## Hook events`. Unknown events (those that
// don't have a `### EventName` subsection) are not in the map, so the
// caller should default missing keys to an empty schema.
export function parseEventSchemas(markdown) {
  const tables = extractAllTables(markdown);
  const schemas = new Map();
  function ensure(event) {
    if (!schemas.has(event)) {
      schemas.set(event, { inputFields: [], inputExample: null, outputFields: [] });
    }
    return schemas.get(event);
  }
  for (const t of tables) {
    if (t.path.h2 !== 'Hook events') continue;
    if (!t.path.h3) continue;
    // Tables nested deeper than the immediate `#### <Event> ...` (i.e.
    // those under a `##### Tool` subheading) are ignored — that's the
    // PreToolUse per-tool variant case we deliberately skip in pass #2.
    if (t.path.h5) continue;
    const cls = classifyEventSubheading(t.path.h4);
    if (!cls) continue;
    if (cls.event !== t.path.h3) continue;
    if (
      t.headers.length !== 2 ||
      t.headers[0] !== 'Field' ||
      t.headers[1] !== 'Description'
    ) {
      continue;
    }
    const rows = t.rows.map(([f, d]) => ({ field: stripBackticks(f), description: d }));
    const slot = ensure(cls.event);
    if (cls.kind === 'input' && slot.inputFields.length === 0) slot.inputFields = rows;
    if (cls.kind === 'output' && slot.outputFields.length === 0) slot.outputFields = rows;
  }
  // Walk the doc once for JSON examples — first ```json``` block under
  // each `#### <Event> input` subsection. We also need to register
  // events that have an input section but no Field|Description table,
  // so the map covers them too.
  const lines = markdown.split('\n');
  const path = { h2: null, h3: null, h4: null, h5: null };
  let pendingEvent = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{2,5})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 2) Object.assign(path, { h2: title, h3: null, h4: null, h5: null });
      else if (level === 3) Object.assign(path, { h3: title, h4: null, h5: null });
      else if (level === 4) Object.assign(path, { h4: title, h5: null });
      else if (level === 5) Object.assign(path, { h5: title });
      // Note an event subsection so we can register an empty schema
      // even if no JSON block follows.
      if (path.h2 === 'Hook events') {
        const cls = classifyEventSubheading(path.h4);
        if (cls && cls.event === path.h3) {
          pendingEvent = cls.event;
          ensure(cls.event);
        } else {
          pendingEvent = null;
        }
      } else {
        pendingEvent = null;
      }
      continue;
    }
    if (
      pendingEvent &&
      path.h2 === 'Hook events' &&
      path.h4 &&
      classifyEventSubheading(path.h4)?.kind === 'input' &&
      !path.h5 &&
      /^```json\b/.test(line)
    ) {
      const body = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith('```')) {
        body.push(lines[j]);
        j++;
      }
      const slot = schemas.get(pendingEvent);
      if (slot && slot.inputExample === null) {
        slot.inputExample = body.join('\n');
      }
      // Skip past this code block.
      i = j;
    }
  }
  return schemas;
}

// Compose the full envelope from raw markdown. Pure function: easy
// to drive from tests with a small fixture string. Returns
// `{ count, events, handlers, commonInput }` — the caller adds
// `source` and `fetchedAt`.
export function buildRecords(markdown) {
  const lifecycle = parseTable(markdown);
  const schemas = parseEventSchemas(markdown);
  const events = lifecycle
    .map((row) => {
      const schema = schemas.get(row.name) || {
        inputFields: [],
        inputExample: null,
        outputFields: [],
      };
      return {
        name: row.name,
        when: row.when,
        inputFields: schema.inputFields,
        inputExample: schema.inputExample,
        outputFields: schema.outputFields,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const handlers = parseHandlerSections(markdown);
  const commonInput = parseCommonInput(markdown);
  return {
    count: events.length,
    events,
    handlers,
    commonInput,
  };
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${SOURCE} → HTTP ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();

  const built = buildRecords(markdown);
  if (built.events.length === 0) {
    throw new Error('Unexpected page shape: no `Event | When it fires` table found');
  }
  if (built.handlers.length === 0) {
    throw new Error('Unexpected page shape: no `### Hook handler fields` subsections found');
  }
  if (built.commonInput.length === 0) {
    throw new Error('Unexpected page shape: no `### Common input fields` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    ...built,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(
    `Wrote ${built.events.length} events + ${built.handlers.length} handler sections + ${built.commonInput.length} common input fields → ${OUT}`,
  );
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
