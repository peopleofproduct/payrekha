// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import type { FirewallSnapshot } from './firewall.js';

const TAG = 'payrekha-state-v1\n';

/**
 * Optional integrity layer over the firewall snapshot. Without a key the
 * snapshot stays plain JSON (today's behaviour). With `PAYREKHA_STATE_KEY`
 * the state is wrapped `{d, m}` and the HMAC is computed over the canonical
 * JSON, so Postgres JSONB key reordering cannot cause a false mismatch.
 *
 * Tampering then cannot silently drop canaries, ledgers or a HIGH_ALERT —
 * intents already re-verify and fail closed, this closes the rest of the
 * surface. Enabling the key on an existing unsigned file fails the load
 * (delete the file or unset the key; never sign over an unreviewed state).
 */
export function signSnapshot(snap: FirewallSnapshot, hmacKey: string | undefined): unknown {
  if (hmacKey === undefined) return snap;
  const m = createHmac('sha256', hmacKey).update(TAG + canonicalJson(snap)).digest('base64url');
  return { d: snap, m };
}

const isEnvelope = (x: unknown): x is { d: FirewallSnapshot; m: string } =>
  typeof x === 'object' && x !== null && typeof (x as { m?: unknown }).m === 'string' && (x as { d?: unknown }).d !== undefined;

export function verifyAndUnwrap(stored: unknown, hmacKey: string | undefined, previousKeys: readonly string[] = []): FirewallSnapshot {
  if (hmacKey === undefined) {
    if (isEnvelope(stored)) throw new Error('state snapshot is signed but no key is configured — refusing to load');
    return stored as FirewallSnapshot;
  }
  if (!isEnvelope(stored)) throw new Error('state snapshot is unsigned but a state key is configured — refusing to load');
  const body = TAG + canonicalJson(stored.d);
  const a = Buffer.from(stored.m);
  // Primary key first, then any previous keys so a rotation window can still
  // load snapshots signed before the new key rolled out.
  const ok = [hmacKey, ...previousKeys].some((k) => {
    const b = Buffer.from(createHmac('sha256', k).update(body).digest('base64url'));
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!ok) throw new Error('state snapshot signature mismatch — refusing to load a tampered snapshot');
  return stored.d;
}
