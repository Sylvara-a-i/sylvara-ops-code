'use strict';

const { invariant } = require('./errors');

function canonicalize(value, active = new WeakSet()) {
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
    result = value.map((entry) => canonicalize(entry, active));
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
      result[key] = canonicalize(value[key], active);
    }
  }
  active.delete(value);
  return result;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

module.exports = { canonicalize, canonicalStringify };
