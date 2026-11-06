// npm run demo:live — drive the docker compose stack (Envoy → PayRekha → fake payout API)
// the way a presenter would. Start the stack first:
//   docker compose -f deploy/docker-compose.yml up --build -d
//   npm run demo:live              pause before each step (press Enter)
//   npm run demo:live -- --auto    no pauses
// Uses the fixed demo keys from deploy/docker-compose.yml. Never point this at a real deployment.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { ed25519PrivateKeyFromSeed, hashBeneficiary, signIntent } from '../packages/core/dist/index.js';

const ENVOY = process.env.ENVOY_URL ?? 'http://localhost:10000';
const PR = process.env.PAYREKHA_URL ?? 'http://localhost:8080';
const API = 'demo-payrekha-api-key-0123';
const ADMIN = 'demo-payrekha-admin-key-0123';
const HASH_KEY = 'demo-payrekha-hash-key-0123';
const LOS = ed25519PrivateKeyFromSeed(createHash('sha256').update('payrekha-demo-los-key').digest());

const AUTO = process.argv.includes('--auto') || !process.stdin.isTTY;
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const [dim, bold, red, yellow, green, cyan] = [c(2), c(1), c(31), c(33), c(32), c(36)];
const rl = AUTO ? undefined : createInterface({ input: process.stdin, output: process.stdout });
const run = Date.now().toString(36);
const borrower = { account_number: '000123456789', ifsc: 'HDFC0001234' };
const mule = { account_number: '918273645500', ifsc: 'AXIS0000777' };
let attempted = 0;
let leaked = 0;
let n = 0;

async function step(title, say) {
  n += 1;
  console.log(`\n${bold(cyan(`${n}. ${title}`))}`);
  if (say) console.log(dim(`   ${say}`));
  if (rl) await rl.question(dim('   ↵ '));
}

async function payout({ amountPaise, beneficiary, intentId, attack, shadow, kind = 'LOAN_DISBURSAL', raw }) {
  const headers = { 'content-type': 'application/json', 'x-payout-kind': kind, 'x-client-id': 'lms-prod' };
  if (intentId) headers['x-payrekha-intent'] = intentId;
  const body = raw ?? JSON.stringify({ request_id: `${run}-${n}`, mode: 'IMPS', amount_in_paise: amountPaise, beneficiary });
  const r = await fetch(`${ENVOY}/payouts`, { method: 'POST', headers, body });
  const verdict = r.headers.get('x-payrekha-verdict');
  const rules = r.headers.get('x-payrekha-rules');
  const text = await r.text();
  const upstream = r.status === 200 ? JSON.parse(text) : undefined;
  const sent = upstream?.status === 'SENT';
  if (attack) {
    attempted += amountPaise ?? 0;
    if (sent) leaked += amountPaise ?? 0;
  }
  const v = verdict ?? upstream?.payrekha ?? '?';
  const vc = v === 'ALLOW' ? green : v === 'BLOCK' ? red : yellow;
  console.log(`   POST /payouts → ${r.status === 200 ? green('200') : red(String(r.status))}  ${sent ? (attack || shadow ? red(shadow ? 'money SENT (shadow lets it through, verdict logged)' : 'money SENT') : green('money SENT')) : green('money held')}`);
  console.log(`   PayRekha verdict ${vc(bold(v))}${rules && rules !== '-' ? `  rules: ${rules}` : ''}`);
}

