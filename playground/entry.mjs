// Browser entry for the PayRekha playground — bundles the real engine +
// rule set. Demo issuer uses the engine's hmac-sha256 support because
// browsers have no synchronous Ed25519 in node:crypto shape; production
// deployments sign intents with Ed25519 (see docs/intents.md).
// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { formatIst, hashBeneficiary, istToEpochMs, Payrekha, signIntent } from '../packages/core/dist/index.js';
import { payrekhaRules, rupees } from '../packages/rules/dist/index.js';

const HK = 'playground-hash-key-0123456789abcdef';
const ADMIN = 'playground-admin-token-0123456789';
const SECRET = 'playground-demo-issuer-secret-0123456789abcdef';
const KINDS = ['LOAN_DISBURSAL', 'PA_SETTLEMENT', 'VENDOR_PAYOUT', 'REFUND', 'CRYPTO_WITHDRAWAL', 'VERIFICATION'];
const T = (d, h, m, s = 0) => istToEpochMs(2026, 11, d, h, m, s);
export const ref = (vpa) => hashBeneficiary({ vpa }, HK);
export const toRupees = rupees;

let fw = null;
let modeNow = 'enforce';
let seq = 0;

export function fresh(mode = modeNow) {
  modeNow = mode;
  seq = 0;
  const set = payrekhaRules({ band: false });
  fw = new Payrekha(set.rules, {
    config: {
      mode,
      adminTokenSha256: createHash('sha256').update(ADMIN).digest('hex'),
      requireIntent: { VENDOR_PAYOUT: false, PA_SETTLEMENT: false, REFUND: false },
      calendar: {
        holidays: [
          { date: '2026-11-08', name: 'Diwali (Lakshmi Puja)' },
          { date: '2026-11-09', name: 'Diwali (Govardhan Puja)' },
        ],
        lowCoverageHours: null,
      },
      highAlertOnBlocks: { count: 0, windowMs: 1 },
    },
    keys: [{ keyId: 'demo-los', issuer: 'los-demo', alg: 'hmac-sha256', secret: SECRET, kinds: KINDS }],
    now: () => T(4, 10, 0),
  });
  fw.addCanaries(
    { beneficiaryRefs: [ref('apk-canary-7f3@okbank')] },
    { actor: 'playground', reason: 'canary planted in APK', adminToken: ADMIN },
  );
  return fw;
}

export function intent(o) {
  const i = signIntent(
    { maxUses: 1, issuer: 'los-demo', keyId: 'demo-los', notBeforeMs: T(4, 0, 0), expiresAtMs: T(9, 0, 0), ...o },
    { alg: 'hmac-sha256', secret: SECRET },
  );
  fw.registerIntent(i, T(4, 10, 0));
  return i;
}

export function pay(o) {
  return fw.evaluate({ payoutId: `pg-${++seq}`, channel: 'IMPS', sourceKeyId: 'lms-prod', origin: 'prod', kind: 'LOAN_DISBURSAL', ...o });
}

