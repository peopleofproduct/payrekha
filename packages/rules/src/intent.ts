// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import { Verdict, type PayoutRule } from '@payrekha/core';
import { hit, rupees } from './util.js';

/**
 * The core defence: a payout leaves only against an intent signed by a
 * *different* system (LOS/LMS, settlement engine). Emits one of
 * intent.missing · intent.bad-signature · intent.kind-mismatch ·
 * intent.expired · intent.beneficiary-mismatch · intent.reused ·
 * intent.amount-exceeds · intent.approvals-insufficient ·
 * intent.approvals-not-distinct · intent.approvals-invalid. All BLOCK,
 * except approvals-insufficient which follows the kind's
 * `requiredApprovals.onInsufficient` (block | review).
 */
export function intentRule(): PayoutRule {
  return {
    name: 'intent',
    evaluate(p, ctx) {
      const c = ctx.intent;
      const ev = {
        kind: p.kind,
        ...(c.intentKind !== undefined ? { intentKind: c.intentKind } : {}),
        ...(c.issuer !== undefined ? { issuer: c.issuer } : {}),
        required: c.required,
        alertState: ctx.alertState,
      };
      switch (c.status) {
        case 'ok':
        case 'not-required':
          return null;
        case 'missing':
          return hit(
            'intent.missing',
            Verdict.Block,
            p.intentId === undefined || p.intentId === ''
              ? `No intent on this ${p.kind} payout${ctx.alertState === 'HIGH_ALERT' ? ' (HIGH_ALERT: every kind needs one)' : ''} — no matching intent, no payout`
              : 'Intent id is not registered — no matching intent, no payout',
            { ...ev, detail: c.detail ?? 'missing' },
          );
        case 'bad-signature':
          return hit('intent.bad-signature', Verdict.Block, `Intent failed verification (${c.detail ?? 'bad-signature'})`, {
            ...ev,
            detail: c.detail ?? 'bad-signature',
          });
        case 'kind-mismatch':
          return hit('intent.kind-mismatch', Verdict.Block, `Intent authorises ${c.intentKind ?? '?'}, payout is ${p.kind}`, ev);
        case 'expired':
          return hit('intent.expired', Verdict.Block, 'Payout is outside the intent validity window', ev);
        case 'beneficiary-mismatch':
          return hit('intent.beneficiary-mismatch', Verdict.Block, 'Payout beneficiary is not the one the intent was signed for', ev);
        case 'reused':
          return hit('intent.reused', Verdict.Block, `Intent already used ${c.uses ?? 0}/${c.maxUses ?? 1} time(s)`, {
            ...ev,
            uses: c.uses ?? 0,
            maxUses: c.maxUses ?? 1,
          });
        case 'amount-exceeds':
          // PA settlements report this as settlement.over-captured (more specific).
          if (p.kind === 'PA_SETTLEMENT') return null;
          return hit(
            'intent.amount-exceeds',
            Verdict.Block,
            `${rupees(p.amountPaise)} exceeds the ${rupees(c.remainingPaise ?? 0)} left on the intent`,
            {
              ...ev,
              amountPaise: p.amountPaise,
              remainingPaise: c.remainingPaise ?? 0,
              maxAmountPaise: c.maxAmountPaise ?? 0,
            },
          );
        case 'approvals-insufficient': {
          // Configured per kind: 'review' holds for the maker-checker queue
          // while approvers onboard; 'block' (default) declines outright.
          const v = c.approvals?.onInsufficient === 'review' ? Verdict.Review : Verdict.Block;
          return hit(
            'intent.approvals-insufficient',
            v,
            `${p.kind} needs ${c.approvals?.required ?? '?'} distinct-issuer approvals — only ${c.approvals?.provided ?? 1} valid intent(s) cited`,
            {
              ...ev,
              ...(c.approvals !== undefined
                ? {
                    required: c.approvals.required,
                    provided: c.approvals.provided,
                    issuers: c.approvals.issuers.join(','),
                    onInsufficient: c.approvals.onInsufficient,
                  }
                : {}),
            },
          );
        }
        case 'approvals-not-distinct':
          return hit(
            'intent.approvals-not-distinct',
            Verdict.Block,
            `Approvals must come from distinct issuers — ${c.detail ?? 'one party cited twice'}`,
            { ...ev, ...(c.approvals !== undefined ? { issuers: c.approvals.issuers.join(',') } : {}) },
          );
        case 'approvals-invalid':
          return hit('intent.approvals-invalid', Verdict.Block, `Cited approval failed — ${c.detail ?? 'invalid approval'}`, {
            ...ev,
            detail: c.detail ?? 'invalid',
            ...(c.approvals !== undefined ? { issuers: c.approvals.issuers.join(',') } : {}),
          });
      }
    },
  };
}
