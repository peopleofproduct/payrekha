// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// npm run bench   (builds first)
// In-process: per-call latency of PayRekha.evaluate() with the full v0.1 rule
// chain over many beneficiaries and intents. Gateway: sequential HTTP calls to
// POST /v1/evaluate on loopback. Single-threaded latency, not throughput.
//
// Flags: --payouts=N --beneficiaries=N --warmup=N --http=N --budget-us=N (exit 1 if in-process p99 exceeds)
import { createHash } from 'node:crypto';
import { generateIssuerKeyPair, hashBeneficiary, Payrekha, signIntent } from '../packages/core/dist/index.js';
import { createGateway } from '../packages/gateway/dist/index.js';
import { payrekhaRules } from '../packages/rules/dist/index.js';

const arg = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d);
const N = arg('payouts', 200_000);
const B = arg('beneficiaries', 20_000);
const WARM = arg('warmup', 20_000);
const HTTP = arg('http', 2_000);
const BUDGET = arg('budget-us', 1_000);

let seed = 0x9e3779b9;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const HK = 'bench-hash-key-0123456789abcdef';
const T0 = Date.UTC(2026, 10, 4, 4, 30);
const los = generateIssuerKeyPair();
const fw = new Payrekha(payrekhaRules().rules, {
  config: { mode: 'enforce', highAlertOnBlocks: { count: 0, windowMs: 1 }, ledgerCapacity: 100_000, dedupeCapacity: 10_000 },
  keys: [{ keyId: 'los', issuer: 'los', alg: 'ed25519', publicKey: los.publicKey, kinds: ['LOAN_DISBURSAL'] }],
});
const refs = Array.from({ length: B }, (_, i) => hashBeneficiary({ vpa: `bench${i}@okbank` }, HK));
const total = N + WARM;
const intents = Math.min(total, 50_000);
for (let i = 0; i < intents; i++)
  fw.registerIntent(
    signIntent({ intentId: `i-${i}`, kind: 'LOAN_DISBURSAL', maxAmountPaise: 5_00_000_00, beneficiaryRef: refs[i % B], maxUses: 1, notBeforeMs: T0 - 1, expiresAtMs: T0 + 86_400_000 * 30, issuer: 'los', keyId: 'los' }, { alg: 'ed25519', privateKey: los.privateKey }),
    T0,
  );
const p = { payoutId: '', kind: 'LOAN_DISBURSAL', amountPaise: 0, beneficiaryRef: '', intentId: '', channel: 'IMPS', sourceKeyId: 'lms', origin: 'prod', timestampMs: T0 };
const lat = new Float64Array(N);
for (let i = 0; i < total; i++) {
  p.payoutId = `po-${i}`;
  p.amountPaise = 1_000_00 + Math.floor(rand() * 4_00_000_00);
  p.beneficiaryRef = refs[Math.floor(rand() * B)];
  p.intentId = rand() < 0.8 ? `i-${i % intents}` : '';
  p.timestampMs = T0 + i * 50;
  const req = p.intentId === '' ? { ...p, intentId: undefined } : p;
  const t = performance.now();
  fw.evaluate(req);
  const d = (performance.now() - t) * 1000;
  if (i >= WARM) lat[i - WARM] = d;
}
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
lat.sort();
const r = { p50: pct(lat, 0.5), p99: pct(lat, 0.99), p999: pct(lat, 0.999), max: lat[lat.length - 1] };
console.log(`in-process  ${N} payouts, ${B} beneficiaries, ${intents} intents, Node ${process.version}`);
console.log(`  p50 ${r.p50.toFixed(1)} µs   p99 ${r.p99.toFixed(1)} µs   p99.9 ${r.p999.toFixed(1)} µs   max ${r.max.toFixed(0)} µs`);

if (HTTP > 0) {
  const token = 'bench-api-token-0123456789';
  const gw = createGateway({ firewall: fw, apiKeys: [{ id: 'lms', origin: 'prod', sha256: createHash('sha256').update(token).digest('hex') }] });
  await new Promise((res) => gw.server.listen(0, '127.0.0.1', res));
  const url = `http://127.0.0.1:${gw.server.address().port}/v1/evaluate`;
  const h = new Float64Array(HTTP);
  for (let i = 0; i < HTTP + 200; i++) {
    const body = JSON.stringify({ payoutId: `h-${i}`, kind: 'REFUND', amountPaise: 1_000_00, beneficiaryRef: refs[i % B], channel: 'IMPS' });
    const t = performance.now();
    await (await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body })).arrayBuffer();
    if (i >= 200) h[i - 200] = performance.now() - t;
  }
  gw.server.close();
  h.sort();
  console.log(`gateway     ${HTTP} sequential HTTP calls on loopback (client + server in one process)`);
  console.log(`  p50 ${pct(h, 0.5).toFixed(2)} ms   p99 ${pct(h, 0.99).toFixed(2)} ms   max ${h[h.length - 1].toFixed(2)} ms`);
}
if (r.p99 > BUDGET) {
  console.error(`p99 ${r.p99.toFixed(1)} µs exceeds budget ${BUDGET} µs`);
  process.exit(1);
}
