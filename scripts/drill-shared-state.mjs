#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 — People of Product™
//
// Drill D2 — ADR 0004 active-active rehearsal. Three gateway replicas on ONE
// shared backend, exercised over real HTTP:
//
//   node scripts/drill-shared-state.mjs                       # in-memory backend
//   PAYREKHA_SHARED_PG_URL=postgres://… node scripts/drill-shared-state.mjs
//
// Scenarios: concurrent intent spend (exactly one wins), payoutId storm
// (one stored verdict), store outage (fail closed + readyz + recovery),
// cross-replica revocation, and cross-replica outcome release.
// Exit 0 = every invariant held. Requires `npm run build` first.
import { createHash } from 'node:crypto';
import { generateIssuerKeyPair, hashBeneficiary, MemorySharedBackend, Payrekha, signIntent } from '../packages/core/dist/index.js';
import { createGateway } from '../packages/gateway/dist/index.js';
import { payrekhaRules } from '../packages/rules/dist/index.js';

const PG_URL = process.env['PAYREKHA_SHARED_PG_URL'];
const T0 = Date.now();
const LOS = generateIssuerKeyPair();
const LOS2 = generateIssuerKeyPair();
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ADMIN = 'drill-admin-0123456789abcdef';
const API = 'drill-api-0123456789abcdef';
const API2 = 'drill-api2-0123456789abcde'; // zero-history key for S5 (velocity is per-key)
const REG = 'drill-reg-0123456789abcdef';
const HK = 'drill-hash-key-0123456789abcdef';
const benRef = hashBeneficiary({ account: '000123456789', ifsc: 'HDFC0001234' }, HK);
const benRef2 = hashBeneficiary({ account: '000999888777', ifsc: 'ICIC0009876' }, HK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (cond, what) => {
  if (!cond) {
    failed += 1;
    console.log(`    FAIL: ${what}`);
  }
};
const section = (s) => console.log(`\n▶ ${s}`);

/** Fault-injecting wrapper — 'down' makes every call throw, on any backend. */
const toggle = (inner) => {
  const t = { down: false, describe: inner.describe };
  for (const m of [
    'putIntent',
    'getIntent',
    'commit',
    'intentState',
    'releaseReservation',
    'settleReservation',
    'readControl',
    'writeControl',
    'close',
  ]) {
    if (typeof inner[m] === 'function') t[m] = (...a) => (t.down ? Promise.reject(new Error('backend down (drill)')) : inner[m](...a));
  }
  return t;
};

let inner = new MemorySharedBackend();
if (PG_URL !== undefined) {
  const { PostgresSharedBackend } = await import('../packages/store-postgres/dist/index.js').catch(() => {
    console.error('PAYREKHA_SHARED_PG_URL set but @payrekha/store-postgres is not installed');
    process.exit(1);
  });
  inner = new PostgresSharedBackend({ connectionString: PG_URL, tablePrefix: `drill${Date.now()}`.toLowerCase() });
}
const backend = toggle(inner);
console.log(`backend: ${backend.describe}`);

const replica = (pollMs) => {
  const fw = new Payrekha(payrekhaRules({ band: false }).rules, {
    config: { mode: 'enforce', adminTokenSha256: sha(ADMIN) },
    keys: [
      { keyId: 'los-1', issuer: 'los', alg: 'ed25519', publicKey: LOS.publicKey, kinds: ['LOAN_DISBURSAL'] },
      { keyId: 'los-2', issuer: 'los', alg: 'ed25519', publicKey: LOS2.publicKey, kinds: ['LOAN_DISBURSAL'] },
    ],
    now: () => T0,
  });
  return createGateway({
    firewall: fw,
    apiKeys: [
      { id: 'lms', sha256: sha(API), origin: 'prod' },
      { id: 'lms2', sha256: sha(API2), origin: 'prod' },
      { id: 'reg', sha256: sha(REG), origin: 'prod', roles: ['intents'] },
    ],
    adminKeySha256: sha(ADMIN),
    sharedState: { backend, controlPollMs: pollMs },
    now: () => T0,
  });
};

const A = replica(3_600_000);
const B = replica(3_600_000);
const C = replica(150); // fast poll for the outage scenario
const gws = [A, B, C];
const listen = async (gw) => {
  await new Promise((r) => gw.server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${gw.server.address().port}`;
};
const url = { A: await listen(A), B: await listen(B), C: await listen(C) };

const intent = (id, key = 'los-1', priv = LOS.privateKey, ref = benRef, maxUses = 1) =>
  signIntent(
    {
      intentId: id,
      kind: 'LOAN_DISBURSAL',
      maxAmountPaise: 100_000_00,
      beneficiaryRef: ref,
      maxUses,
      notBeforeMs: T0 - 60_000,
      expiresAtMs: T0 + 3_600_000,
      issuer: 'los',
      keyId: key,
    },
    { alg: 'ed25519', privateKey: priv },
  );
const post = (side, path, body, tok = API) =>
  fetch(url[side] + path, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const evalOn = (side, payoutId, intentId, ref = benRef, tok = API) =>
  post(
    side,
    '/v1/evaluate',
    { payoutId, kind: 'LOAN_DISBURSAL', intentId, amountPaise: 100_000_00, beneficiaryRef: ref, channel: 'IMPS' },
    tok,
  ).then((r) => r.json());
const readyz = (side) => fetch(url[side] + '/readyz').then((r) => r.status);
const register = (side, i) => post(side, '/v1/intents', i, REG).then((r) => r.status);

// ---------------------------------------------------------------- S1 race
section('S1: 5 concurrent evaluations on one maxUses=1 intent — exactly one commits');
await register('A', intent('d2-race'));
const race = await Promise.all([
  evalOn('A', 'd2-r1', 'd2-race'),
  evalOn('A', 'd2-r2', 'd2-race'),
  evalOn('B', 'd2-r3', 'd2-race'),
  evalOn('B', 'd2-r4', 'd2-race'),
  evalOn('B', 'd2-r5', 'd2-race'),
]);
const allows = race.filter((v) => v.verdict === 'ALLOW').length;
check(allows === 1, `expected exactly 1 ALLOW across replicas, got ${allows} (${JSON.stringify(race.map((v) => v.verdict))})`);
console.log(`    verdicts: ${race.map((v) => v.verdict).join(', ')}`);

// ------------------------------------------------------- S2 payoutId storm
section('S2: same payoutId on both replicas — one decision, everyone replays it');
await register('A', intent('d2-dup'));
const dups = await Promise.all([
  evalOn('A', 'd2-dup', 'd2-dup'),
  evalOn('B', 'd2-dup', 'd2-dup'),
  evalOn('B', 'd2-dup', 'd2-dup'),
  evalOn('A', 'd2-dup', 'd2-dup'),
]);
const ids = new Set(dups.map((v) => v.decisionId));
check(
  dups.every((v) => v.verdict === 'ALLOW'),
  `every retry must get the stored ALLOW, got ${JSON.stringify(dups.map((v) => v.verdict))}`,
);
check(ids.size === 1, `one decisionId expected, got ${ids.size}`);

// ---------------------------------------------------------------- S3 outage
section('S3: store outage mid-traffic — fail closed, readyz drops, poll recovers');
await register('C', intent('d2-out'));
backend.down = true;
const down = await evalOn('C', 'd2-down', 'd2-out');
check(
  down.effectiveAction === 'DECLINE' && down.verdict === 'BLOCK',
  `enforce must DECLINE while the store is down, got ${JSON.stringify(down)}`,
);
check(
  down.hits.some((h) => h.rule === 'store.commit-failed'),
  'expected store.commit-failed evidence',
);
await sleep(400);
check((await readyz('C')) === 503, 'replica must report not-ready while the store is down');
backend.down = false;
await sleep(600);
check((await readyz('C')) === 200, 'replica must recover readiness when the store returns');
const back = await evalOn('C', 'd2-back', 'd2-out');
check(back.verdict === 'ALLOW', `payout must succeed after recovery, got ${back.verdict}`);

// ---------------------------------------------------- S4 revocation across
section('S4: revoke los-1 on A — B refuses the next cite in the same commit');
await register('A', intent('d2-rev'));
await register('A', intent('d2-rev2')); // registered while valid — the cite below is the in-flight case
const alive = await evalOn('B', 'd2-rev1', 'd2-rev');
check(alive.verdict === 'ALLOW', 'precondition: intent valid on B before revocation');
const del = await fetch(url.A + '/v1/issuers/los-1', {
  method: 'DELETE',
  headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ actor: 'soc', reason: 'key leaked (drill)' }),
});
check(del.status === 200, `revoke call returned ${del.status}`);
const dead = await evalOn('B', 'd2-rev2', 'd2-rev2');
check(
  dead.verdict === 'BLOCK' && dead.hits.some((h) => h.rule === 'intent.bad-signature'),
  `revoked key must block via commit gen check, got ${JSON.stringify(dead.hits.map((h) => h.rule))}`,
);

// ------------------------------------------------------ S5 outcome release
section('S5: outcome reported on B frees the use committed on A');
await register('A', intent('d2-rel', 'los-2', LOS2.privateKey, benRef2));
const first = await evalOn('A', 'd2-rel1', 'd2-rel', benRef2);
check(first.verdict === 'ALLOW', 'precondition: A commits the first use');
const out = await post('B', '/v1/outcomes', { payoutId: 'd2-rel1', outcome: 'failed' }).then((r) => r.json());
check(out.known === true, `B must see the shared reservation, got ${JSON.stringify(out)}`);
const reuse = await evalOn('B', 'd2-rel2', 'd2-rel', benRef2, API2);
check(
  reuse.verdict === 'ALLOW',
  `the released use must be spendable on B, got ${reuse.verdict} ${JSON.stringify(reuse.hits.map((h) => h.rule))}`,
);

for (const gw of gws) {
  gw.server.close();
  await gw.closeShared();
}
console.log(
  failed === 0 ? '\nDrill D2 PASSED — every active-active invariant held.' : `\nDrill D2 FAILED — ${failed} invariant(s) broken.`,
);
process.exit(failed === 0 ? 0 : 1);
