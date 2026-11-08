// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

/**
 * Deterministic JSON for signing: keys sorted by UTF-16 code unit, no
 * whitespace, `undefined` members dropped. Only strings, safe integers,
 * booleans, null, arrays and plain objects are allowed — floats are
 * rejected so a Java or Python signer can never disagree on number
 * formatting. The Java and Python clients implement the same rules.
 * Depth is capped — the request body cap (64KB) admits ~32k levels of
 * nesting, and unbounded recursion turned that into a stack-overflow 500
 * (fuzz finding, B7). Real intents/snapshots are well under 64 deep.
 */
export function canonicalJson(value: unknown): string {
  return emit(value, 0);
}

const MAX_DEPTH = 64;

function emit(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) throw new TypeError(`canonicalJson: value nests deeper than ${MAX_DEPTH}`);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new TypeError(`canonicalJson: non-integer number ${value}`);
      return String(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => emit(v, depth + 1)).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${emit(obj[k], depth + 1)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}
