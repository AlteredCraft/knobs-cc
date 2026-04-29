#!/usr/bin/env node
// Fetches the Claude Code hooks docs page (markdown) and writes a
// reshaped catalog of hook events to catalog/hooks.json. Companion to
// sync-settings.js and sync-env-vars.js.
//
// What we parse: the lifecycle summary table near the top of the page,
// `| Event | When it fires |`, which lists every hook event with a
// one-line cadence description. The page also documents per-event input
// schemas, decision-control fields, and handler types (command, http,
// mcp_tool, prompt, agent), but those live under prose-heavy `###` and
// `####` sections and are out of scope for this first cut. The events
// list is the smallest useful artifact and parallels the shape of
// catalog/env-vars.json.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/hooks.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'hooks.json');

// Strip a single layer of wrapping backticks (`NAME` -> NAME). Leaves
// strings without wrapping backticks untouched.
function stripBackticks(s) {
  const m = /^`(.+)`$/.exec(s);
  return m ? m[1] : s;
}

// Parse a single GFM table row into {name, when}. Returns null for
// lines that don't look like a 2+ cell row.
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

  const events = buildRecords(markdown);
  if (events.length === 0) {
    throw new Error('Unexpected page shape: no `Event | When it fires` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: events.length,
    events,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${events.length} hook events → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
