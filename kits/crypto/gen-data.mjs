#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// VDA-exchange kit data: withdrawals signed by two issuers — the trading
// engine (ops) and the risk desk (approver) — exercising ADR 0003 m-of-n.
// Day 12 plants a withdrawal that cites only the ops intent (insufficient
// approvals → BLOCK in enforce, flagged in the report).
import { makeGen, writeCsvs } from '../lib/gen.mjs';

const { int, ts, at } = makeGen(20261023);
const payouts = [];
const intents = [];
let pid = 0;
const P = (o) => payouts.push({ payout_id: `po-${String(++pid).padStart(6, '0')}`, channel: 'CRYPTO', source_key_id: 'withdrawal-api', origin: 'prod', merchant_id: '', intent_id: '', approval_ids: '', event: '', ...o });
const I = (o) => intents.push({ max_uses: 1, subject_ref: '', issuer: 'trading-engine', key_id: 'te-2026-10', ...o });
const A = (o) => intents.push({ max_uses: 1, subject_ref: '', issuer: 'risk-desk', key_id: 'rd-2026-10', kind: 'VDA_WITHDRAWAL', ...o });

const users = Array.from({ length: 60 }, (_, i) => `0x${(0xabc000 + i).toString(16)}f4c3`);
let wd = 0;
for (let day = 1; day <= 31; day++) {
  for (let k = 0; k < int(15, 35); k++) {
    const t = at(day, int(9, 22), int(0, 59), int(0, 59));
    const a = int(2, 80) * 1_00_000_00;
    const addr = users[int(0, users.length - 1)];
    const id = ++wd;
    I({ intent_id: `wd-${id}`, kind: 'VDA_WITHDRAWAL', max_amount_paise: a, beneficiary_ref: addr, subject_ref: `req-${id}`, not_before: ts(t - 1_800_000), expires_at: ts(t + 43_200_000) });
    A({ intent_id: `wd-${id}-appr`, beneficiary_ref: addr, subject_ref: `req-${id}`, max_amount_paise: a, not_before: ts(t - 1_800_000), expires_at: ts(t + 43_200_000) });
    P({ timestamp: ts(t), kind: 'VDA_WITHDRAWAL', amount_paise: a, beneficiary_ref: addr, intent_id: `wd-${id}`, approval_ids: `wd-${id}-appr` });
  }
}

// Day 12, 14:30: withdrawal cites ONLY the ops intent — no risk-desk
// approval. requiredApprovals(VDA_WITHDRAWAL, 2) should flag it.
{
  const t = at(12, 14, 30);
  const a = 95_00_000_00;
  const addr = '0xdeadbeefc0ffee';
  I({ intent_id: 'wd-rogue', kind: 'VDA_WITHDRAWAL', max_amount_paise: a, beneficiary_ref: addr, subject_ref: 'req-rogue', not_before: ts(t - 1_800_000), expires_at: ts(t + 43_200_000) });
  P({ timestamp: ts(t), kind: 'VDA_WITHDRAWAL', amount_paise: a, beneficiary_ref: addr, intent_id: 'wd-rogue', approval_ids: '' });
}
// Day 19: ops key reused to sign its own "approval" — same issuer, must
// NOT satisfy the second-approval requirement.
{
  const t = at(19, 11, 15);
  const a = 60_00_000_00;
  const addr = '0xselfapprovec0ffee';
  I({ intent_id: 'wd-self', kind: 'VDA_WITHDRAWAL', max_amount_paise: a, beneficiary_ref: addr, subject_ref: 'req-self', not_before: ts(t - 1_800_000), expires_at: ts(t + 43_200_000) });
  I({ intent_id: 'wd-self-appr', kind: 'VDA_WITHDRAWAL', max_amount_paise: a, beneficiary_ref: addr, subject_ref: 'req-self', not_before: ts(t - 1_800_000), expires_at: ts(t + 43_200_000) });
  P({ timestamp: ts(t), kind: 'VDA_WITHDRAWAL', amount_paise: a, beneficiary_ref: addr, intent_id: 'wd-self', approval_ids: 'wd-self-appr' });
}

writeCsvs('kits/crypto/data', payouts, intents);
