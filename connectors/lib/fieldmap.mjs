// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// Field-map engine shared by every connector. A map is a JSON object whose
// leaves are specs resolved against the incoming event:
//
//   "loan.amount_paise"                     dot-path into the event
//   { "const": "LOAN_DISBURSAL" }           fixed value
//   { "coalesce": ["a.b", "c.d"] }          first non-null path
//   { "map": { "IMPS": "IMPS" }, "from": "loan.rail" }   enum translate
//   { "now": true }                         Date.now() (settlement windows)
//   { "notBefore": "loan.cooling_until" }   epoch-ms, passes through
//
// Unknown/empty paths resolve to undefined; required mint fields are
// validated by the bridge, not here.

export function resolveSpec(spec, ev) {
  if (spec === undefined || spec === null) return undefined;
  if (typeof spec === 'string') return dig(ev, spec);
  if (typeof spec !== 'object' || Array.isArray(spec)) return spec; // literal passthrough
  if ('const' in spec) return spec.const;
  if ('now' in spec) return Date.now();
  if ('coalesce' in spec) {
    for (const p of spec.coalesce) {
      const v = dig(ev, p);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }
  if ('map' in spec) {
    const v = resolveSpec(spec.from, ev);
    if (v === undefined || v === null) return undefined;
    return spec.map[v] !== undefined ? spec.map[v] : spec.default;
  }
  if ('template' in spec) {
    // "{loan.id}-x" — {path} interpolation, all parts required
    const keys = [...spec.template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const vals = keys.map((k) => dig(ev, k));
    if (vals.some((v) => v === undefined || v === null)) return undefined;
    return keys.reduce((s, k, i) => s.replace(`{${k}}`, String(vals[i])), spec.template);
  }
  return undefined;
}

export function dig(o, p) {
  return String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}

/** Resolve every leaf of a fieldMap object against an event. */
export function applyFieldMap(fieldMap, ev) {
  const out = {};
  for (const [k, spec] of Object.entries(fieldMap)) {
    if (typeof spec === 'object' && spec !== null && !Array.isArray(spec) &&
        !('const' in spec) && !('now' in spec) && !('coalesce' in spec) && !('map' in spec) && !('template' in spec) && !('from' in spec)) {
      out[k] = applyFieldMap(spec, ev); // nested object
    } else {
      const v = resolveSpec(spec, ev);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}
