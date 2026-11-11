// Post-install smoke check for a running PayRekha gateway. Proves the
// deployment is live, in the expected mode, evaluating, non-blocking,
// and that a canary trip actually raises HIGH_ALERT end-to-end.
//
//   node scripts/verify-deploy.mjs --url http://localhost:8080 \
//     --api-key $PAYREKHA_EVALUATE_KEY --read-key $PAYREKHA_READ_KEY \
//     --admin-key $PAYREKHA_ADMIN_KEY --expect-mode shadow
//
// Exit 0 = all checks pass. Nothing here can affect payouts — the script
// only registers a canary, sends synthetic payouts, and resets the alert.
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = flag('--url', process.env.PAYREKHA_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const API = flag('--api-key', process.env.PAYREKHA_EVALUATE_KEY ?? '');
const READ = flag('--read-key', process.env.PAYREKHA_READ_KEY ?? API);
const ADMIN = flag('--admin-key', process.env.PAYREKHA_ADMIN_KEY ?? '');
const EXPECT_MODE = flag('--expect-mode', 'shadow');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const call = async (path, { method = 'GET', key = API, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('json')) return { status: res.status, json: await res.json(), text: '' };
  return { status: res.status, json: null, text: await res.text() };
};

// A beneficiary ref that can only ever be a trap — a payout to it is by
// definition suspicious.
const canaryRef = `h:v1:${createHash('sha256').update('payrekha-verify-canary').digest('hex').slice(0, 24)}`;
const payout = (over = {}) => ({
  payoutId: `verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  kind: 'LOAN_DISBURSAL',
  amountPaise: 5000,
  channel: 'IMPS',
  ...over,
});

console.log(`PayRekha deploy check → ${BASE}  (expecting mode=${EXPECT_MODE})\n`);

const health = await call('/healthz', { key: '' });
check('healthz', health.status === 200 && health.json?.ok === true, `status ${health.status}`);

const ready = await call('/readyz', { key: '' });
check('readyz', ready.status === 200, `status ${ready.status}${ready.json?.reason ? ` (${ready.json.reason})` : ''}`);

const state = await call('/v1/state', { key: READ });
check('read-role state read', state.status === 200, `status ${state.status}`);
if (state.status === 200) {
  check('mode', state.json.mode === EXPECT_MODE, `mode=${state.json.mode}`);
  check('alert baseline', state.json.alertState !== 'HIGH_ALERT', 'HIGH_ALERT before canary trip — investigate first');
}

const verdict = await call('/v1/evaluate', { method: 'POST', body: payout() });
check(
  'evaluate responds',
  verdict.status === 200 && typeof verdict.json?.verdict === 'string',
  `status ${verdict.status} verdict=${verdict.json?.verdict}`,
);
if (EXPECT_MODE === 'shadow' && verdict.status === 200) {
  check(
    'shadow is non-blocking',
    verdict.json.effectiveAction === 'ALLOW',
    `effectiveAction=${verdict.json.effectiveAction} (verdict=${verdict.json.verdict} logged only)`,
  );
}

const metrics = await call('/metrics', { key: READ });
check('metrics endpoint', metrics.status === 200 && metrics.text.includes('payrekha_evaluations_total'), `status ${metrics.status}`);

// Canary end-to-end: register, trip it, confirm HIGH_ALERT, reset.
const reg = await call('/v1/canaries', {
  method: 'POST',
  key: ADMIN,
  body: { beneficiaryRefs: [canaryRef], actor: 'verify-deploy', reason: 'post-install smoke check' },
});
check('canary registration', reg.status === 201, `status ${reg.status}`);

if (reg.status === 201) {
  const trip = await call('/v1/evaluate', { method: 'POST', body: payout({ beneficiaryRef: canaryRef }) });
  const tripped = Array.isArray(trip.json?.hits) && trip.json.hits.some((h) => h.rule === 'canary.tripped');
  check('canary trips on payout', tripped, `verdict=${trip.json?.verdict}`);

  const after = await call('/v1/state', { key: READ });
  check('HIGH_ALERT raised', after.json?.alertState === 'HIGH_ALERT', `alertState=${after.json?.alertState}`);

  const reset = await call('/v1/state', {
    method: 'PUT',
    key: ADMIN,
    body: { highAlert: 'reset', actor: 'verify-deploy', reason: 'smoke check cleanup' },
  });
  check('alert reset (audited)', reset.status === 200 && reset.json?.alertState === 'NORMAL', `status ${reset.status}`);
}

console.log(failures === 0 ? '\nAll checks passed — PayRekha is live and watching.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
