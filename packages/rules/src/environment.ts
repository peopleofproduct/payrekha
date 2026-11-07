// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { LruMap, Verdict, type IntentKind, type PayoutRule } from '@payrekha/core';
import { hit } from './util.js';

export interface OriginOptions {
  /** API keys / client ids issued to UAT, staging, sandbox. */
  readonly nonProdKeyIds?: readonly string[];
  /** Key-id prefixes that mark non-prod credentials. Default uat/stg/staging/sandbox/test. */
  readonly nonProdKeyPrefixes?: readonly string[];
  /** What to do when the network layer did not tag the origin. Default `ignore`. */
  readonly unknownOrigin?: 'ignore' | 'review';
}

const DEFAULT_PREFIXES = ['uat-', 'uat_', 'stg-', 'stg_', 'staging-', 'staging_', 'sandbox-', 'sandbox_', 'test-', 'test_'];

/** UAT/staging must never move production money — the CRAFTY FALCON pivot path. */
export function originRule(o: OriginOptions = {}): PayoutRule {
  const keys = new Set(o.nonProdKeyIds ?? []);
  const prefixes = (o.nonProdKeyPrefixes ?? DEFAULT_PREFIXES).map((s) => s.toLowerCase());
  return {
    name: 'origin.nonprod',
    evaluate(p) {
      const keyHit = keys.has(p.sourceKeyId) || prefixes.some((pre) => p.sourceKeyId.toLowerCase().startsWith(pre));
      if (p.origin === 'nonprod' || keyHit) {
        return hit('origin.nonprod', Verdict.Block, `Payout came from a non-production ${p.origin === 'nonprod' ? 'network origin' : 'API key'} — UAT/staging can never move real money`, {
          origin: p.origin,
          sourceKeyId: p.sourceKeyId,
          matchedKeyList: keyHit,
        });
      }
      if (p.origin === 'unknown' && o.unknownOrigin === 'review')
        return hit('origin.nonprod', Verdict.Review, 'Network origin was not tagged by the gateway', { origin: p.origin, sourceKeyId: p.sourceKeyId, matchedKeyList: false });
      return null;
    },
  };
}

/** Deception: a canary ref never appears in legitimate flows. Touching one means someone is inside. */
export function canaryRule(): PayoutRule {
  return {
    name: 'canary.tripped',
    evaluate(p, ctx) {
      const c = ctx.canaries;
      const which = c.beneficiaryRefs.has(p.beneficiaryRef)
        ? 'beneficiary'
        : c.sourceKeyIds.has(p.sourceKeyId)
          ? 'sourceKey'
          : p.intentId !== undefined && c.intentIds.has(p.intentId)
            ? 'intent'
            : null;
      if (which === null) return null;
      return hit('canary.tripped', Verdict.Block, `Canary ${which} touched — entering HIGH_ALERT`, { canary: which, sourceKeyId: p.sourceKeyId }, 'HIGH_ALERT');
    },
  };
}

export interface FingerprintOptions {
  /**
   * What a changed hint means. Default `review`; `evidence` logs an
   * ALLOW-severity hit (a lead for the SIEM, nothing held); `block` for
   * callers whose hint should never legitimately move.
   */
  readonly onChange?: 'review' | 'block' | 'evidence';
  /** Bound on tracked keys. Default 100,000 (LRU). */
  readonly maxTrackedKeys?: number;
}

/**
 * Token-usage fingerprinting (CERT-In RA12): the first `sourceHint` an API
 * key presents enrols it; a different hint later means the credential is
 * being used from somewhere new. The hint is edge-asserted (socket peer /
 * proxy headers — never the body), so a change is a lead, not proof —
 * egress IP rotation happens. Each transition re-enrols, so a hint
 * flapping between values fires on every flip; compose the hint for
 * stability (e.g. ASN or subnet, not the raw rotating IP).
 */
export function fingerprintRule(o: FingerprintOptions = {}): PayoutRule {
  const onChange = o.onChange ?? 'review';
  const seen = new LruMap<string, string>(o.maxTrackedKeys ?? 100_000);
  return {
    name: 'identity.fingerprint',
    evaluate(p) {
      if (p.sourceHint === undefined || typeof p.sourceKeyId !== 'string' || p.sourceKeyId === '') return null;
      const enrolled = seen.get(p.sourceKeyId);
      if (enrolled === undefined) {
        seen.set(p.sourceKeyId, p.sourceHint);
        return hit('identity.fingerprint', Verdict.Allow, 'First source hint enrolled for this API key', { sourceKeyId: p.sourceKeyId, enrolled: true });
      }
      if (enrolled === p.sourceHint) return null;
      seen.set(p.sourceKeyId, p.sourceHint);
      return hit(
        'identity.fingerprint',
        onChange === 'block' ? Verdict.Block : onChange === 'evidence' ? Verdict.Allow : Verdict.Review,
        'This API key is being used from a new source — token usage from an unusual source (edge-asserted hint changed)',
        { sourceKeyId: p.sourceKeyId, enrolled: false, previousHint: enrolled.slice(0, 64) },
      );
    },
    reset: () => seen.clear(),
    exportState: () => [...seen.entriesLeastRecentFirst()],
    restoreState(s) {
      for (const [k, v] of s as [string, string][]) seen.set(k, v);
    },
    stats: () => ({ fingerprintedKeys: seen.size }),
  };
}

/** Repackaged apps calling APIs directly: require app attestation for chosen kinds. */
export function attestationRule(o: { readonly requireAttestation?: readonly IntentKind[] } = {}): PayoutRule {
  const kinds = new Set(o.requireAttestation ?? []);
  return {
    name: 'client.unattested',
    evaluate(p) {
      if (!kinds.has(p.kind) || p.clientAttested === true) return null;
      return hit('client.unattested', Verdict.Review, `${p.kind} needs an attested client; this call ${p.clientAttested === false ? 'failed' : 'carried no'} attestation`, {
        kind: p.kind,
        clientAttested: p.clientAttested === undefined ? 'absent' : String(p.clientAttested),
      });
    },
  };
}

/**
 * Not a blocker. Records which low-coverage window (holiday, weekend,
 * night) tightened the thresholds, so the evidence explains itself.
 */
export function calendarRule(): PayoutRule {
  return {
    name: 'calendar.window',
    evaluate(_p, ctx) {
      const w = ctx.calendarWindow;
      if (w === null || ctx.alertState === 'HIGH_ALERT') return null;
      return hit('calendar.window', Verdict.Allow, `${w.kind === 'holiday' ? w.label : w.kind === 'weekend' ? `Weekend (${w.label})` : `Low-coverage hours (${w.label})`}: thresholds tightened`, {
        window: w.kind,
        label: w.label,
        istDate: w.istDate,
        velocityMultiplier: ctx.multipliers.velocity,
        coolingMultiplier: ctx.multipliers.coolingAmount,
      });
    },
  };
}
