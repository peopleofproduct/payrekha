// npm run demo — the CRAFTY FALCON chain against a fake NBFC.
//   npm run demo -- --shadow   same run in shadow mode
//   npm run demo -- --json     one JSON line per step
import { createHash } from 'node:crypto';
import { ed25519PrivateKeyFromSeed, exportPublicKey, formatIst, hashBeneficiary, istToEpochMs, Payrekha, signIntent } from '../packages/core/dist/index.js';
import { payrekhaRules, rupees } from '../packages/rules/dist/index.js';

const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');
const tty = process.stdout.isTTY && !JSON_OUT && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const [dim, bold, red, yellow, green, cyan] = [c(2), c(1), c(31), c(33), c(32), c(36)];
const VCOL = { ALLOW: green, REVIEW: yellow, BLOCK: red };

const HK = 'demo-hash-key-0123456789abcdef';
const ADMIN = 'demo-admin-token-0123456789';
const seed = createHash('sha256').update('payrekha-demo-los-key').digest();
const LOS = ed25519PrivateKeyFromSeed(seed);
const ref = (vpa) => hashBeneficiary({ vpa }, HK);
const T = (d, h, m, s = 0) => istToEpochMs(2026, 11, d, h, m, s);

function run(mode) {
  const set = payrekhaRules({ band: false });
  const fw = new Payrekha(set.rules, {
    config: {
      mode,
      adminTokenSha256: createHash('sha256').update(ADMIN).digest('hex'),
      requireIntent: { VENDOR_PAYOUT: false, PA_SETTLEMENT: false, REFUND: false },
      calendar: { holidays: [{ date: '2026-11-08', name: 'Diwali (Lakshmi Puja)' }], lowCoverageHours: null },
      highAlertOnBlocks: { count: 0, windowMs: 1 },
    },
    keys: [{ keyId: 'los-2026-11', issuer: 'los-prod', alg: 'ed25519', publicKey: exportPublicKey(LOS), kinds: ['LOAN_DISBURSAL', 'VERIFICATION'] }],
    now: () => T(4, 10, 0),
  });
  fw.addCanaries({ beneficiaryRefs: [ref('apk-canary-7f3@okbank')] }, { actor: 'soc', reason: 'canary planted in APK', adminToken: ADMIN });
  let n = 0;
  const intent = (o) => {
    const i = signIntent({ maxUses: 1, issuer: 'los-prod', keyId: 'los-2026-11', notBeforeMs: T(4, 0, 0), expiresAtMs: T(9, 0, 0), ...o }, { alg: 'ed25519', privateKey: LOS });
    fw.registerIntent(i, T(4, 10, 0));
    return i;
  };
  const pay = (o) => fw.evaluate({ payoutId: `po-${++n}`, channel: 'IMPS', sourceKeyId: 'lms-prod', origin: 'prod', kind: 'LOAN_DISBURSAL', ...o });

  const borrower = ref('ramesh.k@okhdfc');
  const mule = ref('quickcash77@okaxis');
  const steps = [];
  const step = (title, attack, v, amountPaise, at) => steps.push({ title, attack, v, amountPaise, at });

  // 1. Normal day
  const vi = intent({ intentId: 'ver-42', kind: 'VERIFICATION', maxAmountPaise: 100, beneficiaryRef: borrower, subjectRef: 'loan-42' });
  step('Penny-drop verifies the borrower account (VERIFICATION intent)', false, pay({ kind: 'VERIFICATION', intentId: vi.intentId, amountPaise: 100, beneficiaryRef: borrower, timestampMs: T(4, 10, 2) }), 100, T(4, 10, 2));
  const li = intent({ intentId: 'disb-42', kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: borrower, subjectRef: 'loan-42' });
  step('₹2,40,000 loan disbursal with a signed LOS intent', false, pay({ intentId: li.intentId, amountPaise: 2_40_000_00, beneficiaryRef: borrower, timestampMs: T(4, 10, 5) }), 2_40_000_00, T(4, 10, 5));
  // 2. Stolen credentials, no intent
  step('Attacker calls the payout API with stolen LMS credentials, no intent', true, pay({ amountPaise: 4_80_000_00, beneficiaryRef: mule, timestampMs: T(6, 2, 11) }), 4_80_000_00, T(6, 2, 11));
  // 3. Replay a real intent to a different account
  const li2 = intent({ intentId: 'disb-43', kind: 'LOAN_DISBURSAL', maxAmountPaise: 3_10_000_00, beneficiaryRef: ref('sunita.m@oksbi'), subjectRef: 'loan-43' });
  step('Attacker replays a real intent (disb-43) to a mule account', true, pay({ intentId: li2.intentId, amountPaise: 3_10_000_00, beneficiaryRef: mule, timestampMs: T(6, 2, 14) }), 3_10_000_00, T(6, 2, 14));
  // 4. Probe
  const newAcct = ref('fresh.acct91@okicici');
  step('₹1 probe to a new account (vendor payout rail)', true, pay({ kind: 'VENDOR_PAYOUT', amountPaise: 100, beneficiaryRef: newAcct, timestampMs: T(6, 2, 20) }), 100, T(6, 2, 20));
  step('…then ₹4,99,999 to the same account', true, pay({ kind: 'VENDOR_PAYOUT', amountPaise: 4_99_999_00, beneficiaryRef: newAcct, timestampMs: T(6, 2, 24) }), 4_99_999_00, T(6, 2, 24));
  // 5. UAT key
  step('Same call from a UAT key that can still reach prod', true, pay({ kind: 'VENDOR_PAYOUT', sourceKeyId: 'uat_lms', origin: 'nonprod', amountPaise: 4_99_999_00, beneficiaryRef: newAcct, timestampMs: T(6, 2, 27) }), 4_99_999_00, T(6, 2, 27));
  // 6. Settlement account changed
  fw.merchants.observe('m-kirana-881', ref('kirana881@okhdfc'), T(1, 12, 0));
  fw.noteMerchantAccountChange('m-kirana-881', mule, T(6, 2, 30));
  step('PA merchant settlement account changed 5 min ago, ₹38 lakh settlement', true, pay({ kind: 'PA_SETTLEMENT', merchantId: 'm-kirana-881', amountPaise: 38_00_000_00, beneficiaryRef: mule, timestampMs: T(6, 2, 35) }), 38_00_000_00, T(6, 2, 35));
  // 7. Diwali burst
  let burst;
  for (let k = 0; k < 11; k++) burst = pay({ kind: 'REFUND', amountPaise: 9_000_00, beneficiaryRef: ref(`refund${k}@okaxis`), timestampMs: T(8, 1, 0, k * 20) });
  step('Diwali: calendar flips to HOLIDAY, velocity budget halves — refund burst', true, burst, 11 * 9_000_00, T(8, 1, 3, 20));
  // 8. Canary
  step('Attacker pays to a canary beneficiary planted in the APK', true, pay({ kind: 'REFUND', amountPaise: 2_500_00, beneficiaryRef: ref('apk-canary-7f3@okbank'), timestampMs: T(8, 1, 10) }), 2_500_00, T(8, 1, 10));
  step('HIGH_ALERT: next unbound payout blocks instantly', true, pay({ kind: 'REFUND', amountPaise: 1_200_00, beneficiaryRef: ref('other.mule@okaxis'), timestampMs: T(8, 1, 11) }), 1_200_00, T(8, 1, 11));
  return { fw, steps };
}

