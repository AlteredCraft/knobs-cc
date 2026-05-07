#!/usr/bin/env node
// Fetches the Claude Code sub-agents docs page (markdown) and writes a
// reshaped catalog of supported frontmatter fields to
// catalog/sub-agents.json. Companion to sync-settings.js, sync-env-vars.js,
// and sync-hooks.js.
//
// What we parse: the `#### Supported frontmatter fields` table near the
// middle of the page, `| Field | Required | Description |`. That table
// enumerates the keys a `~/.claude/agents/<name>.md` (or project-scoped)
// definition file's YAML frontmatter accepts — `name`, `description`,
// `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`,
// `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`,
// `isolation`, `color`, `initialPrompt`. The page also documents
// built-in subagents, model-resolution rules, hook semantics, and so on,
// but those live under prose-heavy sections; the frontmatter table is
// the smallest useful artifact for the catalog and parallels the shape
// of catalog/env-vars.json and catalog/hooks.json.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/sub-agents.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'sub-agents.json');

// Strip a single layer of wrapping backticks (`NAME` -> NAME). Leaves
// strings without wrapping backticks untouched.
function stripBackticks(s) {
  const m = /^`(.+)`$/.exec(s);
  return m ? m[1] : s;
}

// Parse a single GFM table row into {name, required, description}.
// Returns null for lines that don't look like a 3+ cell row.
//
// `required` is normalized to a boolean: "Yes" -> true, anything else
// (typically "No") -> false. Upstream uses exactly those two values.
export function parseRow(line) {
  const parts = line.split('|');
  // "| name | required | desc |" splits into
  // ["", " name ", " required ", " desc ", ""].
  if (parts.length < 5) return null;
  const name = stripBackticks(parts[1].trim());
  const requiredCell = parts[2].trim();
  // Defensive join in case a stray pipe appears in the description.
  const description = parts.slice(3, parts.length - 1).join('|').trim();
  if (!name || !description) return null;
  return {
    name,
    required: /^yes$/i.test(requiredCell),
    description,
  };
}

// Find the supported-frontmatter-fields table (header
// `| Field | Required | Description |`) and return its data rows.
// Returns [] if no such table exists in `markdown`. The page has other
// tables (e.g. the "Other" built-in subagents tab uses
// `| Agent | Model | When Claude uses it |`) — the header signature
// disambiguates.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Field\s*\|\s*Required\s*\|\s*Description\s*\|/i.test(line)) {
        inTable = true;
      }
      continue;
    }
    // Skip the alignment row (`| :--- | :--- | :--- |`) right after the header.
    if (/^\|\s*:?-+:?\s*\|/.test(line)) continue;
    // First non-pipe line ends the table.
    if (!line.startsWith('|')) break;
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  return rows;
}

// Compose the full record list from raw markdown. Pure function: easy
// to drive from tests with a small fixture string.
export function buildRecords(markdown) {
  const rows = parseTable(markdown);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${SOURCE} → HTTP ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();

  const fields = buildRecords(markdown);
  if (fields.length === 0) {
    throw new Error('Unexpected page shape: no `Field | Required | Description` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: fields.length,
    fields,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${fields.length} subagent frontmatter fields → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
