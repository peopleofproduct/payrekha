// Synthetic month (Oct 2026) of NBFC payouts with three planted attack chains.
// Deterministic: same output every run. All names and VPAs are fake.
//   npm run gen:data  →  examples/data/{payouts,intents}.csv
import { writeFileSync } from 'node:fs';

let s = 20261007;
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

const payouts = [];
const intents = [];
let pid = 0;
const P = (o) => payouts.push({ payout_id: `po-${String(++pid).padStart(6, '0')}`, channel: 'IMPS', source_key_id: 'lms-prod', origin: 'prod', merchant_id: '', intent_id: '', event: '', ...o });
const I = (o) => intents.push({ max_uses: 1, subject_ref: '', ...o });

const vendors = Array.from({ length: 30 }, (_, i) => `vendor${i}@okhdfc`);
const merchants = Array.from({ length: 15 }, (_, i) => ({ id: `m-${100 + i}`, vpa: `merchant${100 + i}@okicici` }));
let loan = 0;

for (let day = 1; day <= 31; day++) {
  const holiday = day === 20; // keep the month realistic: one quiet day
  const n = holiday ? 8 : int(30, 45);
  for (let k = 0; k < n; k++) {
    const id = ++loan;
    const vpa = `borrower${id}@oksbi`;
    const verifyAt = at(day, int(9, 17), int(0, 59), int(0, 59));
    // Most disbursals land 1–3 days after the penny-drop; about one in ten the same day.
    const sameDay = rnd() < 0.1;
    const disbAt = verifyAt + (sameDay ? int(20, 180) * 60_000 : int(26, 72) * 3_600_000);
    const amount = int(50, 500) * 1_000_00;
    I({ intent_id: `ver-${id}`, kind: 'VERIFICATION', max_amount_paise: 100, beneficiary_vpa: vpa, subject_ref: `loan-${id}`, not_before: ts(verifyAt - 60_000), expires_at: ts(verifyAt + DAY) });
    P({ timestamp: ts(verifyAt), kind: 'VERIFICATION', amount_paise: 100, beneficiary_vpa: vpa, intent_id: `ver-${id}` });
    I({ intent_id: `disb-${id}`, kind: 'LOAN_DISBURSAL', max_amount_paise: amount, beneficiary_vpa: vpa, subject_ref: `loan-${id}`, not_before: ts(disbAt - 3_600_000), expires_at: ts(disbAt + 2 * DAY) });
    P({ timestamp: ts(disbAt), kind: 'LOAN_DISBURSAL', amount_paise: amount, beneficiary_vpa: vpa, intent_id: `disb-${id}` });
  }
  for (let k = 0; k < int(10, 20); k++) {
    const t = at(day, int(9, 20), int(0, 59), int(0, 59));
    const vpa = `customer${int(1, 400)}@okaxis`;
    const a = int(5, 50) * 100_00;
    const iid = `ref-${day}-${k}`;
    I({ intent_id: iid, kind: 'REFUND', max_amount_paise: a, beneficiary_vpa: vpa, not_before: ts(t - 3_600_000), expires_at: ts(t + DAY) });
    P({ timestamp: ts(t), kind: 'REFUND', amount_paise: a, beneficiary_vpa: vpa, intent_id: iid, source_key_id: 'refunds-svc' });
  }
  if (day % 7 === 1) for (const [i, v] of vendors.entries()) {
    const t = at(day, 11, i, 0);
    const a = int(20, 200) * 1_000_00;
    I({ intent_id: `ven-${day}-${i}`, kind: 'VENDOR_PAYOUT', max_amount_paise: a, beneficiary_vpa: v, not_before: ts(t - 3_600_000), expires_at: ts(t + DAY) });
    P({ timestamp: ts(t), kind: 'VENDOR_PAYOUT', amount_paise: a, beneficiary_vpa: v, intent_id: `ven-${day}-${i}`, source_key_id: 'ap-erp', channel: 'NEFT' });
  }
  for (const m of merchants) {
    const t = at(day, 18, int(0, 59), int(0, 59));
    const a = int(1, 30) * 1_00_000_00;
    const iid = `set-${day}-${m.id}`;
    I({ intent_id: iid, kind: 'PA_SETTLEMENT', max_amount_paise: a, beneficiary_vpa: m.vpa, not_before: ts(t - 3_600_000), expires_at: ts(t + DAY) });
    P({ timestamp: ts(t), kind: 'PA_SETTLEMENT', amount_paise: a, beneficiary_vpa: m.vpa, merchant_id: m.id, intent_id: iid, source_key_id: 'settlement-svc', channel: 'RTGS' });
  }
}

// Chain 1 — 12 Oct, 02:10 IST: stolen LMS credentials. ₹1 probes to three mules, then ₹4,99,999 each, no intents.
for (let k = 0; k < 3; k++) {
  const mule = `quickcash${k}@okaxis`;
  P({ timestamp: ts(at(12, 2, 10 + k * 7)), kind: 'LOAN_DISBURSAL', amount_paise: 100, beneficiary_vpa: mule });
  P({ timestamp: ts(at(12, 2, 13 + k * 7)), kind: 'LOAN_DISBURSAL', amount_paise: 4_99_999_00, beneficiary_vpa: mule });
}
// Chain 2 — 19 Oct, 23:40 IST: a UAT key that can still reach the prod payout API.
for (let k = 0; k < 4; k++) P({ timestamp: ts(at(19, 23, 40 + k * 3)), kind: 'VENDOR_PAYOUT', amount_paise: int(2, 9) * 1_00_000_00, beneficiary_vpa: `uat.sink${k}@okicici`, source_key_id: 'uat-lms', origin: 'nonprod' });
// Chain 3 — 26 Oct: merchant m-107's settlement account is switched, then a ₹38 lakh settlement and a burst of refunds.
P({ timestamp: ts(at(26, 17, 55)), event: 'account_changed', kind: '', amount_paise: '', merchant_id: 'm-107', beneficiary_vpa: 'new.settle107@okaxis' });
P({ timestamp: ts(at(26, 18, 1)), kind: 'PA_SETTLEMENT', amount_paise: 38_00_000_00, beneficiary_vpa: 'new.settle107@okaxis', merchant_id: 'm-107', source_key_id: 'settlement-svc', channel: 'RTGS' });
for (let k = 0; k < 14; k++) P({ timestamp: ts(at(26, 18, 5, k * 25)), kind: 'REFUND', amount_paise: 49_000_00, beneficiary_vpa: `refund.mule${k}@okaxis`, source_key_id: 'settlement-svc' });

payouts.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n';
writeFileSync('examples/data/payouts.csv', csv(payouts, ['payout_id', 'timestamp', 'kind', 'amount_paise', 'beneficiary_vpa', 'channel', 'source_key_id', 'origin', 'merchant_id', 'intent_id', 'event']));
writeFileSync('examples/data/intents.csv', csv(intents, ['intent_id', 'kind', 'max_amount_paise', 'beneficiary_vpa', 'subject_ref', 'max_uses', 'not_before', 'expires_at']));
console.error(`wrote ${payouts.length} payouts and ${intents.length} intents to examples/data/`);
