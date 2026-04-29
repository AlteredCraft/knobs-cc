#!/usr/bin/env node
// Fetches the Claude Code env-vars docs page (markdown) and writes a
// reshaped catalog to catalog/env-vars.json. Companion to sync-settings.js.
//
// Why parse markdown instead of a JSON Schema: env-vars has no schema
// sibling. The page is structurally simple — one 2-column table
// (`Variable | Purpose`) with backtick-wrapped names in column 1 and
// free-form prose in column 2. Defaults, ranges, and constraints are
// not in dedicated columns; they're embedded in the prose
// (`default: 600000, or 10 minutes; maximum: 2147483647`).
//
// What the reshape buys us:
//   - Flat list of {name, purpose, default} records, one per row.
//   - Best-effort `default` extraction via the regex in spec/catalog-sync.md
//     (`default:\s*(\S+)`). When no `default:` appears we record `null`
//     rather than guess. Raw `purpose` is preserved verbatim, so a
//     consumer that needs more (ranges, units) can re-parse.
//   - Provenance envelope. source, fetchedAt, and count ride alongside
//     the records.
//
// Idempotence: re-running on unchanged upstream produces a one-line diff
// (fetchedAt only). Records are sorted by name.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://code.claude.com/docs/en/env-vars.md';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'env-vars.json');

// Strip a single layer of wrapping backticks (`NAME` -> NAME). Leaves
// strings without wrapping backticks untouched.
function stripBackticks(s) {
  const m = /^`(.+)`$/.exec(s);
  return m ? m[1] : s;
}

// Parse a single GFM table row into {name, purpose}. Returns null for
// lines that don't look like a 2+ cell row.
export function parseRow(line) {
  const parts = line.split('|');
  // "| name | purpose |" splits into ["", " name ", " purpose ", ""].
  if (parts.length < 4) return null;
  const name = stripBackticks(parts[1].trim());
  // Defensive join in case a stray pipe appears in the purpose cell.
  const purpose = parts.slice(2, parts.length - 1).join('|').trim();
  if (!name || !purpose) return null;
  return { name, purpose };
}

// Find the env-vars table (header `| Variable | Purpose |`) and return
// its data rows. Returns [] if no such table exists in `markdown`.
export function parseTable(markdown) {
  const lines = markdown.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*Variable\s*\|\s*Purpose\s*\|/i.test(line)) {
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

// Best-effort `default` extraction per spec/catalog-sync.md: capture the
// first `\S+` after `default:`, then strip wrapping backticks and
// trailing prose punctuation that bleeds in (`,`, `;`, `.`, `)`).
//
// Known lossy case: "No default: <prose>" matches and returns the first
// word of the prose. The spec accepts lossiness as long as raw `purpose`
// is preserved — consumers can re-parse if needed.
export function extractDefault(purpose) {
  const m = /default:\s*(\S+)/.exec(purpose);
  if (!m) return null;
  // Strip trailing prose punctuation first so the backtick-anchor below
  // still matches when the captured token is e.g. `` `~/.claude`). ``.
  const cleaned = m[1].replace(/[.,;)]+$/, '').replace(/^`(.+)`$/, '$1');
  return cleaned || null;
}

// Compose the full record list from raw markdown. Pure function: easy
// to drive from tests with a small fixture string.
export function buildRecords(markdown) {
  const rows = parseTable(markdown);
  const records = rows.map((r) => ({
    name: r.name,
    purpose: r.purpose,
    default: extractDefault(r.purpose),
  }));
  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${SOURCE} → HTTP ${res.status} ${res.statusText}`);
  }
  const markdown = await res.text();

  const envVars = buildRecords(markdown);
  if (envVars.length === 0) {
    throw new Error('Unexpected page shape: no `Variable | Purpose` table found');
  }

  const envelope = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    count: envVars.length,
    envVars,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${envVars.length} env vars → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
