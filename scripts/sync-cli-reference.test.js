import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRow, parseTable, buildRecords } from './sync-cli-reference.js';

const COMMAND_HEADER = /^\|\s*Command\s*\|\s*Description\s*\|\s*Example\s*\|/i;
const FLAG_HEADER = /^\|\s*Flag\s*\|\s*Description\s*\|\s*Example\s*\|/i;

test('parseRow extracts name, description, and example from a typical 3-col row', () => {
  const row = parseRow('| `claude` | Start interactive session | `claude` |');
  assert.deepEqual(row, {
    name: 'claude',
    description: 'Start interactive session',
    example: '`claude`',
  });
});

test('parseRow strips a single layer of wrapping backticks from the name', () => {
  const row = parseRow('| `claude update` | Update to latest version | `claude update` |');
  assert.equal(row.name, 'claude update');
});

test('parseRow leaves multi-span names intact (no wrapping single span)', () => {
  // Flags often render as multiple inline-code spans inside one cell:
  // `--continue`, `-c`. The name should round-trip with backticks
  // preserved — stripBackticks only peels a single wrapping layer.
  const row = parseRow(
    '| `--continue`, `-c` | Load the most recent conversation | `claude --continue` |',
  );
  assert.equal(row.name, '`--continue`, `-c`');
});

test('parseRow leaves a bare (un-backticked) name alone', () => {
  const row = parseRow('| bare-name | desc | ex |');
  assert.equal(row.name, 'bare-name');
});

test('parseRow returns null for a line without enough cells', () => {
  // 2-col tables (e.g. keybindings `Context | Description`) split into
  // 4 parts and must be rejected here.
  assert.equal(parseRow('| only | two |'), null);
  assert.equal(parseRow('not a row at all'), null);
});

test('parseRow returns null when the name cell is empty', () => {
  assert.equal(parseRow('|  | desc | example |'), null);
});

test('parseRow allows an empty description or example without dropping the row', () => {
  // The primary key is `name`; missing prose is unusual upstream but
  // shouldn't make a documented entry vanish from the catalog.
  const r1 = parseRow('| `claude` |  | `claude` |');
  assert.equal(r1.name, 'claude');
  assert.equal(r1.description, '');
  assert.equal(r1.example, '`claude`');

  const r2 = parseRow('| `claude` | desc |  |');
  assert.equal(r2.name, 'claude');
  assert.equal(r2.example, '');
});

test('parseRow preserves inline backticks and parentheses inside the description', () => {
  const row = parseRow(
    '| `--debug` | Enable debug mode (for example, `"api,hooks"`) | `claude --debug` |',
  );
  assert.equal(row.description, 'Enable debug mode (for example, `"api,hooks"`)');
});

test('parseRow handles a stray pipe inside the description by joining defensively', () => {
  // Upstream cells have no embedded *unescaped* pipes today, but keep
  // the parser robust: extra `|`s are assumed to live in description.
  const row = parseRow('| `--x` | desc-left | desc-right | `ex` |');
  assert.equal(row.description, 'desc-left | desc-right');
  assert.equal(row.example, '`ex`');
});

test('parseRow treats a backslash-escaped pipe (`\\|`) as a literal pipe inside a cell', () => {
  // Real upstream regression: the `cat file \| claude -p "query"`
  // command row escapes the shell pipe with `\|` so GFM doesn't treat
  // it as a column separator. We must split on unescaped `|` only and
  // render `\|` back to `|` in the output cells.
  const row = parseRow(
    '| `cat file \\| claude -p "query"` | Process piped content | `cat logs.txt \\| claude -p "explain"` |',
  );
  assert.equal(row.name, 'cat file | claude -p "query"');
  assert.equal(row.description, 'Process piped content');
  assert.equal(row.example, '`cat logs.txt | claude -p "explain"`');
});

test('parseTable returns rows from a minimal commands table', () => {
  const md = [
    '| Command | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `claude` | Start interactive session | `claude` |',
    '| `claude update` | Update to latest | `claude update` |',
  ].join('\n');
  const rows = parseTable(md, COMMAND_HEADER);
  assert.deepEqual(
    rows.map((r) => r.name),
    ['claude', 'claude update'],
  );
});

test('parseTable returns rows from a minimal flags table', () => {
  const md = [
    '| Flag | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `--model` | Sets the model | `claude --model sonnet` |',
  ].join('\n');
  const rows = parseTable(md, FLAG_HEADER);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '--model');
});

test('parseTable skips the alignment row right after the header', () => {
  const md = [
    '| Command | Description | Example |',
    '| :------- | :------- | :------- |',
    '| `claude` | x | y |',
  ].join('\n');
  const rows = parseTable(md, COMMAND_HEADER);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'claude');
});

test('parseTable stops at the first non-pipe line after the header', () => {
  const md = [
    '| Command | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `claude` | x | y |',
    '',
    'Some prose after the table.',
    '| ignored | not | counted |',
  ].join('\n');
  const rows = parseTable(md, COMMAND_HEADER);
  assert.deepEqual(rows.map((r) => r.name), ['claude']);
});

