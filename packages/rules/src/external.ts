// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import { Verdict, type PayoutRule } from '@payrekha/core';
import { hit } from './util.js';

export interface ExternalOptions {
  /** riskScore at or above → REVIEW. Default 0.7. */
  readonly reviewScore?: number;
  /** riskScore at or above → BLOCK. Default 0.9. */
  readonly blockScore?: number;
  /** externalVerdict words that BLOCK (lowercased compare). Default block/decline/deny. */
  readonly verdictBlocks?: readonly string[];
  /** externalVerdict words that REVIEW. Default review/challenge/hold/step-up. */
  readonly verdictReviews?: readonly string[];
}

const DEFAULT_BLOCKS = ['block', 'decline', 'deny', 'reject'];
const DEFAULT_REVIEWS = ['review', 'challenge', 'hold', 'step-up', 'stepup', 'manual'];

/**
 * Upstream signal ingestion — the bridge rule for deployments that already
 * own a fraud scorer (Feedzai, Sardine, an LOS heuristic). Their verdict and
 * score arrive on the payout as `externalVerdict`/`riskScore` and become
 * advisory inputs here.
 *
 * Advisory means strictly one-directional: this rule can only make a verdict
 * *stricter*, never looser. A caller minimizing its own score merely evades
 * an advisory input — the intent binding, velocity and every other control
 * still apply. It therefore needs no signature to be safe to consume, though
 * asserting it at the proxy (ext_authz mapping) is stronger than trusting a
 * forwarded body field.
 */
export function externalRule(o: ExternalOptions = {}): PayoutRule {
  const reviewAt = o.reviewScore ?? 0.7;
  const blockAt = o.blockScore ?? 0.9;
  const blocks = new Set((o.verdictBlocks ?? DEFAULT_BLOCKS).map((s) => s.toLowerCase()));
  const reviews = new Set((o.verdictReviews ?? DEFAULT_REVIEWS).map((s) => s.toLowerCase()));
  return {
    name: 'external',
    evaluate(p) {
      const verdictWord = p.externalVerdict?.toLowerCase();
      const src = p.externalSource ?? 'upstream';
      const ev = {
        source: src,
        ...(p.riskScore !== undefined ? { riskScore: p.riskScore } : {}),
        ...(p.externalVerdict !== undefined ? { externalVerdict: p.externalVerdict } : {}),
      };
      if (verdictWord !== undefined && blocks.has(verdictWord))
        return hit('external.verdict', Verdict.Block, `Upstream signal '${p.externalVerdict}' from ${src} blocks this payout`, ev);
      if (p.riskScore !== undefined && p.riskScore >= blockAt)
        return hit('external.score', Verdict.Block, `Upstream risk score ${p.riskScore} from ${src} ≥ ${blockAt}`, ev);
      if (verdictWord !== undefined && reviews.has(verdictWord))
        return hit('external.verdict', Verdict.Review, `Upstream signal '${p.externalVerdict}' from ${src} wants review`, ev);
      if (p.riskScore !== undefined && p.riskScore >= reviewAt)
        return hit('external.score', Verdict.Review, `Upstream risk score ${p.riskScore} from ${src} ≥ ${reviewAt}`, ev);
      return null;
    },
  };
}
