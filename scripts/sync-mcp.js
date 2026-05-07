#!/usr/bin/env node
// Fetches the Claude Code MCP docs page (markdown) and writes a reshaped
// catalog of MCP installation scopes to catalog/mcp.json. Companion to
// sync-settings.js, sync-env-vars.js, sync-hooks.js, and sync-sub-agents.js.
//
// What we parse: the `## MCP installation scopes` table —
// `| Scope | Loads in | Shared with team | Stored in |`. That table
// enumerates the three scopes a user-authored MCP server can live at
// (Local / Project / User) and the precedence-ordered storage locations
// that back them. The page documents far more (transport types, OAuth
// flow, managed-mcp.json, tool-search threshold values, …) but those
// live under prose-heavy `###`/`####` sections without a single
// canonical table; the scopes table is the smallest useful artifact and
// the natural parallel to catalog/hooks.json and catalog/sub-agents.json.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/mcp.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'mcp.json');

// Strip a markdown link wrapper (`[Local](#local-scope)` -> `Local`) or
// a single layer of wrapping backticks (`Local` -> Local). Leaves a
// bare token untouched.
function stripNameDecorators(s) {
  const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(s);
  if (link) return link[1];
  const code = /^`(.+)`$/.exec(s);
  return code ? code[1] : s;
}

// Parse a single GFM table row into {name, loadsIn, shared, storedIn}.
// Returns null for lines that don't look like a 4+ cell row.
export function parseRow(line) {
  const parts = line.split('|');
  // "| name | loadsIn | shared | storedIn |" splits into 6 parts.
  if (parts.length < 6) return null;
  const name = stripNameDecorators(parts[1].trim());
  const loadsIn = parts[2].trim();
  const shared = parts[3].trim();
  // Defensive join in case a stray pipe appears in the rightmost cell.
  const storedIn = parts.slice(4, parts.length - 1).join('|').trim();
  if (!name || !loadsIn || !shared || !storedIn) return null;
  return { name, loadsIn, shared, storedIn };
}

// Find the scopes table (header
// `| Scope | Loads in | Shared with team | Stored in |`) and return its
// data rows. Returns [] if no such table exists in `markdown`. The page
// has other 2-col tables (OAuth env vars, tool-search threshold values)
// — the 4-col header signature disambiguates.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (
        /^\|\s*Scope\s*\|\s*Loads in\s*\|\s*Shared with team\s*\|\s*Stored in\s*\|/i.test(
          line,
        )
      ) {
        inTable = true;
      }
      continue;
    }
    // Skip the alignment row (`| :--- | :--- | :--- | :--- |`).
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

  const scopes = buildRecords(markdown);
  if (scopes.length === 0) {
    throw new Error(
      'Unexpected page shape: no `Scope | Loads in | Shared with team | Stored in` table found',
    );
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: scopes.length,
    scopes,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${scopes.length} MCP scopes → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
