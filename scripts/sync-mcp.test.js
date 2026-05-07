import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseTable, buildRecords } from './sync-mcp.js';

test('parseRow extracts name from a [Link](#anchor) cell', () => {
  const row = parseRow(
    '| [Local](#local-scope) | Current project only | No | `~/.claude.json` |',
  );
  assert.deepEqual(row, {
    name: 'Local',
    loadsIn: 'Current project only',
    shared: 'No',
    storedIn: '`~/.claude.json`',
  });
});

test('parseRow strips wrapping backticks from the name when no link is present', () => {
  const row = parseRow('| `Local` | x | y | z |');
  assert.equal(row.name, 'Local');
});

test('parseRow leaves a bare name alone', () => {
  const row = parseRow('| Local | x | y | z |');
  assert.equal(row.name, 'Local');
});

test('parseRow preserves backticks and prose in the storedIn cell', () => {
  const row = parseRow(
    '| [Project](#project-scope) | Current project only | Yes, via version control | `.mcp.json` in project root |',
  );
  assert.equal(row.storedIn, '`.mcp.json` in project root');
  assert.equal(row.shared, 'Yes, via version control');
});

test('parseRow returns null for a line without enough cells', () => {
  assert.equal(parseRow('not a row'), null);
  assert.equal(parseRow('| only-one |'), null);
  assert.equal(parseRow('| a | b | c |'), null);
});

test('parseRow returns null when any of the four cells is empty', () => {
  assert.equal(parseRow('|  | x | y | z |'), null);
  assert.equal(parseRow('| Local |  | y | z |'), null);
  assert.equal(parseRow('| Local | x |  | z |'), null);
  assert.equal(parseRow('| Local | x | y |  |'), null);
});

test('parseRow handles a stray pipe inside the storedIn cell by joining defensively', () => {
  // Defensive: the rightmost column should round-trip even if it
  // contains a pipe character.
  const row = parseRow('| Local | x | y | left | right |');
  assert.equal(row.storedIn, 'left | right');
});

test('parseTable returns rows from a minimal scopes table', () => {
  const md = [
    '| Scope | Loads in | Shared with team | Stored in |',
    '| :--- | :--- | :--- | :--- |',
    '| [Local](#local-scope) | Current project only | No | `~/.claude.json` |',
    '| [Project](#project-scope) | Current project only | Yes, via version control | `.mcp.json` in project root |',
    '| [User](#user-scope) | All your projects | No | `~/.claude.json` |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Local', 'Project', 'User'],
  );
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Scope | Loads in | Shared with team | Stored in |',
    '| :------- | :------- | :------- | :------- |',
    '| Local | x | No | y |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Local');
});

test('parseTable stops at the first non-pipe line after the header', () => {
  const md = [
    '| Scope | Loads in | Shared with team | Stored in |',
    '| :--- | :--- | :--- | :--- |',
    '| Local | x | No | y |',
    '',
    'Some prose after the table.',
    '| ignored | row | not | counted |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Local'],
  );
});

test('parseTable returns [] when no table with the scopes header is present', () => {
  // Other tables on the page (env-vars for OAuth handlers, tool-search
  // threshold values) must not be confused with the scopes table.
  const md = [
    '| Variable | Value |',
    '| :--- | :--- |',
    '| `CLAUDE_CODE_MCP_SERVER_NAME` | the name of the MCP server |',
  ].join('\n');
  assert.deepEqual(parseTable(md), []);
});

test('parseTable matches the header case-insensitively and tolerates extra whitespace', () => {
  const md = [
    '|  scope  |  LOADS IN  |  shared with team  |  stored in  |',
    '| :--- | :--- | :--- | :--- |',
    '| Local | x | No | y |',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '## MCP installation scopes',
    '',
    'Some intro prose with `code` spans.',
    '',
    '| Scope | Loads in | Shared with team | Stored in |',
    '| :--- | :--- | :--- | :--- |',
    '| Local | x | No | y |',
  ].join('\n');
  const rows = parseTable(md);
  assert.deepEqual(rows.map((r) => r.name), ['Local']);
});

test('buildRecords sorts by name', () => {
  const md = [
    '| Scope | Loads in | Shared with team | Stored in |',
    '| :--- | :--- | :--- | :--- |',
    '| [User](#user-scope) | a | No | b |',
    '| [Local](#local-scope) | c | No | d |',
    '| [Project](#project-scope) | e | Yes, via version control | f |',
  ].join('\n');
  const records = buildRecords(md);
  assert.deepEqual(
    records.map((r) => r.name),
    ['Local', 'Project', 'User'],
  );
});

test('buildRecords preserves shared cell verbatim for downstream re-parsing', () => {
  // The `shared` cell carries qualifier prose ("Yes, via version
  // control") that we want to keep — consumers that need a strict
  // boolean can re-parse, but the *why* is part of the data.
  const md = [
    '| Scope | Loads in | Shared with team | Stored in |',
    '| :--- | :--- | :--- | :--- |',
    '| Project | x | Yes, via version control | y |',
  ].join('\n');
  const [r] = buildRecords(md);
  assert.equal(r.shared, 'Yes, via version control');
});
