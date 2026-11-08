// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
// Shared deterministic month-generator for the segment kits. Same PRNG and
// CSV shape as tools/generate-synthetic-data.mjs; each kit supplies shapes.
import { writeFileSync } from 'node:fs';

export function makeGen(seed) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pad = (n) => String(n).padStart(2, '0');
  const IST = 19_800_000;
  const ts = (ms) => {
    const d = new Date(ms + IST);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };
  const at = (day, h, m, sec = 0) => Date.UTC(2026, 9, day, h, m, sec) - IST;
  const DAY = 86_400_000;
  return { rnd, int, ts, at, DAY };
}

// beneficiary_vpa holds VPA-shaped refs; beneficiary_ref holds hb1_/opaque
// refs (crypto addresses — replay maps them to {address, network:'opaque'}).
const COLS = 'payout_id,timestamp,kind,amount_paise,beneficiary_vpa,beneficiary_ref,channel,source_key_id,origin,merchant_id,intent_id,approval_ids,event';
const ICOLS = 'intent_id,kind,max_amount_paise,beneficiary_vpa,beneficiary_ref,subject_ref,max_uses,not_before,expires_at,issuer,key_id';

export function writeCsvs(dir, payouts, intents) {
  const esc = (v) => (v === undefined || v === null ? '' : String(v).includes(',') ? `"${v}"` : String(v));
  writeFileSync(
    `${dir}/payouts.csv`,
    COLS + '\n' + payouts.map((p) => [p.payout_id, p.timestamp, p.kind, p.amount_paise, p.beneficiary_vpa, p.beneficiary_ref, p.channel, p.source_key_id, p.origin, p.merchant_id, p.intent_id, p.approval_ids, p.event].map(esc).join(',')).join('\n') + '\n',
  );
  writeFileSync(
    `${dir}/intents.csv`,
    ICOLS + '\n' + intents.map((i) => [i.intent_id, i.kind, i.max_amount_paise, i.beneficiary_vpa, i.beneficiary_ref, i.subject_ref, i.max_uses, i.not_before, i.expires_at, i.issuer, i.key_id].map(esc).join(',')).join('\n') + '\n',
  );
  console.log(`${dir}: ${payouts.length} payouts, ${intents.length} intents`);
}
