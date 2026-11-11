#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Payment-aggregator kit data: T+1 settlement cycles to merchants, plus
// account_change events and one planted settlement-reroute chain on day 17
// (account change → same-day settle to the new account).
import { makeGen, writeCsvs } from '../lib/gen.mjs';

const { int, ts, at, DAY } = makeGen(20261011);
const payouts = [];
const intents = [];
let pid = 0;
const P = (o) =>
  payouts.push({
    payout_id: `po-${String(++pid).padStart(6, '0')}`,
    channel: 'IMPS',
    source_key_id: 'settlement-svc',
    origin: 'prod',
    merchant_id: '',
    intent_id: '',
    approval_ids: '',
    event: '',
    ...o,
  });
const I = (o) => intents.push({ max_uses: 1, subject_ref: '', issuer: 'settlement-engine', key_id: 'se-2026-10', ...o });

const merchants = Array.from({ length: 40 }, (_, i) => ({ id: `m-${100 + i}`, vpa: `merchant${100 + i}@okicici` }));
let cycle = 0;
for (let day = 1; day <= 31; day++) {
  for (const m of merchants) {
    if (int(0, 9) < 2) continue; // not every merchant settles daily
    cycle += 1;
    const t = at(day, 18, int(0, 45), int(0, 59));
    const a = int(1, 40) * 1_00_000_00;
    const iid = `set-${day}-${m.id}`;
    I({
      intent_id: iid,
      kind: 'PA_SETTLEMENT',
      max_amount_paise: a,
      beneficiary_vpa: m.vpa,
      subject_ref: `cycle-${cycle}`,
      not_before: ts(t - 7_200_000),
      expires_at: ts(t + DAY),
    });
    P({ timestamp: ts(t), kind: 'PA_SETTLEMENT', amount_paise: a, beneficiary_vpa: m.vpa, intent_id: iid, merchant_id: m.id });
  }
}

// Day 17: merchant m-107 "updates" their settlement account at 09:00 —
// settlement engine emits account_changed — then a same-day settlement
// goes to the NEW account. That pairing is the takeover shape.
P({
  timestamp: ts(at(17, 9, 2)),
  kind: 'PA_SETTLEMENT',
  amount_paise: 0,
  beneficiary_vpa: 'm107new@okfraud',
  merchant_id: 'm-107',
  event: 'account_changed',
});
const settleAt = at(17, 18, 12);
I({
  intent_id: 'set-17-m-107-new',
  kind: 'PA_SETTLEMENT',
  max_amount_paise: 28_00_000_00,
  beneficiary_vpa: 'm107new@okfraud',
  subject_ref: 'cycle-x',
  not_before: ts(settleAt - 7_200_000),
  expires_at: ts(settleAt + DAY),
});
P({
  timestamp: ts(settleAt),
  kind: 'PA_SETTLEMENT',
  amount_paise: 28_00_000_00,
  beneficiary_vpa: 'm107new@okfraud',
  intent_id: 'set-17-m-107-new',
  merchant_id: 'm-107',
});

writeCsvs('kits/pa/data', payouts, intents);
