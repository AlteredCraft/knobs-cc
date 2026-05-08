import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRow,
  parseTable,
  splitCells,
  extractAllTables,
  parseHandlerSections,
  parseCommonInput,
  parseEventSchemas,
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

test('buildRecords returns an envelope with events sorted by name', () => {
  const md = [
    '## Hook lifecycle',
    '',
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `Stop` | end of turn |',
    '| `PreToolUse` | before a tool |',
    '| `SessionStart` | session begins |',
  ].join('\n');
  const envelope = buildRecords(md);
  assert.deepEqual(
    envelope.events.map((r) => r.name),
    ['PreToolUse', 'SessionStart', 'Stop'],
  );
  assert.equal(envelope.count, 3);
});

test('buildRecords preserves cadence prose verbatim', () => {
  const md = [
    '## Hook lifecycle',
    '',
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `PermissionDenied` | When a tool call is denied by the auto mode classifier. Return `{retry: true}` to tell the model it may retry the denied tool call |',
  ].join('\n');
  const envelope = buildRecords(md);
  const [r] = envelope.events;
  assert.equal(r.name, 'PermissionDenied');
  assert.equal(
    r.when,
    'When a tool call is denied by the auto mode classifier. Return `{retry: true}` to tell the model it may retry the denied tool call',
  );
});

test('buildRecords events default empty inputFields/outputFields and null inputExample when no schema sections exist', () => {
  const md = [
    '## Hook lifecycle',
    '',
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `Stop` | end of turn |',
  ].join('\n');
  const envelope = buildRecords(md);
  assert.deepEqual(envelope.events[0].inputFields, []);
  assert.deepEqual(envelope.events[0].outputFields, []);
  assert.equal(envelope.events[0].inputExample, null);
});

test('buildRecords envelope exposes empty handlers + commonInput when sections absent', () => {
  const md = [
    '## Hook lifecycle',
    '',
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `Stop` | x |',
  ].join('\n');
  const envelope = buildRecords(md);
  assert.deepEqual(envelope.handlers, []);
  assert.deepEqual(envelope.commonInput, []);
});

test('buildRecords integrates handler tables, common input, and per-event schemas', () => {
  const md = [
    '## Hook lifecycle',
    '',
    '| Event | When it fires |',
    '| :--- | :--- |',
    '| `Stop` | end of turn |',
    '',
    '## Configuration',
    '',
    '### Hook handler fields',
    '',
    '#### Common fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `type` | yes | command/http/mcp_tool/prompt/agent |',
    '',
    '#### Command hook fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `command` | yes | Shell command to execute |',
    '',
    '## Hook input and output',
    '',
    '### Common input fields',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `session_id` | Current session identifier |',
    '',
    '## Hook events',
    '',
    '### Stop',
    '',
    '#### Stop input',
    '',
    '```json theme={null}',
    '{ "session_id": "abc123" }',
    '```',
    '',
    '#### Stop decision control',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `decision` | `"block"` keeps the conversation going |',
  ].join('\n');
  const envelope = buildRecords(md);
  // Events
  assert.equal(envelope.events.length, 1);
  const stop = envelope.events[0];
  assert.equal(stop.name, 'Stop');
  assert.deepEqual(stop.inputFields, []);
  assert.equal(stop.inputExample, '{ "session_id": "abc123" }');
  assert.deepEqual(stop.outputFields, [
    { field: 'decision', description: '`"block"` keeps the conversation going' },
  ]);
  // Handlers
  assert.deepEqual(envelope.handlers.map((h) => h.name), ['common', 'command']);
  assert.equal(envelope.handlers[0].fields[0].field, 'type');
  assert.equal(envelope.handlers[0].fields[0].required, 'yes');
  // Common input
  assert.deepEqual(envelope.commonInput, [
    { field: 'session_id', description: 'Current session identifier' },
  ]);
});

// ---------------------------------------------------------------------
// splitCells — GFM cell splitter that handles `\|` escapes.
// ---------------------------------------------------------------------

test('splitCells extracts plain trimmed cells', () => {
  assert.deepEqual(splitCells('| a | b | c |'), ['a', 'b', 'c']);
});

test('splitCells trims whitespace and tolerates ragged padding', () => {
  assert.deepEqual(splitCells('|  a  |     b |   c    |'), ['a', 'b', 'c']);
});

test('splitCells preserves backslash-escaped pipes inside a cell', () => {
  // GFM escape: `\|` renders as a literal pipe; not a cell separator.
  assert.deepEqual(splitCells('| a \\| b | c |'), ['a | b', 'c']);
});

test('splitCells preserves the doc fixture `Edit\\|Write`', () => {
  // From the actual hooks.md matcher table.
  assert.deepEqual(
    splitCells('| `Bash`, `Edit\\|Write`, `mcp__.*` | x |'),
    ['`Bash`, `Edit|Write`, `mcp__.*`', 'x'],
  );
});

test('splitCells returns empty strings for empty cells', () => {
  assert.deepEqual(splitCells('| | b | |'), ['', 'b', '']);
});

