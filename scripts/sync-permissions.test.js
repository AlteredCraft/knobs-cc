import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseTable, buildRecords } from './sync-permissions.js';

test('parseRow extracts name and description from a typical row', () => {
  const row = parseRow('| `default` | Standard behavior: prompts for permission |');
  assert.deepEqual(row, {
    name: 'default',
    description: 'Standard behavior: prompts for permission',
  });
});

test('parseRow strips wrapping backticks from the name', () => {
  const row = parseRow('| `acceptEdits` | x |');
  assert.equal(row.name, 'acceptEdits');
});

test('parseRow leaves a bare name alone', () => {
  const row = parseRow('| bare | x |');
  assert.equal(row.name, 'bare');
});

test('parseRow returns null for a line without enough cells', () => {
  assert.equal(parseRow('not a row'), null);
  assert.equal(parseRow('| only-one |'), null);
});

test('parseRow returns null when name or description is empty', () => {
  assert.equal(parseRow('|  | x |'), null);
  assert.equal(parseRow('| `default` |  |'), null);
});

test('parseRow preserves backticks and inline code spans inside the description', () => {
  const row = parseRow(
    '| `acceptEdits` | Accepts edits and `mkdir`, `touch`, `mv`, `cp` for paths |',
  );
  assert.equal(
    row.description,
    'Accepts edits and `mkdir`, `touch`, `mv`, `cp` for paths',
  );
});

test('parseRow handles a stray pipe inside the description by joining defensively', () => {
  // A description containing a pipe gets re-joined; the cell should
  // round-trip through parse with the pipe intact.
  const row = parseRow('| `default` | left | right |');
  assert.equal(row.description, 'left | right');
});

test('parseTable returns rows from a minimal modes table', () => {
  const md = [
    '| Mode | Description |',
    '| :--- | :--- |',
    '| `default` | first |',
    '| `acceptEdits` | second |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['default', 'acceptEdits'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Mode | Description |',
    '| :------- | :------- |',
    '| `default` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'default');
});

test('parseTable stops at the first non-pipe line after the header', () => {
  const md = [
    '| Mode | Description |',
    '| :--- | :--- |',
    '| `default` | x |',
    '',
    'Some prose after the table.',
    '| ignored | not-counted |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['default']);
});

test('parseTable returns [] when no Mode|Description table is present', () => {
  // The page has other 2-col tables — `Rule | Effect` (twice) and
  // `Setting | Description` (managed-only settings). The
  // `Mode | Description` header signature must disambiguate.
  const md = [
    '| Rule | Effect |',
    '| :--- | :--- |',
    '| `Bash` | Matches all Bash commands |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable does not confuse the managed-only Setting|Description table for modes', () => {
  // Managed-only settings table uses `Setting | Description`, which is
  // structurally identical to `Mode | Description` but with a different
  // header. Header signature must match `Mode` specifically.
  const md = [
    '| Setting | Description |',
    '| :--- | :--- |',
    '| `allowManagedHooksOnly` | Only managed hooks load |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable matches the header case-insensitively and tolerates extra whitespace', () => {
  const md = [
    '|  mode  |  DESCRIPTION  |',
    '| :--- | :--- |',
    '| `default` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '## Permission modes',
    '',
    'Some intro prose with `code`.',
    '',
    '| Mode | Description |',
    '| :--- | :--- |',
    '| `default` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['default']);
});

test('buildRecords sorts by name', () => {
  const md = [
    '| Mode | Description |',
    '| :--- | :--- |',
    '| `plan` | last alphabetically |',
    '| `acceptEdits` | first alphabetically |',
    '| `default` | middle |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['acceptEdits', 'default', 'plan'],
  );
});

test('buildRecords preserves description verbatim for downstream re-parsing', () => {
  const md = [
    '| Mode | Description |',
    '| :--- | :--- |',
    '| `bypassPermissions` | Skips all permission prompts. Root and home directory removals such as `rm -rf /` still prompt as a circuit breaker |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(
    r.description,
    'Skips all permission prompts. Root and home directory removals such as `rm -rf /` still prompt as a circuit breaker',
  );
});