/** The CRAFTY FALCON chain — same 8 attack steps as `npm run demo`. */
export function attackChain(mode = 'enforce') {
  fresh(mode);
  const borrower = ref('ramesh.k@okhdfc');
  const mule = ref('quickcash77@okaxis');
  const steps = [];
  const step = (title, attack, v, amountPaise, at) =>
    steps.push({
      title,
      attack,
      verdict: v.verdict,
      effectiveAction: v.effectiveAction,
      alertState: v.alertState,
      micros: Math.round(v.elapsedMicros),
      hits: v.hits.map((h) => ({ rule: h.rule, reason: h.reason })),
      amountPaise,
      at,
    });

  const vi = intent({ intentId: 'ver-42', kind: 'VERIFICATION', maxAmountPaise: 100, beneficiaryRef: borrower, subjectRef: 'loan-42' });
  step(
    'Penny-drop verifies the borrower account (VERIFICATION intent)',
    false,
    pay({ kind: 'VERIFICATION', intentId: vi.intentId, amountPaise: 100, beneficiaryRef: borrower, timestampMs: T(4, 10, 2) }),
    100,
    T(4, 10, 2),
  );
  const li = intent({
    intentId: 'disb-42',
    kind: 'LOAN_DISBURSAL',
    maxAmountPaise: 2_40_000_00,
    beneficiaryRef: borrower,
    subjectRef: 'loan-42',
  });
  step(
    '₹2,40,000 loan disbursal with a signed LOS intent',
    false,
    pay({ intentId: li.intentId, amountPaise: 2_40_000_00, beneficiaryRef: borrower, timestampMs: T(4, 10, 5) }),
    2_40_000_00,
    T(4, 10, 5),
  );
  step(
    'Attacker calls the payout API with stolen LMS credentials — no intent',
    true,
    pay({ amountPaise: 4_80_000_00, beneficiaryRef: mule, timestampMs: T(6, 2, 11) }),
    4_80_000_00,
    T(6, 2, 11),
  );
  const li2 = intent({
    intentId: 'disb-43',
    kind: 'LOAN_DISBURSAL',
    maxAmountPaise: 3_10_000_00,
    beneficiaryRef: ref('sunita.m@oksbi'),
    subjectRef: 'loan-43',
  });
  step(
    'Attacker replays a real intent (disb-43) to a mule account',
    true,
    pay({ intentId: li2.intentId, amountPaise: 3_10_000_00, beneficiaryRef: mule, timestampMs: T(6, 2, 14) }),
    3_10_000_00,
    T(6, 2, 14),
  );
  const fresh1 = ref('fresh.acct91@okicici');
  step(
    '₹1 probe to a new account (vendor payout rail)',
    true,
    pay({ kind: 'VENDOR_PAYOUT', amountPaise: 100, beneficiaryRef: fresh1, timestampMs: T(6, 2, 20) }),
    100,
    T(6, 2, 20),
  );
  step(
    '…then ₹4,99,999 to the same account',
    true,
    pay({ kind: 'VENDOR_PAYOUT', amountPaise: 4_99_999_00, beneficiaryRef: fresh1, timestampMs: T(6, 2, 24) }),
    4_99_999_00,
    T(6, 2, 24),
  );
  step(
    'Same call from a UAT key that can still reach prod',
    true,
    pay({
      kind: 'VENDOR_PAYOUT',
      sourceKeyId: 'uat_lms',
      origin: 'nonprod',
      amountPaise: 4_99_999_00,
      beneficiaryRef: fresh1,
      timestampMs: T(6, 2, 27),
    }),
    4_99_999_00,
    T(6, 2, 27),
  );
  fw.merchants.observe('m-kirana-881', ref('kirana881@okhdfc'), T(1, 12, 0));
  fw.noteMerchantAccountChange('m-kirana-881', mule, T(6, 2, 30));
  step(
    'Settlement account changed 5 min ago — ₹38 lakh merchant settlement',
    true,
    pay({ kind: 'PA_SETTLEMENT', merchantId: 'm-kirana-881', amountPaise: 38_00_000_00, beneficiaryRef: mule, timestampMs: T(6, 2, 35) }),
    38_00_000_00,
    T(6, 2, 35),
  );
  let burst;
  for (let k = 0; k < 11; k++)
    burst = pay({ kind: 'REFUND', amountPaise: 9_000_00, beneficiaryRef: ref(`refund${k}@okaxis`), timestampMs: T(8, 1, 0, k * 20) });
  step('Diwali: calendar flips to HOLIDAY, velocity budget halves — refund burst', true, burst, 11 * 9_000_00, T(8, 1, 3, 20));
  step(
    'Attacker pays a canary beneficiary planted in the APK',
    true,
    pay({ kind: 'REFUND', amountPaise: 2_500_00, beneficiaryRef: ref('apk-canary-7f3@okbank'), timestampMs: T(8, 1, 10) }),
    2_500_00,
    T(8, 1, 10),
  );
  step(
    'HIGH_ALERT: the next unbound payout blocks instantly',
    true,
    pay({ kind: 'REFUND', amountPaise: 1_200_00, beneficiaryRef: ref('other.mule@okaxis'), timestampMs: T(8, 1, 11) }),
    1_200_00,
    T(8, 1, 11),
  );

  const attacks = steps.filter((s) => s.attack && !s.title.startsWith('₹1 probe'));
  const leaked = attacks.filter((s) => s.effectiveAction === 'ALLOW').reduce((a, s) => a + s.amountPaise, 0);
  const wouldStop = attacks.filter((s) => s.verdict !== 'ALLOW');
  return {
    mode,
    steps,
    attacks: attacks.length,
    leaked,
    wouldStopCount: wouldStop.length,
    wouldStopPaise: wouldStop.reduce((a, s) => a + s.amountPaise, 0),
  };
}

/** Evaluate a caller-built payout; `beneficiary` may be {vpa}|{account,ifsc}|{address,network} or a raw hb1_ ref. */
export function evaluateCustom(payout, beneficiary) {
  if (!fw) fresh();
  const p = { ...payout };
  p.beneficiaryRef = typeof beneficiary === 'string' && beneficiary.startsWith('hb1_') ? beneficiary : hashBeneficiary(beneficiary, HK);
  p.payoutId = p.payoutId ?? `custom-${++seq}`;
  p.timestampMs = p.timestampMs ?? Date.now();
  return fw.evaluate(p);
}

export function getState() {
  if (!fw) fresh();
  const m = fw.metrics;
  return {
    mode: modeNow,
    alertState: fw.alertState,
    highAlert: fw.highAlertInfo,
    canaries: fw.canaries.size,
    intents: m.intents,
    beneficiaries: m.beneficiaries,
    evaluations: m.evaluated,
    verdicts: m.verdicts,
  };
}
export { formatIst };
fresh();