test('splitCells returns [] for a non-pipe line', () => {
  assert.deepEqual(splitCells('not a row'), []);
});

// ---------------------------------------------------------------------
// extractAllTables — heading-aware table walker.
// ---------------------------------------------------------------------

test('extractAllTables tags each table with its enclosing heading path', () => {
  const md = [
    '## Top',
    '',
    '### Sub',
    '',
    '| H1 | H2 |',
    '| :--- | :--- |',
    '| a | b |',
  ].join('\n');
  const tables = extractAllTables(md);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].path.h2, 'Top');
  assert.equal(tables[0].path.h3, 'Sub');
  assert.deepEqual(tables[0].headers, ['H1', 'H2']);
  assert.deepEqual(tables[0].rows, [['a', 'b']]);
});

test('extractAllTables resets deeper levels when a higher heading appears', () => {
  const md = [
    '## Section A',
    '### A.1',
    '#### A.1.a',
    '## Section B',
    '',
    '| X | Y |',
    '| :--- | :--- |',
    '| 1 | 2 |',
  ].join('\n');
  const [t] = extractAllTables(md);
  assert.equal(t.path.h2, 'Section B');
  assert.equal(t.path.h3, null);
  assert.equal(t.path.h4, null);
});

test('extractAllTables skips tables with no preceding alignment row', () => {
  // A line that looks like a header but isn't followed by alignment is not a table.
  const md = [
    '## H',
    '',
    '| not | a | table |',
    'paragraph text',
  ].join('\n');
  assert.deepEqual(extractAllTables(md), []);
});

test('extractAllTables handles multiple tables under the same heading', () => {
  const md = [
    '## H',
    '',
    '| a | b |',
    '| :--- | :--- |',
    '| 1 | 2 |',
    '',
    '| c | d |',
    '| :--- | :--- |',
    '| 3 | 4 |',
  ].join('\n');
  const tables = extractAllTables(md);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].headers, ['a', 'b']);
  assert.deepEqual(tables[1].headers, ['c', 'd']);
});

// ---------------------------------------------------------------------
// parseHandlerSections — handler-fields tables under
// `### Hook handler fields`.
// ---------------------------------------------------------------------

test('parseHandlerSections extracts all five handler subsections in doc order', () => {
  const md = [
    '## Configuration',
    '',
    '### Hook handler fields',
    '',
    '#### Common fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `type` | yes | one of the five types |',
    '',
    '#### Command hook fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `command` | yes | shell command |',
    '',
    '#### HTTP hook fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `url` | yes | endpoint |',
    '',
    '#### MCP tool hook fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `server` | yes | MCP server name |',
    '',
    '#### Prompt and agent hook fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `prompt` | yes | prompt text |',
  ].join('\n');
  const sections = parseHandlerSections(md);
  assert.deepEqual(
    sections.map((s) => s.name),
    ['common', 'command', 'http', 'mcp_tool', 'prompt_and_agent'],
  );
  assert.deepEqual(sections[0].fields, [
    { field: 'type', required: 'yes', description: 'one of the five types' },
  ]);
  assert.equal(sections[3].fields[0].field, 'server');
  assert.equal(sections[4].fields[0].field, 'prompt');
});

test('parseHandlerSections strips backticks around field names but preserves description backticks', () => {
  const md = [
    '### Hook handler fields',
    '',
    '#### Common fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `if` | no | uses [permission rule syntax](/x), like `"Bash(git *)"` |',
  ].join('\n');
  const [section] = parseHandlerSections(md);
  assert.equal(section.fields[0].field, 'if');
  assert.equal(
    section.fields[0].description,
    'uses [permission rule syntax](/x), like `"Bash(git *)"`',
  );
});

test('parseHandlerSections returns [] when the parent heading is missing', () => {
  const md = [
    '#### Common fields',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `type` | yes | x |',
  ].join('\n');
  // The handler subsections must be nested under `### Hook handler fields`.
  // A bare `#### Common fields` without that parent is ignored.
  assert.deepEqual(parseHandlerSections(md), []);
});

test('parseHandlerSections ignores unknown subsections under Hook handler fields', () => {
  const md = [
    '### Hook handler fields',
    '',
    '#### Some unrelated section',
    '',
    '| Field | Required | Description |',
    '| :--- | :--- | :--- |',
    '| `noise` | no | should be skipped |',
  ].join('\n');
  assert.deepEqual(parseHandlerSections(md), []);
});

// ---------------------------------------------------------------------
// parseCommonInput — `### Common input fields` table(s).
// ---------------------------------------------------------------------

test('parseCommonInput returns the table fields under the Common input fields heading', () => {
  const md = [
    '## Hook input and output',
    '',
    '### Common input fields',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `session_id` | Current session identifier |',
    '| `cwd` | Current working directory |',
  ].join('\n');
  assert.deepEqual(parseCommonInput(md), [
    { field: 'session_id', description: 'Current session identifier' },
    { field: 'cwd', description: 'Current working directory' },
  ]);
});

