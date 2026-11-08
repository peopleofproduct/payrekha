// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// The connector sink: apply the fieldMap to an event, POST the result to
// /v1/intents/mint, emit a JSONL join line on stdout. Shared by the
// webhook, Kafka and SQS receivers — they differ only in transport.
//
// Retries: one immediate retry on 5xx/network error. Re-delivery beyond
// that is the transport's job (Kafka offset / SQS visibility); mint is
// idempotent on intentId so a re-delivered event never double-mints.

import { applyFieldMap } from './fieldmap.mjs';

export function makeBridge({ url, token, fieldMap, fetchImpl, onEmit }) {
  if (!url || !token) throw new TypeError('makeBridge needs { url, token }');
  if (!fieldMap || typeof fieldMap !== 'object') throw new TypeError('a fieldMap object is required');
  const fetch_ = fetchImpl ?? globalThis.fetch;
  const emit = onEmit ?? ((line) => console.log(JSON.stringify(line)));

  async function post(body) {
    const r = await fetch_(`${url}/v1/intents/mint`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }

  /**
   * Process one event. Returns { ok, status, intentId?, error? }. The
   * caller decides transport ack semantics: ok=true → commit offset /
   * delete message / 200.
   */
  return async function handleEvent(ev) {
    const body = applyFieldMap(fieldMap, ev);
    if (body.intentId === undefined || body.kind === undefined) {
      return { ok: false, status: 400, error: 'fieldMap produced no intentId/kind — event dropped' };
    }
    let out;
    try {
      out = await post(body);
      if (out.status >= 500) out = await post(body); // one retry on gateway 5xx
    } catch {
      try {
        out = await post(body);
      } catch (e2) {
        return { ok: false, status: 502, error: String(e2) };
      }
    }
    const ok = out.status < 300;
    if (ok || out.status === 409) {
      emit({ at: Date.now(), payoutRef: body.intentId, intentId: out.json.intentId ?? body.intentId, status: out.status });
    }
    return { ok, status: out.status, intentId: out.json.intentId, error: ok ? undefined : (out.json.error ?? `http ${out.status}`) };
  };
}

/** Load the fieldMap from FIELD_MAP (inline JSON) or FIELD_MAP_FILE. */
export async function loadFieldMap(env = process.env) {
  if (env.FIELD_MAP) return JSON.parse(env.FIELD_MAP);
  if (env.FIELD_MAP_FILE) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(env.FIELD_MAP_FILE, 'utf8'));
  }
  throw new Error('FIELD_MAP (inline JSON) or FIELD_MAP_FILE is required');
}
