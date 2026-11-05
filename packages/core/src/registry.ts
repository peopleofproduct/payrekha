// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { intentShapeProblem, type Keyring, type VerifyFailure } from './intent.js';
import { LruMap } from './lru.js';
import type { Intent, IntentKind, PayoutRequest } from './types.js';

/** A registered intent plus its consumption. */
export interface IntentRecord {
  readonly intent: Intent;
  uses: number;
  usedPaise: number;
  /** Keyring generation the cached verification belongs to. */
  verifiedGen: number;
  verification: 'ok' | VerifyFailure;
}

/**
 * Storage seam for intents. Synchronous on purpose: the verdict path stays
 * in-process and sub-millisecond. A Redis/Postgres adapter keeps a local
 * read-through cache and writes behind (see docs/adr/0001-engine.md).
 */
export interface IntentStore {
  get(intentId: string): IntentRecord | undefined;
  put(record: IntentRecord): void;
  delete(intentId: string): void;
  entries(): IterableIterator<[string, IntentRecord]>;
  readonly size: number;
}

export class MemoryIntentStore implements IntentStore {
  private readonly lru: LruMap<string, IntentRecord>;
  constructor(capacity = 1_000_000) {
    this.lru = new LruMap(capacity);
  }
  get(id: string): IntentRecord | undefined {
    return this.lru.peek(id);
  }
  put(r: IntentRecord): void {
    this.lru.set(r.intent.intentId, r);
  }
  delete(id: string): void {
    this.lru.delete(id);
  }
  entries(): IterableIterator<[string, IntentRecord]> {
    return this.lru.entriesLeastRecentFirst();
  }
  get size(): number {
    return this.lru.size;
  }
}

export type RegisterResult =
  | { readonly accepted: true; readonly intentId: string }
  | { readonly accepted: false; readonly reason: string };

export type IntentStatus =
  | 'ok'
  | 'not-required'
  | 'missing'
  | 'bad-signature'
  | 'kind-mismatch'
  | 'expired'
  | 'amount-exceeds'
  | 'beneficiary-mismatch'
  | 'reused';

/** Result of binding a payout to its intent, computed once per evaluation. */
export interface IntentCheck {
  readonly status: IntentStatus;
  readonly required: boolean;
  readonly intentKind?: IntentKind;
  readonly subjectRef?: string;
  readonly issuer?: string;
  readonly maxAmountPaise?: number;
  readonly remainingPaise?: number;
  readonly uses?: number;
  readonly maxUses?: number;
  readonly detail?: string;
}

interface Reservation {
  readonly intentId: string;
  readonly amountPaise: number;
}

/**
 * Intents registered by systems of record, verified on receipt and
 * re-verified whenever the keyring changes (rotation/revocation).
 */
export class IntentRegistry {
  private readonly reservations: LruMap<string, Reservation>;

  constructor(
    readonly keyring: Keyring,
    readonly store: IntentStore = new MemoryIntentStore(),
    reservationCapacity = 1_000_000,
  ) {
    this.reservations = new LruMap(reservationCapacity);
  }

  /** Register a signed intent. Verifies the signature on receipt. */
  register(intent: unknown, nowMs: number): RegisterResult {
    const problem = intentShapeProblem(intent);
    if (problem !== null) return { accepted: false, reason: problem };
    const i = intent as Intent;
    const existing = this.store.get(i.intentId);
    const v = this.keyring.verify(i, nowMs);
    if (existing !== undefined && existing.verification === 'ok') {
      // Idempotent re-submit of the same signed intent is fine; anything else
      // under a live id is an overwrite attempt and must not reset its uses.
      return existing.intent.signature === i.signature
        ? { accepted: true, intentId: i.intentId }
        : { accepted: false, reason: 'intentId already registered with a different signature' };
    }
    const record: IntentRecord = {
      intent: i,
      uses: 0,
      usedPaise: 0,
      verifiedGen: this.keyring.generation,
      verification: v.ok ? 'ok' : v.reason,
    };
    // Rejected intents are kept as tombstones so a payout citing them hits
    // `intent.bad-signature` (actionable) rather than `intent.missing`.
    this.store.put(record);
    return v.ok ? { accepted: true, intentId: i.intentId } : { accepted: false, reason: `signature rejected: ${v.reason}` };
  }