test('parseTable does not treat the System-prompt subsection (`Flag | Behavior | Example`) as a flags table', () => {
  // The page has a `### System prompt flags` subsection with header
  // `| Flag | Behavior | Example |` — same first column, but second
  // column is `Behavior` not `Description`. The header regex must
  // disambiguate so we don't double-count those four flags (which
  // already appear in the main `## CLI flags` table).
  const md = [
    '| Flag | Behavior | Example |',
    '| :--- | :--- | :--- |',
    '| `--system-prompt` | Replaces the entire default prompt | `claude --system-prompt "x"` |',
  ].join('\n');
  assert.deepEqual(parseTable(md, FLAG_HEADER), []);
});

test('parseTable does not pick up a 2-col table (e.g. keybindings Contexts) as commands or flags', () => {
  const md = [
    '| Context | Description |',
    '| :--- | :--- |',
    '| `Global` | Applies everywhere |',
  ].join('\n');
  assert.deepEqual(parseTable(md, COMMAND_HEADER), []);
  assert.deepEqual(parseTable(md, FLAG_HEADER), []);
});

test('parseTable does not pick up rows from the wrong header type', () => {
  // A flags table must not be parsed when scanning for commands.
  const md = [
    '| Flag | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `--model` | Sets the model | `claude --model sonnet` |',
  ].join('\n');
  assert.deepEqual(parseTable(md, COMMAND_HEADER), []);
});

test('parseTable matches the header case-insensitively and tolerates extra whitespace', () => {
  const md = [
    '|  command  |  DESCRIPTION  |  Example  |',
    '| :--- | :--- | :--- |',
    '| `claude` | x | y |',
  ].join('\n');
  const rows = parseTable(md, COMMAND_HEADER);
  assert.equal(rows.length, 1);
});

test('parseTable ignores prose before the table', () => {
  const md = [
    '## CLI commands',
    '',
    'You can start sessions, pipe content, resume conversations…',
    '',
    '| Command | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `claude` | x | y |',
  ].join('\n');
  const rows = parseTable(md, COMMAND_HEADER);
  assert.deepEqual(rows.map((r) => r.name), ['claude']);
});

test('buildRecords extracts both commands and flags from a single page', () => {
  // End-to-end smoke that the two-table extraction works on one
  // input — both header types must be picked up in a single pass.
  const md = [
    '## CLI commands',
    '',
    '| Command | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `claude` | Start | `claude` |',
    '| `claude update` | Update | `claude update` |',
    '',
    '## CLI flags',
    '',
    '| Flag | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `--model` | Sets model | `claude --model sonnet` |',
    '| `--verbose` | Verbose | `claude --verbose` |',
    '',
    '### System prompt flags',
    '',
    '| Flag | Behavior | Example |',
    '| :--- | :--- | :--- |',
    '| `--system-prompt` | Replaces | `claude --system-prompt "x"` |',
  ].join('\n');
  const { commands, flags } = buildRecords(md);
  assert.equal(commands.length, 2);
  assert.equal(flags.length, 2);
  // System-prompt subsection must NOT be folded into flags (it's a
  // re-statement of entries already in the main flags table).
  assert.equal(
    flags.some((f) => f.name === '--system-prompt'),
    false,
  );
});

test('buildRecords sorts commands by name', () => {
  const md = [
    '| Command | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `claude update` | last | x |',
    '| `claude` | first | x |',
    '| `claude install` | middle | x |',
  ].join('\n');
  const { commands } = buildRecords(md);
  assert.deepEqual(
    commands.map((r) => r.name),
    ['claude', 'claude install', 'claude update'],
  );
});

test('buildRecords sorts flags by name', () => {
  const md = [
    '| Flag | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `--verbose` | last | x |',
    '| `--model` | middle | x |',
    '| `--add-dir` | first | x |',
  ].join('\n');
  const { flags } = buildRecords(md);
  assert.deepEqual(
    flags.map((r) => r.name),
    ['--add-dir', '--model', '--verbose'],
  );
});

test('buildRecords returns empty arrays when no matching tables are present', () => {
  const md = [
    '## Some other page',
    '',
    'No tables here.',
  ].join('\n');
  const { commands, flags } = buildRecords(md);
  assert.deepEqual(commands, []);
  assert.deepEqual(flags, []);
});

test('buildRecords preserves descriptions verbatim for downstream re-parsing', () => {
  // Descriptions sometimes contain links and inline code that future
  // consumers may want to re-parse — round-trip them unchanged.
  const md = [
    '| Flag | Description | Example |',
    '| :--- | :--- | :--- |',
    '| `--permission-mode` | Begin in a specified [permission mode](/en/permission-modes). Accepts `default`, `plan`, etc. | `claude --permission-mode plan` |',
  ].join('\n');
  const { flags } = buildRecords(md);
  assert.equal(
    flags[0].description,
    'Begin in a specified [permission mode](/en/permission-modes). Accepts `default`, `plan`, etc.',
  );
});
