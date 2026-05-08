import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseTable, buildRecords } from './sync-keybindings.js';

test('parseRow extracts name and description from a typical row', () => {
  const row = parseRow('| `Global` | Applies everywhere in the app |');
  assert.deepEqual(row, {
    name: 'Global',
    description: 'Applies everywhere in the app',
  });
});

test('parseRow strips wrapping backticks from the name', () => {
  const row = parseRow('| `Chat` | x |');
  assert.equal(row.name, 'Chat');
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
  assert.equal(parseRow('| `Global` |  |'), null);
});

test('parseRow preserves backticks and inline code spans inside the description', () => {
  const row = parseRow(
    '| `HistorySearch` | History search mode (Ctrl+R) |',
  );
  assert.equal(row.description, 'History search mode (Ctrl+R)');
});

test('parseRow handles a stray pipe inside the description by joining defensively', () => {
  // A description containing a pipe gets re-joined; the cell should
  // round-trip through parse with the pipe intact.
  const row = parseRow('| `Global` | left | right |');
  assert.equal(row.description, 'left | right');
});

test('parseTable returns rows from a minimal contexts table', () => {
  const md = [
    '| Context | Description |',
    '| :--- | :--- |',
    '| `Global` | first |',
    '| `Chat` | second |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Global', 'Chat'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Context | Description |',
    '| :------- | :------- |',
    '| `Global` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Global');
});

test('parseTable stops at the first non-pipe line after the header', () => {
  const md = [
    '| Context | Description |',
    '| :--- | :--- |',
    '| `Global` | x |',
    '',
    'Some prose after the table.',
    '| ignored | not-counted |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['Global']);
});

test('parseTable returns [] when no Context|Description table is present', () => {
  // The page has other 2-col tables — `Field | Description` (config
  // schema), `Shortcut | Reason` (reserved), `Shortcut | Conflict`
  // (terminal multiplexer conflicts). The `Context | Description`
  // header signature must disambiguate.
  const md = [
    '| Field      | Description                                        |',
    '| :--------- | :------------------------------------------------- |',
    '| `$schema`  | Optional JSON Schema URL for editor autocompletion |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable does not confuse the reserved-shortcuts table for contexts', () => {
  // Reserved shortcuts uses `Shortcut | Reason`, structurally identical
  // to `Context | Description` but with different headers. Header
  // signature must match `Context` and `Description` specifically.
  const md = [
    '| Shortcut  | Reason                                         |',
    '| :-------- | :--------------------------------------------- |',
    '| Ctrl+C    | Hardcoded interrupt/cancel                     |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable does not pick up rows from the 3-col Action|Default|Description tables', () => {
  // The bulk of the page is per-context action tables that share the
  // shape `Action | Default | Description`. Without a `Context |
  // Description` header, those rows must not appear in the output.
  const md = [
    '| Action          | Default   | Description                 |',
    '| :-------------- | :-------- | :-------------------------- |',
    '| `app:interrupt` | Ctrl+C    | Cancel current operation    |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable matches the header case-insensitively and tolerates extra whitespace', () => {
  const md = [
    '|  context  |  DESCRIPTION  |',
    '| :--- | :--- |',
    '| `Global` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '## Contexts',
    '',
    'Each binding block specifies a **context** where the bindings apply:',
    '',
    '| Context | Description |',
    '| :--- | :--- |',
    '| `Global` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['Global']);
});

test('buildRecords sorts by name', () => {
  const md = [
    '| Context | Description |',
    '| :--- | :--- |',
    '| `Global` | last alphabetically (G > C > A) |',
    '| `Autocomplete` | first alphabetically |',
    '| `Chat` | middle |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['Autocomplete', 'Chat', 'Global'],
  );
});

test('buildRecords preserves description verbatim for downstream re-parsing', () => {
  const md = [
    '| Context | Description |',
    '| :--- | :--- |',
    '| `Scroll` | Conversation scrolling and text selection in fullscreen mode |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(
    r.description,
    'Conversation scrolling and text selection in fullscreen mode',
  );
});
