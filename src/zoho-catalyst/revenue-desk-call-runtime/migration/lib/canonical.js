'use strict';

const { types } = require('node:util');
const { invariant } = require('./errors');

// These are process-work ceilings, not Catalyst column or batch-size limits.
// Internal digest envelopes need headroom beyond the private snapshot ceiling.
const CANONICAL_LIMITS = Object.freeze({
  maxDepth: 40,
  maxNodes: 400_000,
  maxFields: 250_000,
  maxFieldsPerObject: 256,
  maxStringBytes: 65_536,
  maxBytes: 32 * 1024 * 1024,
});
const SNAPSHOT_LIMITS = Object.freeze({
  ...CANONICAL_LIMITS,
  maxDepth: 32,
  maxNodes: 100_000,
  maxFields: 75_000,
  maxBytes: 8 * 1024 * 1024,
  maxResources: 32,
  maxTables: 64,
  maxRows: 10_000,
  maxProjectionFields: 64,
});

function withinLimit(value, maximum, limit) {
  invariant(value <= maximum, 'MIGRATION_INPUT_LIMIT_EXCEEDED',
    'Migration input exceeds the offline planning resource budget.', { limit, maximum });
}

function jsonStringBytes(value, limits) {
  // Check length before UTF-8 measurement or escaped-string allocation.
  withinLimit(value.length, limits.maxStringBytes, 'maxStringBytes');
  withinLimit(Buffer.byteLength(value, 'utf8'), limits.maxStringBytes, 'maxStringBytes');
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function* children(value, limits) {
  const array = Array.isArray(value);
  // Include hidden properties: later semantic reads and array methods must not
  // observe hooks or values omitted from the JSON approval digest.
  const keys = Reflect.ownKeys(value);
  if (array) {
    invariant(keys.length === value.length + 1 && keys[keys.length - 1] === 'length',
      'INVALID_CANONICAL_VALUE', 'Migration evidence arrays must contain only indexed values.');
  } else {
    withinLimit(keys.length, limits.maxFieldsPerObject, 'maxFieldsPerObject');
  }
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    invariant(typeof key === 'string' && descriptor?.enumerable
      && Object.hasOwn(descriptor, 'value'), 'INVALID_CANONICAL_VALUE',
    'Migration evidence must contain enumerable JSON data properties only.');
    yield [key, !array, descriptor.value];
  }
}

function assertCanonicalBounds(value, limits = CANONICAL_LIMITS) {
  const active = new WeakSet();
  const stack = [{ value, depth: 0 }];
  const totals = { nodes: 0, fields: 0, bytes: 0 };
  const addBytes = (count) => {
    totals.bytes += count;
    withinLimit(totals.bytes, limits.maxBytes, 'maxBytes');
  };
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame.iterator) {
      withinLimit(frame.depth, limits.maxDepth, 'maxDepth');
      totals.nodes += 1;
      withinLimit(totals.nodes, limits.maxNodes, 'maxNodes');
      const current = frame.value;
      if (current === null || typeof current !== 'object') {
        invariant(current === null || ['string', 'boolean'].includes(typeof current)
          || (typeof current === 'number' && Number.isSafeInteger(current)),
        'INVALID_CANONICAL_VALUE', 'Migration evidence must contain bounded JSON values only.');
        addBytes(typeof current === 'string'
          ? jsonStringBytes(current, limits) : JSON.stringify(current).length);
        stack.pop();
        continue;
      }
      invariant(!types.isProxy(current), 'INVALID_CANONICAL_VALUE',
        'Migration evidence must not contain proxies.');
      invariant(!active.has(current), 'INVALID_CANONICAL_VALUE',
        'Migration evidence must not contain cyclic objects.');
      if (Array.isArray(current)) {
        withinLimit(totals.nodes + current.length, limits.maxNodes, 'maxNodes');
        invariant(Object.getPrototypeOf(current) === Array.prototype,
          'INVALID_CANONICAL_VALUE', 'Migration evidence arrays must use the standard prototype.');
        addBytes(2 + Math.max(0, current.length - 1));
      } else {
        const prototype = Object.getPrototypeOf(current);
        invariant(prototype === Object.prototype || prototype === null,
          'INVALID_CANONICAL_VALUE', 'Migration evidence objects must be plain objects.');
        addBytes(2);
      }
      active.add(current);
      frame.iterator = children(current, limits);
      frame.fields = 0;
    }
    const next = frame.iterator.next();
    if (next.done) {
      active.delete(frame.value);
      stack.pop();
      continue;
    }
    const [key, isField, child] = next.value;
    if (isField) {
      frame.fields += 1;
      totals.fields += 1;
      withinLimit(frame.fields, limits.maxFieldsPerObject, 'maxFieldsPerObject');
      withinLimit(totals.fields, limits.maxFields, 'maxFields');
      addBytes(jsonStringBytes(key, limits) + 1 + (frame.fields > 1 ? 1 : 0));
    }
    stack.push({ value: child, depth: frame.depth + 1 });
  }
  return totals;
}

function canonicalizeBounded(value, active = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value), 'INVALID_CANONICAL_VALUE',
      'Migration evidence accepts only safe integer numeric values.');
    return value;
  }
  invariant(typeof value === 'object' && value !== null,
    'INVALID_CANONICAL_VALUE', 'Migration evidence must contain JSON values only.');
  invariant(!active.has(value), 'INVALID_CANONICAL_VALUE',
    'Migration evidence must not contain cyclic objects.');
  active.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry) => canonicalizeBounded(entry, active));
  } else {
    const prototype = Object.getPrototypeOf(value);
    invariant(prototype === Object.prototype || prototype === null,
      'INVALID_CANONICAL_VALUE', 'Migration evidence objects must be plain objects.');
    // A null prototype keeps untrusted private export keys such as `__proto__`
    // inert while preserving their exact JSON representation in the digest.
    result = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      invariant(value[key] !== undefined, 'INVALID_CANONICAL_VALUE',
        'Migration evidence must not contain undefined values.', { key });
      result[key] = canonicalizeBounded(value[key], active);
    }
  }
  active.delete(value);
  return result;
}

function canonicalize(value) {
  assertCanonicalBounds(value);
  return canonicalizeBounded(value);
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

module.exports = {
  canonicalize, canonicalStringify, assertCanonicalBounds, withinLimit,
  jsonStringBytes, CANONICAL_LIMITS, SNAPSHOT_LIMITS,
};