function print(mode) {
  const { fw, steps } = run(mode);
  if (JSON_OUT) {
    for (const s of steps) console.log(JSON.stringify({ mode, step: s.title, attack: s.attack, at: formatIst(s.at), verdict: s.v.verdict, effectiveAction: s.v.effectiveAction, rules: s.v.hits.map((h) => h.rule), alertState: s.v.alertState, elapsedMicros: Math.round(s.v.elapsedMicros) }));
    return { fw, steps };
  }
  console.log(bold(`\nPayrekha — CRAFTY FALCON replay against a fake NBFC  ${dim(`(mode: ${mode})`)}\n`));
  for (const s of steps) {
    const v = s.v;
    console.log(`${dim(formatIst(s.at))}  ${s.attack ? red('▲') : green('●')} ${s.title}`);
    console.log(`    ${VCOL[v.verdict](bold(v.verdict.padEnd(6)))} → ${v.effectiveAction.padEnd(7)} ${dim(`${Math.round(v.elapsedMicros)} µs`)}${v.alertState !== 'NORMAL' ? '  ' + cyan(v.alertState) : ''}`);
    for (const h of v.hits) console.log(`    ${dim(h.rule.padEnd(28))} ${h.reason}`);
  }
  return { fw, steps };
}

const mode = args.has('--shadow') ? 'shadow' : 'enforce';
const { steps } = print(mode);
const attacks = steps.filter((s) => s.attack && !s.title.startsWith('₹1 probe'));
const leaked = attacks.filter((s) => s.v.effectiveAction === 'ALLOW').reduce((a, s) => a + s.amountPaise, 0);
if (!JSON_OUT) {
  console.log('');
  if (mode === 'enforce') {
    console.log(bold(`${attacks.length} attack steps. ${leaked === 0 ? green('₹0 left the building.') : red(`${rupees(leaked)} left the building.`)}`));
    const shadow = run('shadow').steps.filter((s) => s.attack && !s.title.startsWith('₹1 probe'));
    const would = shadow.filter((s) => s.v.verdict !== 'ALLOW');
    console.log(dim(`Shadow mode, same run: every payout allowed, ${would.length} of ${shadow.length} attack steps logged as would-stop (${rupees(would.reduce((a, s) => a + s.amountPaise, 0))}).`));
  } else {
    const would = attacks.filter((s) => s.v.verdict !== 'ALLOW');
    console.log(bold(`Shadow mode: nothing was stopped. ${would.length} of ${attacks.length} attack steps would have been (${rupees(would.reduce((a, s) => a + s.amountPaise, 0))}).`));
  }
}
