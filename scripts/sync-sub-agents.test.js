import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseTable, buildRecords } from './sync-sub-agents.js';

test('parseRow extracts name, required, description from a typical row', () => {
  const row = parseRow('| `name` | Yes | Unique identifier |');
  assert.deepEqual(row, {
    name: 'name',
    required: true,
    description: 'Unique identifier',
  });
});

test('parseRow strips wrapping backticks from the name', () => {
  const row = parseRow('| `permissionMode` | No | Permission mode |');
  assert.equal(row.name, 'permissionMode');
});

test('parseRow leaves a name without backticks alone', () => {
  const row = parseRow('| bare | No | desc |');
  assert.equal(row.name, 'bare');
});

test('parseRow normalizes "Yes" (any case) to required=true', () => {
  assert.equal(parseRow('| `name` | Yes | d |').required, true);
  assert.equal(parseRow('| `name` | YES | d |').required, true);
  assert.equal(parseRow('| `name` | yes | d |').required, true);
});

test('parseRow normalizes anything-but-Yes to required=false', () => {
  assert.equal(parseRow('| `tools` | No | d |').required, false);
  assert.equal(parseRow('| `tools` |  | d |').required, false);
  assert.equal(parseRow('| `tools` | Optional | d |').required, false);
});

test('parseRow returns null for a line without enough cells', () => {
  assert.equal(parseRow('not a row'), null);
  assert.equal(parseRow('| only-one |'), null);
  assert.equal(parseRow('| a | b |'), null);
});

test('parseRow returns null when name or description is empty', () => {
  assert.equal(parseRow('|  | Yes | d |'), null);
  assert.equal(parseRow('| `name` | Yes |  |'), null);
});

test('parseRow preserves backticks and links inside the description cell', () => {
  const row = parseRow('| `model` | No | [Model](#choose-a-model) — `sonnet`, `opus`, … |');
  assert.equal(row.description, '[Model](#choose-a-model) — `sonnet`, `opus`, …');
});

test('parseRow handles a stray pipe inside the description by joining defensively', () => {
  // A description containing a pipe gets re-joined; the cell should
  // round-trip through parse with the pipe intact.
  const row = parseRow('| `name` | No | left | right |');
  assert.equal(row.description, 'left | right');
});

test('parseTable returns rows from a minimal table', () => {
  const md = [
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `name` | Yes | first |',
    '| `tools` | No | second |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['name', 'tools'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Field | Required | Description |',
    '| :------- | :------ | :------ |',
    '| `name` | Yes | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'name');
});

test('parseTable stops at the first line that is not a table row', () => {
  const md = [
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `name` | Yes | x |',
    '',
    'Some prose after the table.',
    '| `ignored` | No | not part of the table |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['name'],
  );
});

test('parseTable returns [] when the frontmatter header is absent', () => {
  // The page's "Other" built-in subagents tab uses `| Agent | Model | When ... |`,
  // which must not be confused with the frontmatter-fields table.
  const md = [
    '| Agent | Model | When Claude uses it |',
    '| :--- | :--- | :--- |',
    '| statusline-setup | Sonnet | x |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '# Subagents',
    '',
    'Some intro text with a `code` span.',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `name` | Yes | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['name']);
});

test('buildRecords sorts by name', () => {
  const md = [
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `tools` | No | last alphabetically |',
    '| `description` | Yes | when to delegate |',
    '| `name` | Yes | identifier |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['description', 'name', 'tools'],
  );
});

test('buildRecords preserves description verbatim for downstream re-parsing', () => {
  const md = [
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `model` | No | [Model](#choose-a-model) to use: `sonnet`, `opus`, `haiku` |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(
    r.description,
    '[Model](#choose-a-model) to use: `sonnet`, `opus`, `haiku`',
  );
});
