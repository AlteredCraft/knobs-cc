import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRow,
  parseTable,
  extractDefault,
  buildRecords,
} from './sync-env-vars.js';

test('parseRow extracts name and purpose from a typical row', () => {
  const row = parseRow('| `FOO` | does a thing |');
  assert.deepEqual(row, { name: 'FOO', purpose: 'does a thing' });
});

test('parseRow strips wrapping backticks from the name', () => {
  const row = parseRow('| `API_TIMEOUT_MS` | t |');
  assert.equal(row.name, 'API_TIMEOUT_MS');
});

test('parseRow leaves a name without backticks alone', () => {
  const row = parseRow('| BARE | t |');
  assert.equal(row.name, 'BARE');
});

test('parseRow returns null for a line without enough cells', () => {
  assert.equal(parseRow('not a row'), null);
  assert.equal(parseRow('| only-one-cell |'), null);
});

test('parseRow returns null when name or purpose is empty', () => {
  assert.equal(parseRow('|  |  |'), null);
  assert.equal(parseRow('| `FOO` |  |'), null);
});

test('parseRow preserves backticks inside the purpose cell', () => {
  const row = parseRow('| `FOO` | set to `1` to enable |');
  assert.equal(row.purpose, 'set to `1` to enable');
});

test('extractDefault captures a simple integer default', () => {
  assert.equal(
    extractDefault('Timeout for API requests (default: 600000, or 10 minutes)'),
    '600000',
  );
});

test('extractDefault returns null when no default: prose is present', () => {
  assert.equal(extractDefault('Set to `1` to enable foo'), null);
});

test('extractDefault is case-sensitive — "Defaults to" does not match', () => {
  assert.equal(extractDefault('Defaults to 20 seconds on most platforms'), null);
});

test('extractDefault strips a trailing closing paren', () => {
  assert.equal(extractDefault('(default: 5000)'), '5000');
});

test('extractDefault strips a trailing semicolon', () => {
  assert.equal(extractDefault('default: 600000; maximum: 2147483647'), '600000');
});

test('extractDefault strips a trailing period', () => {
  assert.equal(extractDefault('Set the limit. default: 10.'), '10');
});

test('extractDefault strips wrapping backticks around the value', () => {
  assert.equal(extractDefault('default: `~/.claude`'), '~/.claude');
});

test('extractDefault strips both trailing punctuation and wrapping backticks', () => {
  // Real upstream: `Override the configuration directory (default: \`~/.claude\`). ...`
  assert.equal(
    extractDefault('Override the configuration directory (default: `~/.claude`). All settings'),
    '~/.claude',
  );
});

test('extractDefault takes only the first match when multiple appear', () => {
  assert.equal(
    extractDefault('default: 5000 (some prose) default: 9999'),
    '5000',
  );
});

test('extractDefault is lossy on "No default: <prose>" — documented limitation', () => {
  // The spec accepts lossy parsing as long as raw `purpose` is preserved,
  // and prescribes the regex `default:\s*(\S+)`. This input matches it.
  assert.equal(
    extractDefault('No default: without this variable, x waits'),
    'without',
  );
});

test('parseTable returns rows from a minimal table', () => {
  const md = [
    '| Variable | Purpose |',
    '| :--- | :--- |',
    '| `FOO` | first |',
    '| `BAR` | second |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['FOO', 'BAR'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Variable | Purpose |',
    '| :------- | :------ |',
    '| `FOO` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'FOO');
});

test('parseTable stops at the first line that is not a table row', () => {
  const md = [
    '| Variable | Purpose |',
    '| :--- | :--- |',
    '| `FOO` | x |',
    '',
    'Some prose after the table.',
    '| `IGNORED` | not part of the table |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['FOO'],
  );
});

test('parseTable returns [] when the env-vars header is absent', () => {
  const md = '| Other | Header |\n| :--- | :--- |\n| `X` | y |';
  assert.deepEqual(parseTable(md), []);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '# Environment variables',
    '',
    'Some intro text with a `code` span.',
    '',
    '| Variable | Purpose |',
    '| :--- | :--- |',
    '| `FOO` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['FOO']);
});

test('buildRecords sorts by name and attaches default', () => {
  const md = [
    '| Variable | Purpose |',
    '| :--- | :--- |',
    '| `ZED` | last alphabetically |',
    '| `API_TIMEOUT_MS` | timeout (default: 600000, or 10 minutes) |',
    '| `MID` | no default mentioned |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['API_TIMEOUT_MS', 'MID', 'ZED'],
  );
  assert.equal(records[0].default, '600000');
  assert.equal(records[1].default, null);
  assert.equal(records[2].default, null);
});

test('buildRecords preserves raw purpose verbatim for downstream re-parsing', () => {
  const md = [
    '| Variable | Purpose |',
    '| :--- | :--- |',
    '| `FOO` | timeout (default: 30000, or 30 seconds) |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(r.purpose, 'timeout (default: 30000, or 30 seconds)');
  assert.equal(r.default, '30000');
});
