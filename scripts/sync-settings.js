#!/usr/bin/env node
// Fetches the Claude Code settings JSON Schema from schemastore and writes
// a reshaped catalog to catalog/settings.json. The reshape is the point;
// without it this would be a one-line curl.
//
// What the reshape buys us:
//   - Flat shape. Nested schemas (permissions, sandbox, hooks, ...) are
//     flattened into dotted-key rows so the consumer iterates a single
//     array instead of recursing into JSON Schema's `properties`.
//   - Field allowlist. Only the fields we consume (type, default, enum,
//     description, examples, $ref, anyOf/oneOf/allOf, items, ...) are
//     preserved. Unrelated JSON Schema metadata upstream doesn't churn
//     our committed catalog.
//   - Provenance envelope. source, schemaId, fetchedAt, and count are
//     written alongside the settings list so a consumer can trust where
//     the data came from.
//
// Idempotence: re-running on unchanged upstream produces a single-line
// diff (fetchedAt only). Settings are sorted by key for stable ordering.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE = 'https://json.schemastore.org/claude-code-settings.json';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(SCRIPT_DIR, '..', 'catalog', 'settings.json');

const FIELDS = [
  'type', 'const', 'enum', 'default',
  'minimum', 'maximum', 'pattern', 'minLength', 'maxLength',
  'examples', 'description', '$ref',
  'anyOf', 'oneOf', 'allOf',
];

export function pickFields(node) {
  const out = {};
  for (const f of FIELDS) {
    if (node[f] !== undefined) out[f] = node[f];
  }
  if (node.items !== undefined) {
    const items = {};
    for (const f of FIELDS) {
      if (node.items[f] !== undefined) items[f] = node.items[f];
    }
    out.items = items;
  }
  return out;
}

export function walk(properties, prefix, settings) {
  for (const [name, node] of Object.entries(properties)) {
    const key = prefix ? `${prefix}.${name}` : name;
    settings.push({ key, ...pickFields(node) });
    if (node.type === 'object' && node.properties) {
      walk(node.properties, key, settings);
    }
  }
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${SOURCE} → HTTP ${res.status} ${res.statusText}`);
  }
  const schema = await res.json();
  if (!schema.properties || typeof schema.properties !== 'object') {
    throw new Error('Unexpected schema shape: missing top-level "properties" object');
  }

  const settings = [];
  walk(schema.properties, '', settings);
  settings.sort((a, b) => a.key.localeCompare(b.key));

  const envelope = {
    source: SOURCE,
    schemaId: schema.$id ?? null,
    fetchedAt: new Date().toISOString(),
    count: settings.length,
    settings,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(envelope, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${settings.length} settings → ${OUT}`);
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
