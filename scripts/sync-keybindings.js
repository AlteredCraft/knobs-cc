#!/usr/bin/env node
// Fetches the Claude Code keybindings docs page (markdown) and writes a
// reshaped catalog of binding contexts to catalog/keybindings.json.
// Companion to sync-settings.js, sync-env-vars.js, sync-hooks.js,
// sync-sub-agents.js, sync-mcp.js, and sync-permissions.js.
//
// What we parse: the `## Contexts` table — `| Context | Description |`.
// That table enumerates every value the `context` field accepts inside
// a `bindings` block of `~/.claude/keybindings.json` (Global, Chat,
// Autocomplete, Settings, Confirmation, Tabs, Help, Transcript,
// HistorySearch, Task, ThemePicker, Attachments, Footer,
// MessageSelector, DiffDialog, ModelPicker, Select, Plugin, Scroll,
// Doctor — 20 contexts at time of writing). The page documents far
// more (per-context action tables, keystroke syntax, reserved
// shortcuts, terminal conflicts, vim-mode interaction, …) but those
// either live under prose-heavy sections or are split across many
// 3-col `Action | Default | Description` tables that need to be
// associated with their owning `### foo actions` heading; the
// contexts table is the smallest useful artifact and the natural
// parallel to catalog/permissions.json (`Mode | Description`) and
// catalog/mcp.json (`Scope | Loads in | Shared with team | Stored in`).
// A future pass can capture the per-context action tables.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/keybindings.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'keybindings.json');

// Strip a single layer of wrapping backticks (`Global` -> Global). Leaves
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

// Find the contexts table (header `| Context | Description |`) and
// return its data rows. Returns [] if no such table exists in
// `markdown`. The page has several other 2-col tables (`Field |
// Description` for the config schema; `Shortcut | Reason` for reserved
// shortcuts; `Shortcut | Conflict` for terminal multiplexer conflicts)
// — the `Context | Description` header signature disambiguates.
// 3-col `Action | Default | Description` tables fail the `len < 4` row
// check naturally and are not reachable here regardless.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Context\s*\|\s*Description\s*\|/i.test(line)) {
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

  const contexts = buildRecords(markdown);
  if (contexts.length === 0) {
    throw new Error('Unexpected page shape: no `Context | Description` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: contexts.length,
    contexts,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${contexts.length} keybinding contexts → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