async function admin(body) {
  const r = await fetch(`${PR}/v1/state`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'demo-presenter', ...body }),
  });
  if (!r.ok) throw new Error(`PUT /v1/state → ${r.status} ${await r.text()}`);
  return r.json();
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${PR}/readyz`)).ok && (await fetch(`${ENVOY}/healthz`)).status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`stack not ready at ${ENVOY} / ${PR} — run: docker compose -f deploy/docker-compose.yml up --build -d`);
}

await waitReady();
const st = await (await fetch(`${PR}/v1/state`, { headers: { authorization: `Bearer ${API}` } })).json();
if (st.alertState === 'HIGH_ALERT') await admin({ highAlert: 'reset', reason: 'demo reset' });
await admin({ mode: 'shadow', reason: 'demo start' });
console.log(bold('\nPayRekha live — Envoy guarding a payout API, no code change in the API'));
console.log(dim(`   envoy ${ENVOY} · payrekha ${PR} · run ${run}`));

await step('Shadow mode: attacker with the stolen LMS credential, no intent', 'Day 1 posture. Nothing is stopped; every would-be verdict is logged.');
await payout({ amountPaise: 4_80_000_00, beneficiary: mule, shadow: true });

await step('Security flips the gateway to enforce', 'One authenticated admin call, recorded in the audit trail.');
const s = await admin({ mode: 'enforce', reason: 'demo: go live' });
console.log(`   mode → ${bold(s.mode)}`);

await step('Same attacker, same stolen credential, ₹4,80,000 to a mule', 'The credential is valid. The intent is missing.');
await payout({ amountPaise: 4_80_000_00, beneficiary: mule, attack: true });

await step('The LOS signs a business intent for a real ₹2,40,000 loan', 'Ed25519 key held by the system of record — the attacker does not have it.');
const now = Date.now();
const intent = signIntent(
  {
    intentId: `disb-${run}`, kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, maxUses: 1,
    beneficiaryRef: hashBeneficiary({ account: borrower.account_number, ifsc: borrower.ifsc }, HASH_KEY),
    subjectRef: `loan-${run}`, issuer: 'los-demo', keyId: 'los-demo', notBeforeMs: now - 60_000, expiresAtMs: now + 3_600_000,
  },
  { alg: 'ed25519', privateKey: LOS },
);
const reg = await fetch(`${PR}/v1/intents`, { method: 'POST', headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' }, body: JSON.stringify(intent) });
console.log(`   POST /v1/intents → ${reg.status === 201 ? green('201 accepted') : red(`${reg.status} ${await reg.text()}`)}  ${dim(intent.intentId)}`);

await step('The legitimate disbursal presents that intent', 'Matching kind, amount ceiling and beneficiary: it goes through.');
await payout({ amountPaise: 2_40_000_00, beneficiary: borrower, intentId: intent.intentId, attack: false });

await step('Attacker steals the intent ID and replays it to a mule', 'Bound to one beneficiary, one use.');
await payout({ amountPaise: 2_40_000_00, beneficiary: mule, intentId: intent.intentId, attack: true });

await step('Garbage input is never a silent ALLOW', 'Unparseable amount → degraded REVIEW → held in enforce.');
await payout({ raw: JSON.stringify({ request_id: `${run}-bad`, amount_in_paise: 'lots', beneficiary: mule }), attack: true });

await step('What the SOC sees', 'Prometheus counters on :8080/metrics (also scraped by Prometheus on :9090).');
const m = await (await fetch(`${PR}/metrics`, { headers: { authorization: `Bearer ${API}` } })).text();
for (const l of m.split('\n')) if (/^payrekha_(verdicts_total|effective_actions_total|rule_hits_total)\{/.test(l)) console.log(dim(`   ${l}`));
console.log(dim('   decision log: docker compose -f deploy/docker-compose.yml exec payrekha tail -n 5 /var/lib/payrekha/decisions.jsonl'));

await admin({ mode: 'shadow', reason: 'demo end' });
console.log(`\n${bold(`Attacks attempted: ₹${(attempted / 100).toLocaleString('en-IN')}. ${leaked === 0 ? green('₹0 left the building.') : red(`₹${(leaked / 100).toLocaleString('en-IN')} left the building.`)}`)}`);
console.log(dim('   gateway set back to shadow mode'));
rl?.close();
process.exitCode = leaked === 0 ? 0 : 1;
