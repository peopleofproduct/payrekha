// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { hashBeneficiary, Verdict, type PayoutRule } from '@payrekha/core';
import { hit } from './util.js';

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
const BANDS: readonly RiskBand[] = ['LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];

export interface FeedEntry {
  readonly band: RiskBand;
  readonly source: string;
}

/**
 * An operator-produced snapshot of a fraud-risk feed (e.g. the DoT FRI
 * list your bank already receives). Payrekha never calls the feed itself.
 * Entries carry `mobileRef` (already hashed with your Payrekha key) or a
 * raw `mobile` that is hashed on load and then discarded.
 */
export class FraudFeed {
  private entries = new Map<string, FeedEntry>();
  private loadedAt = 0;

  get size(): number {
    return this.entries.size;
  }

  get loadedAtMs(): number {
    return this.loadedAt;
  }

  lookup(mobileRef: string): FeedEntry | undefined {
    return this.entries.get(mobileRef);
  }

  /** Replace the snapshot atomically. Throws on a malformed file; the previous snapshot stays live. */
  load(snapshot: unknown, hashKey?: string | Buffer, nowMs = Date.now()): number {
    if (typeof snapshot !== 'object' || snapshot === null) throw new Error('feed snapshot must be an object');
    const s = snapshot as { version?: unknown; source?: unknown; entries?: unknown };
    if (s.version !== 1) throw new Error('feed snapshot version must be 1');
    if (!Array.isArray(s.entries)) throw new Error('feed snapshot entries must be an array');
    const src = typeof s.source === 'string' ? s.source : 'operator';
    const next = new Map<string, FeedEntry>();
    s.entries.forEach((raw: unknown, i) => {
      const e = raw as { mobileRef?: unknown; mobile?: unknown; band?: unknown; source?: unknown };
      if (typeof e.band !== 'string' || !BANDS.includes(e.band as RiskBand)) throw new Error(`entries[${i}].band invalid`);
      let ref: string;
      if (typeof e.mobileRef === 'string' && e.mobileRef.startsWith('hb1_')) ref = e.mobileRef;
      else if (typeof e.mobile === 'string') {
        if (hashKey === undefined) throw new Error(`entries[${i}] has a raw mobile but no hash key was supplied`);
        ref = hashBeneficiary({ mobile: e.mobile }, hashKey);
      } else throw new Error(`entries[${i}] needs mobileRef or mobile`);
      next.set(ref, { band: e.band as RiskBand, source: typeof e.source === 'string' ? e.source : src });
    });
    this.entries = next;
    this.loadedAt = nowMs;
    return next.size;
  }
}

export interface FeedRuleOptions {
  /** Default VERY_HIGH. */
  readonly blockAt?: RiskBand;
  /** Default MEDIUM. */
  readonly reviewAt?: RiskBand;
}

export function feedRule(feed: FraudFeed, o: FeedRuleOptions = {}): PayoutRule {
  const blockAt = BANDS.indexOf(o.blockAt ?? 'VERY_HIGH');
  const reviewAt = BANDS.indexOf(o.reviewAt ?? 'MEDIUM');
  return {
    name: 'feed.reputation',
    evaluate(p) {
      if (p.beneficiaryMobileRef === undefined || feed.size === 0) return null;
      const e = feed.lookup(p.beneficiaryMobileRef);
      if (e === undefined) return null;
      const lvl = BANDS.indexOf(e.band);
      if (lvl < reviewAt) return null;
      return hit('feed.reputation', lvl >= blockAt ? Verdict.Block : Verdict.Review, `Beneficiary mobile is ${e.band} risk on the ${e.source} feed snapshot`, {
        band: e.band,
        source: e.source,
        snapshotAgeMinutes: Math.round((p.timestampMs - feed.loadedAtMs) / 60_000),
      });
    },
    stats: () => ({ feedEntries: feed.size }),
  };
}
