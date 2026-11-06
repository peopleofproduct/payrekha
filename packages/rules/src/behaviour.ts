// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { LruMap, TimeRing, Verdict, type IntentKind, type PayoutRule } from '@payrekha/core';
import { hit, rupees } from './util.js';

export interface ProbeOptions {
  /** Look-back after a micro payout. Default 24h. */
  readonly windowMs?: number;
  /** "Large" absolute floor. Default ₹10,000. */
  readonly largePaise?: number;
  /** "Large" relative to the micro. Default 100×. */
  readonly largeMultiple?: number;
}

/**
 * ₹1 test transfer, then the real one. The classic is legitimate at
 * lenders (penny-drop account verification), so a micro authorised by a
 * VERIFICATION intent for the *same subject* is exempt — see docs/penny-drop.md.
 */
export function probeRule(o: ProbeOptions = {}): PayoutRule {
  const windowMs = o.windowMs ?? 24 * 3_600_000;
  const largePaise = o.largePaise ?? 10_000_00;
  const largeMultiple = o.largeMultiple ?? 100;
  return {
    name: 'probe.micro-then-large',
    evaluate(p, ctx) {
      const micro = ctx.beneficiary?.lastMicro;
      if (micro === undefined || p.amountPaise <= ctx.microPaise) return null;
      const age = p.timestampMs - micro.atMs;
      if (age < 0 || age > windowMs) return null;
      if (p.amountPaise < largePaise && p.amountPaise < micro.amountPaise * largeMultiple) return null;
      if (micro.verifiedSubject !== undefined && ctx.intent.status === 'ok' && ctx.intent.subjectRef === micro.verifiedSubject) return null;
      // Same exemption as cooling: the beneficiary was verified for this
      // subject by an earlier VERIFICATION intent, even if the tagged
      // micro itself wasn't the one still in the ledger window.
      if (ctx.intent.status === 'ok' && ctx.intent.subjectRef !== undefined && ctx.beneficiary?.verifiedSubjects?.includes(ctx.intent.subjectRef) === true) return null;
      const high = ctx.alertState === 'HIGH_ALERT';
      return hit(
        'probe.micro-then-large',
        high ? Verdict.Block : Verdict.Review,
        `${rupees(micro.amountPaise)} test transfer ${Math.max(1, Math.round(age / 60_000))} min ago, now ${rupees(p.amountPaise)} to the same account` +
          (micro.verifiedSubject === undefined ? ' (the micro was not a VERIFICATION intent)' : ' (verified for a different subject)'),
        { microPaise: micro.amountPaise, amountPaise: p.amountPaise, minutesSinceMicro: Math.round(age / 60_000), multiple: Math.round(p.amountPaise / micro.amountPaise), alertState: ctx.alertState },
      );
    },
  };
}

export interface CoolingOptions {
  /** Default 30 min. */
  readonly coolingMs?: number;
  /** Default ₹50,000; scaled by the alert-state `coolingAmount` multiplier. */
  readonly minAmountPaise?: number;
  /**
   * Skip cooling when a valid intent already binds this exact beneficiary
   * (the system of record vouched for it). Default true; set false to cool
   * every new beneficiary regardless.
   */
  readonly exemptBoundIntents?: boolean;
}

/** New-beneficiary cooling period for payouts nobody vouched for. */
export function coolingRule(o: CoolingOptions = {}): PayoutRule {
  const coolingMs = o.coolingMs ?? 30 * 60_000;
  const minPaise = o.minAmountPaise ?? 50_000_00;
  const exemptBound = o.exemptBoundIntents ?? true;
  return {
    name: 'beneficiary.cooling',
    evaluate(p, ctx) {
      const threshold = Math.round(minPaise * ctx.multipliers.coolingAmount);
      if (p.amountPaise < threshold) return null;
      const first = ctx.beneficiary?.firstSeenMs ?? p.timestampMs;
      const age = p.timestampMs - first;
      if (age >= coolingMs) return null;
      if (ctx.intent.status === 'ok' && exemptBound) return null;
      const subj = ctx.intent.subjectRef;
      if (ctx.intent.status === 'ok' && subj !== undefined && ctx.beneficiary?.verifiedSubjects?.includes(subj) === true) return null;
      return hit(
        'beneficiary.cooling',
        Verdict.Review,
        `Beneficiary first seen ${Math.round(age / 60_000)} min ago; ${rupees(p.amountPaise)} is above the ${rupees(threshold)} cooling threshold`,
        { minutesSinceFirstSeen: Math.round(age / 60_000), coolingMinutes: Math.round(coolingMs / 60_000), thresholdPaise: threshold, amountPaise: p.amountPaise, alertState: ctx.alertState },
      );
    },
  };
}

