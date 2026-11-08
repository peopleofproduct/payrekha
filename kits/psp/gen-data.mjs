#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// PSP/refund-flow kit data: heavy REFUND + small VERIFICATION volume, with a
// planted refund-mill on day 9 (many small refunds to one fresh VPA over a
// lunch window) and after-hours bulk refunds on day 25.
import { makeGen, writeCsvs } from '../lib/gen.mjs';

const { int, ts, at, DAY } = makeGen(20261019);
const payouts = [];
const intents = [];
let pid = 0;
const P = (o) => payouts.push({ payout_id: `po-${String(++pid).padStart(6, '0')}`, channel: 'UPI', source_key_id: 'refund-api', origin: 'prod', merchant_id: '', intent_id: '', approval_ids: '', event: '', ...o });
const I = (o) => intents.push({ max_uses: 1, subject_ref: '', issuer: 'refund-engine', key_id: 're-2026-10', ...o });

for (let day = 1; day <= 31; day++) {
  for (let k = 0; k < int(40, 80); k++) {
    const t = at(day, int(9, 21), int(0, 59), int(0, 59));
    const a = int(1, 60) * 100_00;
    const vpa = `cust${int(1, 600)}@okaxis`;
    const iid = `ref-${day}-${k}`;
    I({ intent_id: iid, kind: 'REFUND', max_amount_paise: a, beneficiary_vpa: vpa, not_before: ts(t - 3_600_000), expires_at: ts(t + DAY) });
    P({ timestamp: ts(t), kind: 'REFUND', amount_paise: a, beneficiary_vpa: vpa, intent_id: iid });
  }
  for (let k = 0; k < int(3, 8); k++) {
    const t = at(day, int(9, 17), int(0, 59), int(0, 59));
    const vpa = `newpayee${int(1, 50)}@okhdfc`;
    const iid = `ver-${day}-${k}`;
    I({ intent_id: iid, kind: 'VERIFICATION', max_amount_paise: 100, beneficiary_vpa: vpa, not_before: ts(t - 60_000), expires_at: ts(t + DAY) });
    P({ timestamp: ts(t), kind: 'VERIFICATION', amount_paise: 100, beneficiary_vpa: vpa, intent_id: iid });
  }
}

// Day 9, 12:00–12:45: refund mill — 60 refunds of ₹1–₹5 to ONE fresh VPA.
const mill = 'collect-mill@okfraud';
for (let k = 0; k < 60; k++) {
  const t = at(9, 12, int(0, 44), int(0, 59));
  const a = int(1, 5) * 100_00;
  I({ intent_id: `mill-${k}`, kind: 'REFUND', max_amount_paise: a, beneficiary_vpa: mill, not_before: ts(t - 3_600_000), expires_at: ts(t + DAY) });
  P({ timestamp: ts(t), kind: 'REFUND', amount_paise: a, beneficiary_vpa: mill, intent_id: `mill-${k}` });
}
// Day 25, 03:00: a batch of 25 large refunds — right shape, wrong hour.
for (let k = 0; k < 25; k++) {
  const t = at(25, 3, int(0, 10), int(0, 59));
  const a = int(80, 150) * 100_00;
  const vpa = `night${k}@okfraud`;
  I({ intent_id: `night-${k}`, kind: 'REFUND', max_amount_paise: a, beneficiary_vpa: vpa, not_before: ts(t - 3_600_000), expires_at: ts(t + DAY) });
  P({ timestamp: ts(t), kind: 'REFUND', amount_paise: a, beneficiary_vpa: vpa, intent_id: `night-${k}` });
}

writeCsvs('kits/psp/data', payouts, intents);
