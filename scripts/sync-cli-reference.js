#!/usr/bin/env node
// Fetches the Claude Code CLI reference docs page (markdown) and writes
// a reshaped catalog of subcommands and flags to catalog/cli-reference.json.
// Companion to sync-settings.js, sync-env-vars.js, sync-hooks.js,
// sync-sub-agents.js, sync-mcp.js, sync-permissions.js, and
// sync-keybindings.js.
//
// What we parse: the two top-level reference tables on the page —
//   `## CLI commands`  → `| Command | Description | Example |`
//   `## CLI flags`     → `| Flag    | Description | Example |`
// Both are 3-col, structurally identical, and are the canonical
// reference shape for what subcommands and flags exist (~18 commands
// and ~65 flags at time of writing). The page also has a
// `### System prompt flags` subsection with a 4-row `Flag | Behavior |
// Example` table that is a re-statement of four entries already in the
// main flags table; the header signature (`Behavior` not `Description`)
// disambiguates and we deliberately skip it.
//
// Why both tables: the deferred "CLI layer via process argv" plan in
// `spec/roadmap.md` reads another `claude` process's flags via sysinfo.
// Having a documented-flag catalog up front makes the eventual
// flag-name → settings-key mapping (parallel to env-settings-map.json)
// load-bearing reference data, not improvised.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records in each array are sorted by name for
// stable diffs.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/cli-reference.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'cli-reference.json');

const COMMAND_HEADER = /^\|\s*Command\s*\|\s*Description\s*\|\s*Example\s*\|/i;
const FLAG_HEADER = /^\|\s*Flag\s*\|\s*Description\s*\|\s*Example\s*\|/i;

// Strip a single layer of wrapping backticks (`claude` -> claude).
// Only peels when the cell is one inline-code span — multi-span names
// like `--continue`, `-c` (separate spans joined by a comma) keep
// their backticks so the structure is preserved for downstream
// rendering. The `[^`]+` body disallows internal backticks; the
// 2-cell form `--continue`, `-c` doesn't match.
function stripBackticks(s) {
  const m = /^`([^`]+)`$/.exec(s);
  return m ? m[1] : s;
}

// Parse a single GFM 3-col table row into {name, description, example}.
// Returns null for lines that don't look like a 3-cell row, or that
// have an empty name (the primary key).
//
// "| name | desc | example |" splits into
//   ["", " name ", " desc ", " example ", ""]
// — a length of 5. Backslash-escaped pipes (`\|`) inside a cell are
// not separators in GFM (they render as a literal `|`), so we split
// on unescaped `|` only and unescape `\|` → `|` afterwards. This is
// load-bearing on the real CLI page: the `cat file \| claude -p
// "query"` command row would otherwise split into garbage.
//
// Stray *unescaped* pipes inside a cell would still push length > 5;
// we defensively assume those belong to the description column and
// rejoin parts[2..length-2]. Upstream cells don't have unescaped
// embedded pipes today, but the join keeps the parser robust.
export function parseRow(line) {
  // Split on `|` not preceded by `\`, then unescape the survivors.
  const parts = line.split(/(?<!\\)\|/).map((p) => p.replace(/\\\|/g, '|'));
  if (parts.length < 5) return null;
  const name = stripBackticks(parts[1].trim());
  if (!name) return null;
  const example = parts[parts.length - 2].trim();
  const description = parts.slice(2, parts.length - 2).join('|').trim();
  return { name, description, example };
}

// Find a 3-col table identified by a header regex and return its data
// rows. Returns [] if no matching table exists in `markdown`. Each
// invocation scans from the top and stops at the first non-pipe line
// after entering its table — so calling parseTable twice (once per
// header) on the same markdown extracts both `## CLI commands` and
// `## CLI flags` cleanly without one consuming the other.
export function parseTable(markdown, headerPattern) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (headerPattern.test(line)) inTable = true;
      continue;
    }
    // Skip the alignment row (`| :--- | :--- | :--- |`).
    if (/^\|\s*:?-+:?\s*\|/.test(line)) continue;
    // First non-pipe line ends the table.
    if (!line.startsWith('|')) break;
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  return rows;
}

// Compose the full record set from raw markdown. Pure function: easy
// to drive from tests with a small fixture string.
export function buildRecords(markdown) {
  const commands = parseTable(markdown, COMMAND_HEADER);
  const flags = parseTable(markdown, FLAG_HEADER);
  commands.sort((a, b) => a.name.localeCompare(b.name));
  flags.sort((a, b) => a.name.localeCompare(b.name));
  return { commands, flags };
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${SOURCE} → HTTP ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();

  const { commands, flags } = buildRecords(markdown);
  if (commands.length === 0) {
    throw new Error('Unexpected page shape: no `Command | Description | Example` table found');
  }
  if (flags.length === 0) {
    throw new Error('Unexpected page shape: no `Flag | Description | Example` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    commandCount: commands.length,
    flagCount: flags.length,
    commands,
    flags,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(
    `Wrote ${commands.length} commands + ${flags.length} flags → ${OUT}`,
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
