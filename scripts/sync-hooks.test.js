import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRow,
  parseTable,
  buildRecords,
} from './sync-hooks.js';

test('parseRow extracts name and when from a typical row', () => {
  const row = parseRow('| `SessionStart` | When a session begins or resumes |');
  assert.deepEqual(row, { name: 'SessionStart', when: 'When a session begins or resumes' });
});

test('parseRow strips wrapping backticks from the name', () => {
  const row = parseRow('| `PreToolUse` | Before a tool call executes |');
  assert.equal(row.name, 'PreToolUse');
});

test('parseRow leaves a name without backticks alone', () => {
  const row = parseRow('| BARE | x |');
  assert.equal(row.name, 'BARE');
});

test('parseRow returns null for a line without enough cells', () => {
  assert.equal(parseRow('not a row'), null);
  assert.equal(parseRow('| only-one-cell |'), null);
});

test('parseRow returns null when name or when is empty', () => {
  assert.equal(parseRow('|  |  |'), null);
  assert.equal(parseRow('| `FOO` |  |'), null);
});

test('parseRow preserves backticks inside the when cell', () => {
  const row = parseRow('| `Setup` | When you start Claude Code with `--init-only` |');
  assert.equal(row.when, 'When you start Claude Code with `--init-only`');
});

test('parseTable returns rows from a minimal table', () => {
  const md = [
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `SessionStart` | first |',
    '| `Stop` | second |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['SessionStart', 'Stop'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Event | When it fires |',
    '| :------- | :------ |',
    '| `Stop` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Stop');
});

test('parseTable stops at the first line that is not a table row', () => {
  const md = [
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `Stop` | x |',
    '',
    'Some prose after the table.',
    '| `IGNORED` | not part of the table |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Stop'],
  );
});

test('parseTable returns [] when the lifecycle header is absent', () => {
  const md = '| Other | Header |\n| :--- | :--- |\n| `X` | y |';
  assert.deepEqual(parseTable(md), []);
});

test('parseTable does not match the matcher-mapping table whose second column differs', () => {
  // The hooks page has a separate table starting `| Event | What the matcher filters | ... |`.
  // Our header regex requires the second column to be "When it fires" so this should not match.
  const md = [
    '| Event | What the matcher filters | Example matcher values |',
    '| :--- | :--- | :--- |',
    '| `PreToolUse` | tool name | `Bash` |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '# Hooks reference',
    '',
    'Some intro text with a `code` span.',
    '',
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `SessionStart` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['SessionStart']);
});

test('parseTable header match is case-insensitive', () => {
  const md = [
    '| event | WHEN IT FIRES |',
    '| :--- | :--- |',
    '| `SessionStart` | x |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['SessionStart']);
});

test('buildRecords sorts by name', () => {
  const md = [
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `Stop` | end of turn |',
    '| `PreToolUse` | before a tool |',
    '| `SessionStart` | session begins |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['PreToolUse', 'SessionStart', 'Stop'],
  );
});

test('buildRecords preserves cadence prose verbatim', () => {
  const md = [
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `PermissionDenied` | When a tool call is denied by the auto mode classifier. Return `{retry: true}` to tell the model it may retry the denied tool call |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(r.name, 'PermissionDenied');
  assert.equal(
    r.when,
    'When a tool call is denied by the auto mode classifier. Return `{retry: true}` to tell the model it may retry the denied tool call',
  );
});
