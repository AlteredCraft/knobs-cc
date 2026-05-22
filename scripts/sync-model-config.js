#!/usr/bin/env node
// Fetches the Claude Code model-config docs page (markdown) and writes a
// reshaped catalog of effort levels to catalog/model-config.json.
// Companion to sync-permissions.js — same recipe, different upstream
// table.
//
// What we parse: the `#### Choose an effort level` table —
// `| Level | When to use it |`. That table enumerates the five effort
// levels (`low`, `medium`, `high`, `xhigh`, `max`) with per-value prose
// describing when each is appropriate. It's the natural per-value
// source for the drawer's value-conditional annotation on rows whose
// keyPath is `effortLevel` — the upstream settings JSON Schema only
// carries the enum, not per-value semantics, so the description
// mashes the whole behaviour set into one paragraph.
//
// The page has several other 2-col tables (model aliases, model-level
// support matrix, extended thinking controls, env-var descriptions) —
// the `Level | When to use it` header signature disambiguates.
//
// Idempotence: re-running on unchanged upstream produces a one-line
// diff (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/model-config.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'model-config.json');

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

// Find the effort-levels table (header `| Level | When to use it |`)
// and return its data rows. Returns [] if no such table exists in
// `markdown`. The header signature disambiguates against the page's
// other 2-col tables.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Level\s*\|\s*When to use it\s*\|/i.test(line)) {
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

  const effortLevels = buildRecords(markdown);
  if (effortLevels.length === 0) {
    throw new Error('Unexpected page shape: no `Level | When to use it` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: effortLevels.length,
    effortLevels,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${effortLevels.length} effort levels → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
