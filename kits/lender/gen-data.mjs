#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Lender (NBFC/LMS) kit data: a month of penny-drops → disbursals → refunds,
// with a planted credential-stuffing burst on day 14 and a same-day
// disbursal spike on day 21 for the report to find.
import { makeGen, writeCsvs } from '../lib/gen.mjs';

const { rnd, int, ts, at, DAY } = makeGen(20261001);
const payouts = [];
const intents = [];
let pid = 0;
const P = (o) =>
  payouts.push({
    payout_id: `po-${String(++pid).padStart(6, '0')}`,
    channel: 'IMPS',
    source_key_id: 'lms-prod',
    origin: 'prod',
    merchant_id: '',
    intent_id: '',
    approval_ids: '',
    event: '',
    ...o,
  });
const I = (o) => intents.push({ max_uses: 1, subject_ref: '', issuer: 'los-prod', key_id: 'los-2026-10', ...o });

let loan = 0;
for (let day = 1; day <= 31; day++) {
  const n = day === 20 ? 6 : int(25, 40); // RBI holiday quiet day
  for (let k = 0; k < n; k++) {
    const id = ++loan;
    const vpa = `borrower${id}@oksbi`;
    const verifyAt = at(day, int(9, 17), int(0, 59), int(0, 59));
    const disbAt = verifyAt + (rnd() < 0.1 ? int(20, 180) * 60_000 : int(26, 72) * 3_600_000);
    const amount = int(50, 500) * 1_000_00;
    I({
      intent_id: `ver-${id}`,
      kind: 'VERIFICATION',
      max_amount_paise: 100,
      beneficiary_vpa: vpa,
      subject_ref: `loan-${id}`,
      not_before: ts(verifyAt - 60_000),
      expires_at: ts(verifyAt + DAY),
    });
    P({ timestamp: ts(verifyAt), kind: 'VERIFICATION', amount_paise: 100, beneficiary_vpa: vpa, intent_id: `ver-${id}` });
    I({
      intent_id: `disb-${id}`,
      kind: 'LOAN_DISBURSAL',
      max_amount_paise: amount,
      beneficiary_vpa: vpa,
      subject_ref: `loan-${id}`,
      not_before: ts(disbAt - 3_600_000),
      expires_at: ts(disbAt + 2 * DAY),
    });
    P({ timestamp: ts(disbAt), kind: 'LOAN_DISBURSAL', amount_paise: amount, beneficiary_vpa: vpa, intent_id: `disb-${id}` });
  }
  for (let k = 0; k < int(8, 18); k++) {
    const t = at(day, int(9, 20), int(0, 59), int(0, 59));
    const a = int(5, 50) * 100_00;
    const vpa = `customer${int(1, 300)}@okaxis`;
    I({
      intent_id: `ref-${day}-${k}`,
      kind: 'REFUND',
      max_amount_paise: a,
      beneficiary_vpa: vpa,
      not_before: ts(t - 3_600_000),
      expires_at: ts(t + DAY),
    });
    P({
      timestamp: ts(t),
      kind: 'REFUND',
      amount_paise: a,
      beneficiary_vpa: vpa,
      intent_id: `ref-${day}-${k}`,
      source_key_id: 'refunds-svc',
    });
  }
}

// Day 14, 02:00–02:20: a scripted burst through the lms-prod key — micro
// probes then large disbursal attempts to fresh VPAs. The rules should
// light this up without a single planted label.
for (let k = 0; k < 30; k++) {
  const t = at(14, 2, int(0, 19), int(0, 59));
  const probe = k < 8;
  P({
    timestamp: ts(t),
    kind: probe ? 'VERIFICATION' : 'LOAN_DISBURSAL',
    amount_paise: probe ? 100 : int(200, 900) * 1_000_00,
    beneficiary_vpa: `newacct${k}@okpaytm`,
    intent_id: '',
  });
}
// Day 21: 40 same-minute disbursals from refunds-svc (wrong key, wrong shape).
for (let k = 0; k < 40; k++) {
  P({
    timestamp: ts(at(21, 13, 5, k)),
    kind: 'LOAN_DISBURSAL',
    amount_paise: int(100, 400) * 1_000_00,
    beneficiary_vpa: `r${k}@okaxis`,
    intent_id: `disb-${loan + k}`,
    source_key_id: 'refunds-svc',
  });
}

writeCsvs('kits/lender/data', payouts, intents);
