// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { intentShapeProblem, type Keyring, type VerifyFailure } from './intent.js';
import { LruMap } from './lru.js';
import type { ApprovalRequirement, Intent, IntentKind, PayoutRequest } from './types.js';

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
  | 'reused'
  | 'approvals-insufficient'
  | 'approvals-not-distinct'
  | 'approvals-invalid';

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
  /**
   * m-of-n approval accounting (ADR 0003): how many intents the kind must
   * cite, how many valid distinct-issuer approvals were provided, and the
   * issuers seen across every cited intent. Present whenever approvals were
   * required or cited.
   */
  readonly approvals?: {
    readonly required: number;
    readonly provided: number;
    readonly issuers: readonly string[];
    readonly onInsufficient: 'block' | 'review';
  };
}

interface Reservation {
  readonly intentId: string;
  readonly amountPaise: number;
  /**
   * API key that consumed the intent. When set, only that key may report the
   * outcome — a `failed`/`reversed` report frees the intent for reuse, so it
   * must not be callable by whoever holds any key. Absent on reservations
   * restored from snapshots written before binding existed.
   */
  readonly sourceKeyId?: string;
  /**
   * True once the payout is reported settled. The record is kept (not
   * deleted) so the payoutId stays bound to this intent — otherwise a later
   * request citing a fresh intent under the same payoutId would look like a
   * first use once dedupe is evicted or lost on restart.
   */
  readonly settled?: boolean;
  /** Additional intent ids consumed as approvals (ADR 0003). */
  readonly approvalIds?: readonly string[];
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

  /**
   * The reservation bound to this payoutId, if any. The gateway reads this
   * to know `evaluate` consumed intents — that's the trigger for the shared
   * commit (ADR 0004).
   */
  reservationOf(payoutId: string): { readonly intentId: string; readonly approvalIds: readonly string[]; readonly amountPaise: number; readonly sourceKeyId: string | undefined } | undefined {
    const r = this.reservations.get(payoutId);
    if (r === undefined) return undefined;
    return { intentId: r.intentId, approvalIds: r.approvalIds ?? [], amountPaise: r.amountPaise, sourceKeyId: r.sourceKeyId };
  }

  /**
   * Authoritative counters learned from the shared backend (ADR 0004): the
   * remote value is the truth for committed consumption — including drops
   * after a cross-replica release. Local reservations not yet committed
   * correct themselves through the commit conflict path.
   */
  syncCounters(intentId: string, uses: number, usedPaise: number): void {
    const rec = this.store.get(intentId);
    if (rec === undefined) return;
    rec.uses = uses;
    rec.usedPaise = usedPaise;
  }

  /** Bind a payout to its intent. Pure read — consumption happens in `reserve`. */
  check(p: PayoutRequest, required: boolean, approval?: ApprovalRequirement): IntentCheck {
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
    // A payoutId may only ever be bound to one intent. Its own reservation is
    // already counted in `uses` (retry = ok, also across restarts where dedupe
    // is gone but reservations persist); any other reservation is identity
    // confusion, and citing a fresh intent under a taken payoutId must not
    // get a free pass — `reserve` would not consume it.
    const held = this.reservations.get(p.payoutId);
    if (held !== undefined && held.intentId !== p.intentId) return { ...base, status: 'reused', detail: 'payoutId already bound to another intent' };
    if (rec.uses >= i.maxUses && held === undefined) return { ...base, status: 'reused' };
    if (p.amountPaise > base.remainingPaise) return { ...base, status: 'amount-exceeds' };
    return this.checkApprovals(p, base, approval);
  }

