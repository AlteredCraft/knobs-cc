import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFields, walk } from './sync-settings.js';

test('pickFields preserves a simple boolean', () => {
  const node = { type: 'boolean', description: 'on/off' };
  assert.deepEqual(pickFields(node), { type: 'boolean', description: 'on/off' });
});

test('pickFields preserves default, minimum, examples', () => {
  const node = {
    type: 'integer',
    default: 30,
    minimum: 1,
    examples: [20, 30, 60],
    description: 'days',
  };
  assert.deepEqual(pickFields(node), {
    type: 'integer',
    default: 30,
    minimum: 1,
    examples: [20, 30, 60],
    description: 'days',
  });
});

test('pickFields preserves enum', () => {
  const node = { type: 'string', enum: ['a', 'b'], description: 'choice' };
  assert.deepEqual(pickFields(node), {
    type: 'string',
    enum: ['a', 'b'],
    description: 'choice',
  });
});

test('pickFields preserves const', () => {
  const node = { type: 'string', const: 'command', description: 'literal' };
  assert.deepEqual(pickFields(node), {
    type: 'string',
    const: 'command',
    description: 'literal',
  });
});

test('pickFields summarises array items with simple types', () => {
  const node = {
    type: 'array',
    items: { type: 'string', minLength: 1 },
    description: 'list',
  };
  assert.deepEqual(pickFields(node), {
    type: 'array',
    items: { type: 'string', minLength: 1 },
    description: 'list',
  });
});

test('pickFields preserves $ref in array items', () => {
  const node = {
    type: 'array',
    items: { $ref: '#/$defs/permissionRule' },
  };
  assert.deepEqual(pickFields(node), {
    type: 'array',
    items: { $ref: '#/$defs/permissionRule' },
  });
});

test('pickFields preserves anyOf when type is absent', () => {
  const node = {
    description: 'union',
    anyOf: [{ type: 'boolean' }, { type: 'array' }],
  };
  assert.deepEqual(pickFields(node), {
    description: 'union',
    anyOf: [{ type: 'boolean' }, { type: 'array' }],
  });
});

test('pickFields drops fields not in the allowlist', () => {
  const node = {
    type: 'object',
    description: 'thing',
    additionalProperties: false,
    required: ['foo'],
    uniqueItems: true,
  };
  assert.deepEqual(pickFields(node), { type: 'object', description: 'thing' });
});

test('pickFields returns empty object for an empty node', () => {
  assert.deepEqual(pickFields({}), {});
});

test('walk emits one record per leaf with insertion order preserved', () => {
  const props = {
    a: { type: 'string', description: 'x' },
    b: { type: 'boolean', description: 'y' },
  };
  const settings = [];
  walk(props, '', settings);
  assert.equal(settings.length, 2);
  assert.deepEqual(
    settings.map((s) => s.key),
    ['a', 'b'],
  );
});

test('walk dots the prefix into keys', () => {
  const props = { a: { type: 'string', description: 'x' } };
  const settings = [];
  walk(props, 'parent', settings);
  assert.equal(settings[0].key, 'parent.a');
});

test('walk recurses into object types that have properties', () => {
  const props = {
    parent: {
      type: 'object',
      description: 'p',
      properties: {
        child: { type: 'string', description: 'c' },
      },
    },
  };
  const settings = [];
  walk(props, '', settings);
  assert.deepEqual(
    settings.map((s) => s.key),
    ['parent', 'parent.child'],
  );
});

test('walk does not recurse into objects without properties', () => {
  const props = { bag: { type: 'object', description: 'opaque' } };
  const settings = [];
  walk(props, '', settings);
  assert.equal(settings.length, 1);
  assert.equal(settings[0].key, 'bag');
});

test('walk does not recurse into non-object types', () => {
  const props = {
    arr: {
      type: 'array',
      items: { type: 'string' },
      properties: { ignored: { type: 'string' } },
    },
  };
  const settings = [];
  walk(props, '', settings);
  assert.equal(settings.length, 1);
  assert.equal(settings[0].key, 'arr');
});

test('walk produces the expected shape for a permissions-like schema', () => {
  const props = {
    permissions: {
      type: 'object',
      description: 'perms',
      properties: {
        defaultMode: {
          type: 'string',
          enum: ['default', 'plan'],
          description: 'mode',
        },
        allow: {
          type: 'array',
          items: { type: 'string' },
          description: 'allow',
        },
      },
    },
  };
  const settings = [];
  walk(props, '', settings);
  assert.deepEqual(
    settings.map((s) => s.key),
    ['permissions', 'permissions.defaultMode', 'permissions.allow'],
  );
  assert.deepEqual(settings[1].enum, ['default', 'plan']);
  assert.deepEqual(settings[2].items, { type: 'string' });
});