export interface Budget {
  readonly count: number;
  readonly sumPaise: number;
}

export interface VelocityOptions {
  /** Default 10 min. */
  readonly windowMs?: number;
  readonly perSourceKey?: Budget;
  /** Per-key budgets for known batch callers (settlement engine, AP/ERP run). */
  readonly perSourceKeyOverrides?: Readonly<Record<string, Budget>>;
  readonly perMerchant?: Budget;
  readonly global?: Budget;
  /** BLOCK above budget × this. Default 2. */
  readonly hardCapFactor?: number;
  readonly maxTrackedKeys?: number;
}

/**
 * Outflow velocity per calling API key, per merchant and globally.
 * Budgets scale with the alert state: halved on holidays by default.
 */
export function velocityRule(o: VelocityOptions = {}): PayoutRule {
  const windowMs = o.windowMs ?? 10 * 60_000;
  const perKey = o.perSourceKey ?? { count: 20, sumPaise: 50_00_000_00 };
  const perMerchant = o.perMerchant ?? { count: 50, sumPaise: 2_00_00_000_00 };
  const global = o.global ?? { count: 500, sumPaise: 10_00_00_000_00 };
  const hardCap = o.hardCapFactor ?? 2;
  const overrides = o.perSourceKeyOverrides ?? {};
  const keyBudget = (id: string): Budget => (Object.hasOwn(overrides, id) ? overrides[id]! : perKey);
  const cap = (b: Budget) => Math.min(4_096, Math.max(64, Math.ceil(b.count * hardCap) + 8));
  // Per-key and per-merchant rings live in separate maps: merchantId is a
  // caller-supplied field, so merchant-churn must never evict source-key
  // budgets (a caller could reset its own or a victim's velocity history).
  const keyRings = new LruMap<string, TimeRing>(o.maxTrackedKeys ?? 100_000);
  const merchantRings = new LruMap<string, TimeRing>(o.maxTrackedKeys ?? 100_000);
  let globalRing = new TimeRing(cap(global));
  const ringFor = (key: string, b: Budget): TimeRing => {
    const map = key.startsWith('m:') ? merchantRings : keyRings;
    let r = map.get(key);
    if (r === undefined) {
      r = new TimeRing(cap(b));
      map.set(key, r);
    }
    return r;
  };
  const check = (scope: string, r: TimeRing, b: Budget, p: { timestampMs: number; amountPaise: number }, m: number) => {
    r.push(p.timestampMs, p.amountPaise);
    const w = r.window(p.timestampMs - windowMs, p.timestampMs);
    const count = Math.max(1, Math.floor(b.count * m));
    const sum = Math.max(1, Math.floor(b.sumPaise * m));
    const over = Math.max(w.count / count, w.sum / sum);
    return over > 1 ? { scope, count: w.count, sum: w.sum, budgetCount: count, budgetSum: sum, over } : null;
  };
  return {
    name: 'velocity.outflow',
    evaluate(p, ctx) {
      const m = ctx.multipliers.velocity;
      const results = [
        check('sourceKey', ringFor(`k:${p.sourceKeyId}`, keyBudget(p.sourceKeyId)), keyBudget(p.sourceKeyId), p, m),
        p.merchantId !== undefined ? check('merchant', ringFor(`m:${p.merchantId}`, perMerchant), perMerchant, p, m) : null,
        check('global', globalRing, global, p, m),
      ];
      let worst: NonNullable<(typeof results)[number]> | null = null;
      for (const r of results) if (r !== null && (worst === null || r.over > worst.over)) worst = r;
      if (worst === null) return null;
      const block = worst.over > hardCap;
      return hit(
        'velocity.outflow',
        block ? Verdict.Block : Verdict.Review,
        `${worst.count} payouts / ${rupees(worst.sum)} from this ${worst.scope} in ${Math.round(windowMs / 60_000)} min; budget ${worst.budgetCount} / ${rupees(worst.budgetSum)}` +
          (m !== 1 ? ` (${ctx.alertState}: ×${m})` : '') + (block ? ' — above hard cap' : ''),
        { scope: worst.scope, count: worst.count, sumPaise: worst.sum, budgetCount: worst.budgetCount, budgetSumPaise: worst.budgetSum, multiplier: m, alertState: ctx.alertState },
      );
    },
    reset() {
      keyRings.clear();
      merchantRings.clear();
      globalRing = new TimeRing(cap(global));
    },
    exportState() {
      return {
        global: globalRing.toJSON(),
        keys: [...keyRings.entriesLeastRecentFirst()].map(([k, r]) => [k, r.toJSON()]),
        merchants: [...merchantRings.entriesLeastRecentFirst()].map(([k, r]) => [k, r.toJSON()]),
      };
    },
    restoreState(s) {
      const st = s as { global?: [number, number][]; keys?: [string, [number, number][]][]; merchants?: [string, [number, number][]][] };
      globalRing = TimeRing.from(cap(global), st.global ?? []);
      // Older snapshots kept k:/m: in one list; new ones split them.
      for (const [k, rows] of st.keys ?? []) {
        const map = k.startsWith('m:') ? merchantRings : keyRings;
        map.set(k, TimeRing.from(cap(k.startsWith('m:') ? perMerchant : keyBudget(k.slice(2))), rows));
      }
      for (const [k, rows] of st.merchants ?? []) merchantRings.set(k, TimeRing.from(cap(perMerchant), rows));
    },
    stats: () => ({ trackedKeys: keyRings.size, trackedMerchants: merchantRings.size, evictedKeys: keyRings.evictedCount + merchantRings.evictedCount }),
  };
}

