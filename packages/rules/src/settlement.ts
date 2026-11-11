// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { Verdict, type PayoutRule } from '@payrekha/core';
import { hit, rupees } from './util.js';

/** PA settlement above the merchant's reconciled captured net (carried as the intent's maxAmountPaise). */
export function settlementOverCapturedRule(): PayoutRule {
  return {
    name: 'settlement.over-captured',
    evaluate(p, ctx) {
      if (p.kind !== 'PA_SETTLEMENT' || ctx.intent.status !== 'amount-exceeds') return null;
      return hit(
        'settlement.over-captured',
        Verdict.Block,
        `Settlement ${rupees(p.amountPaise)} exceeds the reconciled captured net of ${rupees(ctx.intent.remainingPaise ?? 0)}`,
        {
          amountPaise: p.amountPaise,
          reconciledPaise: ctx.intent.remainingPaise ?? 0,
          overByPaise: p.amountPaise - (ctx.intent.remainingPaise ?? 0),
        },
      );
    },
  };
}

export interface AccountChangedOptions {
  /** How long a changed settlement account stays suspicious. Default 24h. */
  readonly coolingMs?: number;
}

/** Maker-checker for merchant settlement instructions: a recently changed account gets a second look. */
export function settlementAccountChangedRule(o: AccountChangedOptions = {}): PayoutRule {
  const coolingMs = o.coolingMs ?? 24 * 3_600_000;
  return {
    name: 'settlement.account-changed',
    evaluate(p, ctx) {
      if (p.kind !== 'PA_SETTLEMENT' || p.merchantId === undefined || ctx.merchant === undefined) return null;
      const m = ctx.merchant;
      const changedNow = m.beneficiaryRef !== p.beneficiaryRef;
      const changedAt = changedNow ? p.timestampMs : m.changedAtMs;
      if (changedAt === undefined) return null;
      const age = p.timestampMs - changedAt;
      if (age < 0 || age >= coolingMs) return null;
      const mins = Math.round(age / 60_000);
      return hit(
        'settlement.account-changed',
        Verdict.Review,
        changedNow
          ? `Merchant is settling to a different account than last time — ${rupees(p.amountPaise)} held for maker-checker`
          : `Merchant settlement account changed ${mins} min ago — ${rupees(p.amountPaise)} held for maker-checker`,
        { merchantId: p.merchantId, minutesSinceChange: mins, coolingMinutes: Math.round(coolingMs / 60_000), amountPaise: p.amountPaise },
      );
    },
  };
}
