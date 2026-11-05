// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import type { IntentKind, PayoutRule } from '@payrekha/core';
import { bandRule, coolingRule, probeRule, velocityRule, type BandOptions, type CoolingOptions, type ProbeOptions, type VelocityOptions } from './behaviour.js';
import { attestationRule, calendarRule, canaryRule, originRule, type OriginOptions } from './environment.js';
import { externalRule, type ExternalOptions } from './external.js';
import { FraudFeed, feedRule, type FeedRuleOptions } from './feed.js';
import { intentRule } from './intent.js';
import { settlementAccountChangedRule, settlementOverCapturedRule, type AccountChangedOptions } from './settlement.js';

export interface RulesConfig {
  readonly probe?: ProbeOptions;
  readonly cooling?: CoolingOptions;
  readonly velocity?: VelocityOptions;
  readonly band?: BandOptions | false;
  readonly origin?: OriginOptions;
  readonly settlement?: AccountChangedOptions;
  readonly feed?: FeedRuleOptions;
  readonly external?: ExternalOptions;
  readonly requireAttestation?: readonly IntentKind[];
}

export interface RuleSet {
  readonly rules: PayoutRule[];
  readonly feed: FraudFeed;
}

/**
 * The default rule chain, cheapest and most decisive first: canaries and
 * environment, then the intent binding, then behaviour. The first BLOCK
 * short-circuits, so the order is also the "why" order in evidence.
 */
export function payrekhaRules(cfg: RulesConfig = {}, feed = new FraudFeed()): RuleSet {
  const rules: PayoutRule[] = [
    canaryRule(),
    originRule(cfg.origin),
    intentRule(),
    externalRule(cfg.external),
    settlementOverCapturedRule(),
    settlementAccountChangedRule(cfg.settlement),
    probeRule(cfg.probe),
    coolingRule(cfg.cooling),
    velocityRule(cfg.velocity),
    ...(cfg.band === false ? [] : [bandRule(cfg.band)]),
    feedRule(feed, cfg.feed),
    attestationRule(cfg.requireAttestation !== undefined ? { requireAttestation: cfg.requireAttestation } : {}),
    calendarRule(),
  ];
  return { rules, feed };
}

/** Every rule id the default chain can emit — for docs and tests. */
export const RULE_IDS = [
  'canary.tripped',
  'origin.nonprod',
  'intent.missing',
  'intent.bad-signature',
  'intent.kind-mismatch',
  'intent.expired',
  'intent.beneficiary-mismatch',
  'intent.reused',
  'intent.amount-exceeds',
  'external.verdict',
  'external.score',
  'settlement.over-captured',
  'settlement.account-changed',
  'probe.micro-then-large',
  'beneficiary.cooling',
  'velocity.outflow',
  'amount.band-anomaly',
  'feed.reputation',
  'client.unattested',
  'calendar.window',
] as const;
