import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseTable, buildRecords } from './sync-model-config.js';

test('parseRow extracts name and description from a typical row', () => {
  const row = parseRow('| `low` | Reserve for short, scoped tasks |');
  assert.deepEqual(row, {
    name: 'low',
    description: 'Reserve for short, scoped tasks',
  });
});

test('parseRow strips wrapping backticks from the name', () => {
  const row = parseRow('| `xhigh` | x |');
  assert.equal(row.name, 'xhigh');
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
  assert.equal(parseRow('| `low` |  |'), null);
});

test('parseRow preserves inline code spans inside the description', () => {
  // Effort-level prose references other levels by name, e.g. "to reduce
  // token spend relative to `xhigh`" — those backticks must survive.
  const row = parseRow(
    '| `high` | Balances token usage and intelligence. Use as a minimum, or to reduce token spend relative to `xhigh` |',
  );
  assert.equal(
    row.description,
    'Balances token usage and intelligence. Use as a minimum, or to reduce token spend relative to `xhigh`',
  );
});

test('parseRow handles a stray pipe inside the description by joining defensively', () => {
  const row = parseRow('| `low` | left | right |');
  assert.equal(row.description, 'left | right');
});

test('parseTable returns rows from a minimal effort-levels table', () => {
  const md = [
    '| Level | When to use it |',
    '| :--- | :--- |',
    '| `low` | first |',
    '| `medium` | second |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['low', 'medium'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Level | When to use it |',
    '| :------- | :------- |',
    '| `low` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'low');
});

test('parseTable stops at the first non-pipe line after the header', () => {
  const md = [
    '| Level | When to use it |',
    '| :--- | :--- |',
    '| `low` | x |',
    '',
    'Some prose after the table.',
    '| ignored | not-counted |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['low']);
});

test('parseTable returns [] when no Level|When-to-use-it table is present', () => {
  // The page has several other 2-col tables — model aliases
  // (`Model alias | Behavior`), the model-support matrix
  // (`Model | Levels`), env vars (`Environment variable | Description`).
  // The `Level | When to use it` header signature must disambiguate.
  const md = [
    '| Model alias | Behavior |',
    '| :--- | :--- |',
    '| `opus` | Uses the latest Opus model |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable does not confuse the model-support matrix for the effort-levels table', () => {
  // `Model | Levels` shares the upstream `### Adjust effort level`
  // section with the effort-levels table; the header signature must
  // match specifically on Level (singular) + When to use it.
  const md = [
    '| Model | Levels |',
    '| :--- | :--- |',
    '| Opus 4.7 | `low`, `medium`, `high`, `xhigh`, `max` |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable matches the header case-insensitively and tolerates extra whitespace', () => {
  const md = [
    '|  level  |  WHEN TO USE IT  |',
    '| :--- | :--- |',
    '| `low` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '#### Choose an effort level',
    '',
    'Some intro prose with `code`.',
    '',
    '| Level | When to use it |',
    '| :--- | :--- |',
    '| `low` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['low']);
});

test('buildRecords sorts by name', () => {
  const md = [
    '| Level | When to use it |',
    '| :--- | :--- |',
    '| `xhigh` | fourth alphabetically |',
    '| `low` | second alphabetically |',
    '| `high` | first alphabetically |',
    '| `medium` | third alphabetically |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['high', 'low', 'medium', 'xhigh'],
  );
});

test('buildRecords preserves description verbatim for downstream re-parsing', () => {
  const md = [
    '| Level | When to use it |',
    '| :--- | :--- |',
    '| `max` | Can improve performance on demanding tasks but may show diminishing returns and is prone to overthinking. Test before adopting broadly |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(
    r.description,
    'Can improve performance on demanding tasks but may show diminishing returns and is prone to overthinking. Test before adopting broadly',
  );
});
