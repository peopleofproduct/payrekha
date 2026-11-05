// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

/**
 * Deterministic JSON for signing: keys sorted by UTF-16 code unit, no
 * whitespace, `undefined` members dropped. Only strings, safe integers,
 * booleans, null, arrays and plain objects are allowed — floats are
 * rejected so a Java or Python signer can never disagree on number
 * formatting. The Java and Python clients implement the same rules.
 */
export function canonicalJson(value: unknown): string {
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
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}
