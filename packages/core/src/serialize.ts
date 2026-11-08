// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createHmac } from 'node:crypto';
import type { FirewallSnapshot } from './firewall.js';

const TAG = 'payrekha-state-v1\n';

/**
 * Chunked snapshot serializer — the same bytes as `canonicalJson` /
 * `JSON.stringify`, but spread across event-loop ticks.
 *
 * Why this exists: `exportState()` is deliberately synchronous — a
 * point-in-time consistent view is the correctness anchor (a torn export
 * could resurrect a spent intent's free use). The object it returns is
 * then effectively immutable: intent documents are frozen post
 * registration and reservation rows are replaced, never mutated. That
 * makes the *serialization* safe to slice: yields between leaf records
 * can never tear the snapshot. Each synchronous slice is bounded to
 * ~`yieldEvery` emitted steps (a step is one array element or object
 * property — tens of microseconds of canonicalJson work), so the
 * event-loop pause drops from one multi-hundred-ms stall to a string of
 * sub-millisecond slices. The HMAC is fed per emitted chunk for the same
 * reason — hashing the joined megabytes at the end would itself stall.
 *
 * The canonical byte order is emitted for BOTH consumers: the stored
 * document and the signature. `verifyAndUnwrap` re-canonicalizes on load,
 * so storage order is a don't-care — but emitting canonical order anyway
 * means one walk feeds the HMAC and the file.
 */

const scalarJson = (v: unknown): string => {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(v)) throw new TypeError(`canonicalJson: non-integer number ${v}`);
      return String(v);
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`);
  }
};

const pause = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Canonical serialization of `value`, interleaved with event-loop yields.
 * `sink` receives each emitted byte chunk in order (the HMAC consumer).
 */
export async function serializeCanonical(value: unknown, yieldEvery = 2048, sink?: (chunk: string) => void): Promise<string> {
  const parts: string[] = [];
  const emit = (s: string): void => {
    parts.push(s);
    sink?.(s);
  };
  let steps = 0;

  const emitValue = async (v: unknown, depth: number): Promise<void> => {
    if (depth > 64) throw new TypeError('canonicalJson: value nests deeper than 64');
    if (v === null || typeof v !== 'object') {
      emit(scalarJson(v));
      return;
    }
    if (Array.isArray(v)) {
      emit('[');
      for (let i = 0; i < v.length; i++) {
        if (i > 0) emit(',');
        // Array elements serialize whole UNLESS they are arrays themselves —
        // snapshot records are bounded-size rows, so a per-record canonicalJson
        // is microseconds while a nested array (a reservation pair, a big
        // revoked-keyId list) recurses and keeps pacing.
        const el = v[i];
        if (Array.isArray(el)) await emitValue(el, depth + 1);
        else emit(canonicalRecord(el, depth + 1));
        if (++steps % yieldEvery === 0) await pause();
      }
      emit(']');
      return;
    }
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort();
    emit('{');
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) emit(',');
      const k = keys[i]!;
      emit(`${JSON.stringify(k)}:`);
      await emitValue(o[k]!, depth + 1);
      if (++steps % yieldEvery === 0) await pause();
    }
    emit('}');
  };

  await emitValue(value, 0);
  return parts.join('');
}

/** Whole-value canonical serialization — the non-pacing twin, for bounded records. */
const canonicalRecord = (v: unknown, depth: number): string => {
  if (depth > 64) throw new TypeError('canonicalJson: value nests deeper than 64');
  if (v === null || typeof v !== 'object') return scalarJson(v);
  if (Array.isArray(v)) return `[${v.map((e) => canonicalRecord(e, depth + 1)).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalRecord(o[k], depth + 1)}`).join(',')}}`;
};

/**
 * Serialize a firewall snapshot to the exact bytes a StateStore persists:
 * unsigned → canonical JSON of the snapshot itself; signed → the
 * `{d, m}` envelope where `m` is HMAC-SHA256 over `TAG + canonicalJson(snap)`
 * — byte-identical to `JSON.stringify(signSnapshot(snap, key))` semantics,
 * produced without stalling the event loop.
 */
export async function serializeSnapshot(snap: FirewallSnapshot, hmacKey: string | undefined, yieldEvery = 2048): Promise<string> {
  if (hmacKey === undefined) return serializeCanonical(snap, yieldEvery);
  const hmac = createHmac('sha256', hmacKey);
  hmac.update(TAG);
  const body = await serializeCanonical(snap, yieldEvery, (c) => hmac.update(c));
  return `{"d":${body},"m":"${hmac.digest('base64url')}"}`;
}