test('parseCommonInput merges the subagent-extras table that follows the main table', () => {
  // The doc has prose between the two tables ("When running with --agent ...");
  // both belong to the Common input fields section.
  const md = [
    '### Common input fields',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `session_id` | x |',
    '',
    'When running with --agent or inside a subagent, two additional fields are included:',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `agent_id` | y |',
    '| `agent_type` | z |',
  ].join('\n');
  assert.deepEqual(
    parseCommonInput(md).map((r) => r.field),
    ['session_id', 'agent_id', 'agent_type'],
  );
});

test('parseCommonInput returns [] when the heading is absent', () => {
  assert.deepEqual(parseCommonInput('## Other heading\n\nprose'), []);
});

// ---------------------------------------------------------------------
// parseEventSchemas — per-event input/output schemas keyed by event name.
// ---------------------------------------------------------------------

test('parseEventSchemas captures input table, JSON example, and decision-control table for an event', () => {
  const md = [
    '## Hook events',
    '',
    '### InstructionsLoaded',
    '',
    '#### InstructionsLoaded input',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `file_path` | Absolute path |',
    '| `memory_type` | Scope |',
    '',
    '```json theme={null}',
    '{',
    '  "session_id": "abc123",',
    '  "file_path": "/x/CLAUDE.md"',
    '}',
    '```',
    '',
    '#### InstructionsLoaded decision control',
    '',
    'Prose intro.',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `decision` | optional |',
  ].join('\n');
  const map = parseEventSchemas(md);
  const schema = map.get('InstructionsLoaded');
  assert.deepEqual(schema.inputFields, [
    { field: 'file_path', description: 'Absolute path' },
    { field: 'memory_type', description: 'Scope' },
  ]);
  assert.equal(
    schema.inputExample,
    '{\n  "session_id": "abc123",\n  "file_path": "/x/CLAUDE.md"\n}',
  );
  assert.deepEqual(schema.outputFields, [
    { field: 'decision', description: 'optional' },
  ]);
});

test('parseEventSchemas accepts `output` heading in place of `decision control`', () => {
  // CwdChanged / FileChanged / WorktreeCreate use this header form upstream.
  const md = [
    '## Hook events',
    '',
    '### CwdChanged',
    '',
    '#### CwdChanged output',
    '',
    '| Field | Description |',
    '| :--- | :--- |',
    '| `additionalContext` | string |',
  ].join('\n');
  const schema = parseEventSchemas(md).get('CwdChanged');
  assert.deepEqual(schema.outputFields, [
    { field: 'additionalContext', description: 'string' },
  ]);
});

test('parseEventSchemas leaves inputFields/outputFields empty and inputExample null when the input section has no table or JSON block', () => {
  const md = [
    '## Hook events',
    '',
    '### Setup',
    '',
    '#### Setup input',
    '',
    'Prose only, no table or JSON example.',
  ].join('\n');
  const schema = parseEventSchemas(md).get('Setup');
  assert.deepEqual(schema.inputFields, []);
  assert.equal(schema.inputExample, null);
  assert.deepEqual(schema.outputFields, []);
});

test('parseEventSchemas captures the first JSON block when an event input section has multiple', () => {
  const md = [
    '## Hook events',
    '',
    '### SessionStart',
    '',
    '#### SessionStart input',
    '',
    '```json theme={null}',
    '{ "first": true }',
    '```',
    '',
    'Prose between blocks.',
    '',
    '```json theme={null}',
    '{ "second": true }',
    '```',
  ].join('\n');
  const schema = parseEventSchemas(md).get('SessionStart');
  assert.equal(schema.inputExample, '{ "first": true }');
});

test('parseEventSchemas does not bleed JSON blocks across event boundaries', () => {
  const md = [
    '## Hook events',
    '',
    '### A',
    '',
    '#### A input',
    '',
    'No example here.',
    '',
    '### B',
    '',
    '#### B input',
    '',
    '```json theme={null}',
    '{ "for": "B" }',
    '```',
  ].join('\n');
  const map = parseEventSchemas(md);
  assert.equal(map.get('A').inputExample, null);
  assert.equal(map.get('B').inputExample, '{ "for": "B" }');
});

test('parseEventSchemas ignores nested per-tool subtables under PreToolUse input', () => {
  // `#### PreToolUse input` contains nested `##### Bash`/`##### Write` etc.
  // tables describing tool_input variants. Pass #2 leaves them out — the
  // captured table must come from the immediate `#### ... input` section,
  // not a nested `#####`.
  const md = [
    '## Hook events',
    '',
    '### PreToolUse',
    '',
    '#### PreToolUse input',
    '',
    'Prose intro.',
    '',
    '##### Bash',
    '',
    '| Field | Type | Example | Description |',
    '| :--- | :--- | :--- | :--- |',
    '| `command` | string | `"npm test"` | x |',
  ].join('\n');
  const schema = parseEventSchemas(md).get('PreToolUse');
  // The 4-col Bash subtable is *not* a `Field | Description` shape, so it's
  // skipped. inputFields stays empty.
  assert.deepEqual(schema.inputFields, []);
});