export interface BandOptions {
  /** Rolling sample size per kind+channel. Default 256. */
  readonly sampleSize?: number;
  /** Minimum samples before the rule speaks. Default 50. */
  readonly minSamples?: number;
  /** Robust z-score (|x − median| / 1.4826·MAD) that fires. Default 8. */
  readonly threshold?: number;
  readonly excludeKinds?: readonly IntentKind[];
}

const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Amount far above the rolling band for this kind + channel. Median/MAD — no ML. */
export function bandRule(o: BandOptions = {}): PayoutRule {
  const size = o.sampleSize ?? 256;
  const minSamples = o.minSamples ?? 50;
  const threshold = o.threshold ?? 8;
  const exclude = new Set(o.excludeKinds ?? ['VERIFICATION']);
  const bands = new Map<string, { ring: TimeRing; med: number; mad: number; stale: number }>();
  return {
    name: 'amount.band-anomaly',
    evaluate(p) {
      if (exclude.has(p.kind)) return null;
      const key = `${p.kind}|${p.channel}`;
      let b = bands.get(key);
      if (b === undefined) bands.set(key, (b = { ring: new TimeRing(size), med: 0, mad: 0, stale: Number.MAX_SAFE_INTEGER }));
      let result = null;
      if (b.ring.length >= minSamples) {
        // Recompute the band every 16 samples: keeps the hot path O(1) amortised.
        if (b.stale >= 16) {
          const xs = b.ring.values();
          b.med = median(xs);
          b.mad = median(xs.map((x) => Math.abs(x - b!.med)));
          b.stale = 0;
        }
        const scale = Math.max(1.4826 * b.mad, b.med * 0.05, 1);
        const z = (p.amountPaise - b.med) / scale;
        if (z > threshold) {
          result = hit(
            'amount.band-anomaly',
            Verdict.Review,
            `${rupees(p.amountPaise)} is far above the usual ${p.kind} ${p.channel} band (median ${rupees(Math.round(b.med))})`,
            { amountPaise: p.amountPaise, medianPaise: Math.round(b.med), madPaise: Math.round(b.mad), robustZ: Math.round(z * 10) / 10, samples: b.ring.length },
          );
        }
      }
      b.ring.push(p.timestampMs, p.amountPaise);
      b.stale += 1;
      return result;
    },
    reset: () => bands.clear(),
    exportState: () => [...bands].map(([k, b]) => [k, b.ring.toJSON()]),
    restoreState(s) {
      for (const [k, rows] of s as [string, [number, number][]][]) bands.set(k, { ring: TimeRing.from(size, rows), med: 0, mad: 0, stale: Number.MAX_SAFE_INTEGER });
    },
    stats: () => ({ bands: bands.size }),
  };
}