  /**
   * m-of-n approvals (ADR 0003). Every cited approval id must resolve to an
   * intent that verifies, binds this payout's kind/beneficiary/amount and is
   * inside its window, and must come from an issuer no other cited intent
   * used — primary included. When `approval.approverIssuers` is set only
   * those issuers count toward the requirement; a cited intent outside the
   * list is still validated but does not count.
   */
  private checkApprovals(p: PayoutRequest, base: Omit<IntentCheck, 'status' | 'approvals'>, approval?: ApprovalRequirement): IntentCheck {
    const cited = p.approvalIds ?? [];
    if (cited.length === 0 && (approval === undefined || approval.count <= 1)) return { ...base, status: 'ok' };
    const seen = new Set<string>([base.issuer ?? '']);
    const eligible: string[] = [];
    const held = this.reservations.get(p.payoutId);
    const accounting = (req: ApprovalRequirement | undefined): NonNullable<IntentCheck['approvals']> => ({
      required: req?.count ?? 1,
      provided: 1 + eligible.length,
      issuers: [...seen],
      onInsufficient: req?.onInsufficient ?? 'block',
    });
    for (const id of cited) {
      const rec = this.store.get(id);
      const invalid = (d: string): IntentCheck => ({ ...base, status: 'approvals-invalid', detail: `approval '${id}': ${d}`, approvals: accounting(approval) });
      if (rec === undefined) return invalid('not registered');
      if (rec.verifiedGen !== this.keyring.generation) {
        const v = this.keyring.verify(rec.intent, p.timestampMs);
        rec.verification = v.ok ? 'ok' : v.reason;
        rec.verifiedGen = this.keyring.generation;
      }
      const i = rec.intent;
      if (rec.verification !== 'ok') return invalid(`signature rejected (${rec.verification})`);
      if (i.kind !== p.kind) return invalid(`kind ${i.kind} ≠ ${p.kind}`);
      if (p.timestampMs < i.notBeforeMs || p.timestampMs > i.expiresAtMs) return invalid('expired');
      if (i.beneficiaryRef !== p.beneficiaryRef) return invalid('beneficiary mismatch');
      if (p.amountPaise > Math.max(0, i.maxAmountPaise - rec.usedPaise)) return invalid('amount exceeds remaining');
      const ownUse = held !== undefined && (held.intentId === id || held.approvalIds?.includes(id) === true);
      if (rec.uses >= i.maxUses && !ownUse) return invalid('already consumed');
      if (seen.has(i.issuer)) return { ...base, status: 'approvals-not-distinct', detail: `issuer '${i.issuer}' cited more than once`, approvals: accounting(approval) };
      seen.add(i.issuer);
      if (approval?.approverIssuers === undefined || approval.approverIssuers.includes(i.issuer)) eligible.push(i.issuer);
    }
    const approvals = accounting(approval);
    if (approvals.provided < approvals.required) {
      return { ...base, status: 'approvals-insufficient', approvals, detail: `${approvals.provided}/${approvals.required} distinct-issuer approvals` };
    }
    return { ...base, status: 'ok', approvals };
  }

  /** Consume one use for a payout that is going ahead. Idempotent per payoutId. */
  reserve(intentId: string, payoutId: string, amountPaise: number, sourceKeyId?: string, approvalIds?: readonly string[]): void {
    if (this.reservations.has(payoutId)) return;
    for (const id of [intentId, ...(approvalIds ?? [])]) {
      const rec = this.store.get(id);
      if (rec === undefined) continue;
      rec.uses += 1;
      rec.usedPaise += amountPaise;
      this.store.put(rec);
    }
    this.reservations.set(payoutId, {
      intentId,
      amountPaise,
      ...(sourceKeyId !== undefined ? { sourceKeyId } : {}),
      ...(approvalIds !== undefined && approvalIds.length > 0 ? { approvalIds: [...approvalIds] } : {}),
    });
  }

  /**
   * A payout failed or was reversed: give the use and amount back.
   * `denied` when another key holds the reservation (an unkeyed caller may
   * never touch a bound one) or when it was already settled — a settled
   * payout cannot become failed.
   */
  release(payoutId: string, sourceKeyId?: string): 'released' | 'unknown' | 'denied' {
    const r = this.reservations.get(payoutId);
    if (r === undefined) return 'unknown';
    if (r.sourceKeyId !== undefined && r.sourceKeyId !== sourceKeyId) return 'denied';
    if (r.settled === true) return 'denied';
    this.reservations.delete(payoutId);
    for (const id of [r.intentId, ...(r.approvalIds ?? [])]) {
      const rec = this.store.get(id);
      if (rec === undefined) continue;
      rec.uses = Math.max(0, rec.uses - 1);
      rec.usedPaise = Math.max(0, rec.usedPaise - r.amountPaise);
      this.store.put(rec);
    }
    return 'released';
  }

  /**
   * Settled: the reservation is final but the payoutId→intent binding is
   * kept as a tombstone — deleting it would let the same payoutId consume a
   * fresh intent once dedupe is evicted or lost on restart. Idempotent
   * retries still report `settled`. `denied` on a foreign or unkeyed caller.
   */
  settle(payoutId: string, sourceKeyId?: string): 'settled' | 'unknown' | 'denied' {
    const r = this.reservations.get(payoutId);
    if (r === undefined) return 'unknown';
    if (r.sourceKeyId !== undefined && r.sourceKeyId !== sourceKeyId) return 'denied';
    if (r.settled === true) return 'settled';
    this.reservations.set(payoutId, { ...r, settled: true });
    return 'settled';
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
