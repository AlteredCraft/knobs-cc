#!/usr/bin/env node
// Fetches the Claude Code permissions docs page (markdown) and writes a
// reshaped catalog of permission modes to catalog/permissions.json.
// Companion to sync-settings.js, sync-env-vars.js, sync-hooks.js,
// sync-sub-agents.js, and sync-mcp.js.
//
// What we parse: the `## Permission modes` table —
// `| Mode | Description |`. That table enumerates every value
// `permissions.defaultMode` accepts (default, acceptEdits, plan, auto,
// dontAsk, bypassPermissions) with prose descriptions richer than the
// short blurbs in the settings JSON Schema. The page documents far more
// (rule syntax, tool-specific patterns, managed-only settings, working-
// directories table, …) but those live under prose-heavy `###`/`####`
// sections or use different header signatures; the modes table is the
// smallest useful artifact and the natural parallel to
// catalog/hooks.json, sub-agents.json, and mcp.json. Subsequent passes
// can capture the path-pattern table (`### Read and Edit`) and the
// managed-only settings annotation table.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/permissions.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'permissions.json');

// Strip a single layer of wrapping backticks (`NAME` -> NAME). Leaves
// strings without wrapping backticks untouched.
function stripBackticks(s) {
  const m = /^`(.+)`$/.exec(s);
  return m ? m[1] : s;
}

// Parse a single GFM table row into {name, description}. Returns null
// for lines that don't look like a 2+ cell row.
export function parseRow(line) {
  const parts = line.split('|');
  // "| name | desc |" splits into ["", " name ", " desc ", ""].
  if (parts.length < 4) return null;
  const name = stripBackticks(parts[1].trim());
  // Defensive join in case a stray pipe appears in the description.
  const description = parts.slice(2, parts.length - 1).join('|').trim();
  if (!name || !description) return null;
  return { name, description };
}

// Find the modes table (header `| Mode | Description |`) and return its
// data rows. Returns [] if no such table exists in `markdown`. The page
// has other 2-col tables (`Rule | Effect` for tool-rule examples,
// `Setting | Description` for managed-only settings, plus a 4-col
// `Pattern | Meaning | Example | Matches` for Read/Edit path-prefix
// syntax) — the `Mode | Description` header signature disambiguates.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Mode\s*\|\s*Description\s*\|/i.test(line)) {
        inTable = true;
      }
      continue;
    }
    // Skip the alignment row (`| :--- | :--- |`).
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

  const modes = buildRecords(markdown);
  if (modes.length === 0) {
    throw new Error('Unexpected page shape: no `Mode | Description` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: modes.length,
    modes,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${modes.length} permission modes → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