  get(intentId: string): IntentRecord | undefined {
    return this.store.get(intentId);
  }

  /** Bind a payout to its intent. Pure read — consumption happens in `reserve`. */
  check(p: PayoutRequest, required: boolean): IntentCheck {
    if (p.intentId === undefined || p.intentId === '') {
      return required ? { status: 'missing', required, detail: 'no intentId on payout' } : { status: 'not-required', required };
    }
    const rec = this.store.get(p.intentId);
    if (rec === undefined) return { status: 'missing', required: true, detail: 'intentId not registered' };
    if (rec.verifiedGen !== this.keyring.generation) {
      const v = this.keyring.verify(rec.intent, p.timestampMs);
      rec.verification = v.ok ? 'ok' : v.reason;
      rec.verifiedGen = this.keyring.generation;
    }
    const i = rec.intent;
    const base = {
      required: true,
      intentKind: i.kind,
      issuer: i.issuer,
      maxAmountPaise: i.maxAmountPaise,
      remainingPaise: Math.max(0, i.maxAmountPaise - rec.usedPaise),
      uses: rec.uses,
      maxUses: i.maxUses,
      ...(i.subjectRef !== undefined ? { subjectRef: i.subjectRef } : {}),
    };
    if (rec.verification !== 'ok') return { ...base, status: 'bad-signature', detail: rec.verification };
    if (i.kind !== p.kind) return { ...base, status: 'kind-mismatch', detail: `intent ${i.kind}, payout ${p.kind}` };
    if (p.timestampMs < i.notBeforeMs || p.timestampMs > i.expiresAtMs) return { ...base, status: 'expired' };
    if (i.beneficiaryRef !== p.beneficiaryRef) return { ...base, status: 'beneficiary-mismatch' };
    if (rec.uses >= i.maxUses) return { ...base, status: 'reused' };
    if (p.amountPaise > base.remainingPaise) return { ...base, status: 'amount-exceeds' };
    return { ...base, status: 'ok' };
  }

  /** Consume one use for a payout that is going ahead. Idempotent per payoutId. */
  reserve(intentId: string, payoutId: string, amountPaise: number): void {
    if (this.reservations.has(payoutId)) return;
    const rec = this.store.get(intentId);
    if (rec === undefined) return;
    rec.uses += 1;
    rec.usedPaise += amountPaise;
    this.store.put(rec);
    this.reservations.set(payoutId, { intentId, amountPaise });
  }

  /** A payout failed or was reversed: give the use and amount back. */
  release(payoutId: string): boolean {
    const r = this.reservations.get(payoutId);
    if (r === undefined) return false;
    this.reservations.delete(payoutId);
    const rec = this.store.get(r.intentId);
    if (rec === undefined) return true;
    rec.uses = Math.max(0, rec.uses - 1);
    rec.usedPaise = Math.max(0, rec.usedPaise - r.amountPaise);
    this.store.put(rec);
    return true;
  }

  /** Settled: the reservation is final; forget the payout id. */
  settle(payoutId: string): boolean {
    return this.reservations.delete(payoutId);
  }

  exportState(): unknown {
    return {
      intents: [...this.store.entries()].map(([, r]) => ({ intent: r.intent, uses: r.uses, usedPaise: r.usedPaise })),
      reservations: [...this.reservations.entriesLeastRecentFirst()],
    };
  }

  restoreState(state: unknown): void {
    const s = state as {
      intents?: { intent: Intent; uses: number; usedPaise: number }[];
      reservations?: [string, Reservation][];
    };
    for (const row of s.intents ?? []) {
      const v = this.keyring.verify(row.intent, Date.now());
      this.store.put({
        intent: row.intent,
        uses: row.uses,
        usedPaise: row.usedPaise,
        verifiedGen: this.keyring.generation,
        verification: v.ok ? 'ok' : v.reason,
      });
    }
    for (const [k, v] of s.reservations ?? []) this.reservations.set(k, v);
  }
}
