// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { LruMap } from './lru.js';

/** What PayRekha remembers about a beneficiary (keyed by its hashed ref only). */
export interface BeneficiaryEntry {
  readonly firstSeenMs: number;
  /** Most recent micro-value payout to this beneficiary. */
  readonly lastMicro?: {
    readonly atMs: number;
    readonly amountPaise: number;
    /** Subject of the VERIFICATION intent that authorised it, when there was one. */
    readonly verifiedSubject?: string;
  };
  /** Subjects (loan/application ids) whose VERIFICATION intent covered this beneficiary. */
  readonly verifiedSubjects?: readonly string[];
}

/** Bounded per-beneficiary memory, shared by the probe and cooling rules. */
export class BeneficiaryLedger {
  private readonly lru: LruMap<string, BeneficiaryEntry>;
  constructor(capacity = 1_000_000) {
    this.lru = new LruMap(capacity);
  }
  get(ref: string): BeneficiaryEntry | undefined {
    return this.lru.peek(ref);
  }
  set(ref: string, e: BeneficiaryEntry): void {
    this.lru.set(ref, e);
  }
  get size(): number {
    return this.lru.size;
  }
  get evicted(): number {
    return this.lru.evictedCount;
  }
  exportState(): [string, BeneficiaryEntry][] {
    return [...this.lru.entriesLeastRecentFirst()];
  }
  restoreState(rows: readonly [string, BeneficiaryEntry][]): void {
    for (const [k, v] of rows) this.lru.set(k, v);
  }
}

export interface MerchantEntry {
  readonly beneficiaryRef: string;
  /** When the settlement account last changed; absent = never seen a change. */
  readonly changedAtMs?: number;
  readonly previousRef?: string;
}

/** Merchant → settlement account, for `settlement.account-changed`. */
export class MerchantLedger {
  private readonly lru: LruMap<string, MerchantEntry>;
  constructor(capacity = 200_000) {
    this.lru = new LruMap(capacity);
  }
  get(merchantId: string): MerchantEntry | undefined {
    return this.lru.peek(merchantId);
  }
  /** Record the account a merchant settles to; detects changes. */
  observe(merchantId: string, beneficiaryRef: string, atMs: number): void {
    const prev = this.lru.peek(merchantId);
    if (prev === undefined) this.lru.set(merchantId, { beneficiaryRef });
    else if (prev.beneficiaryRef !== beneficiaryRef)
      this.lru.set(merchantId, { beneficiaryRef, changedAtMs: atMs, previousRef: prev.beneficiaryRef });
  }
  /** Explicit change notice from the merchant-onboarding system (the best signal). */
  noteAccountChange(merchantId: string, beneficiaryRef: string, atMs: number): void {
    const prev = this.lru.peek(merchantId);
    this.lru.set(merchantId, {
      beneficiaryRef,
      changedAtMs: atMs,
      ...(prev !== undefined ? { previousRef: prev.beneficiaryRef } : {}),
    });
  }
  exportState(): [string, MerchantEntry][] {
    return [...this.lru.entriesLeastRecentFirst()];
  }
  restoreState(rows: readonly [string, MerchantEntry][]): void {
    for (const [k, v] of rows) this.lru.set(k, v);
  }
}

export interface CanarySets {
  readonly beneficiaryRefs: ReadonlySet<string>;
  readonly sourceKeyIds: ReadonlySet<string>;
  readonly intentIds: ReadonlySet<string>;
}

/** Deception refs: identifiers that no legitimate flow ever uses. */
export class CanaryRegistry implements CanarySets {
  readonly beneficiaryRefs = new Set<string>();
  readonly sourceKeyIds = new Set<string>();
  readonly intentIds = new Set<string>();
  add(c: { beneficiaryRefs?: readonly string[]; sourceKeyIds?: readonly string[]; intentIds?: readonly string[] }): number {
    let n = 0;
    for (const r of c.beneficiaryRefs ?? [])
      if (!this.beneficiaryRefs.has(r)) {
        this.beneficiaryRefs.add(r);
        n++;
      }
    for (const r of c.sourceKeyIds ?? [])
      if (!this.sourceKeyIds.has(r)) {
        this.sourceKeyIds.add(r);
        n++;
      }
    for (const r of c.intentIds ?? [])
      if (!this.intentIds.has(r)) {
        this.intentIds.add(r);
        n++;
      }
    return n;
  }
  get size(): number {
    return this.beneficiaryRefs.size + this.sourceKeyIds.size + this.intentIds.size;
  }
  exportState(): { beneficiaryRefs: string[]; sourceKeyIds: string[]; intentIds: string[] } {
    return { beneficiaryRefs: [...this.beneficiaryRefs], sourceKeyIds: [...this.sourceKeyIds], intentIds: [...this.intentIds] };
  }
}
