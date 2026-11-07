#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 — People of Product™
//
// Synthetic load check — answers the two questions only volume settles:
//   1. What is evaluate() p50/p99/max at realistic state sizes?
//   2. How long does the snapshot save stall the event loop? B3 sliced
//      serialization off the hot path — the residual stall is exportState()
//      alone; the probe measures the worst loop gap during serialize.
//
//   node scripts/load-check.mjs --beneficiaries 50000 --intents 20000 --seconds 15
//   Flags: --merchants N --seconds N --json. Numbers are for THIS host;
//   re-run on production-class hardware before setting enforce thresholds.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { clearImmediate, setImmediate } from 'node:timers';
import { ed25519PrivateKeyFromSeed, exportPublicKey, hashBeneficiary, Payrekha, serializeSnapshot, signIntent } from '../packages/core/dist/index.js';
import { payrekhaRules } from '../packages/rules/dist/index.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
};
const BENS = arg('beneficiaries', 50_000);
const MERCHANTS = arg('merchants', 5_000);
const INTENTS = arg('intents', 20_000);
const SECONDS = arg('seconds', 15);
const JSON_OUT = process.argv.includes('--json');

const HK = 'load-check-hash-key-0123456789ab';
const T0 = Date.now();
const LOS = ed25519PrivateKeyFromSeed(createHash('sha256').update('load-check-los').digest());
const PUB = exportPublicKey(LOS);

const fw = new Payrekha(payrekhaRules({ band: false }).rules, {
  config: { mode: 'enforce' },
  keys: [{ keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519', publicKey: PUB, kinds: ['LOAN_DISBURSAL', 'VENDOR_PAYOUT', 'REFUND'] }],
  hashKey: undefined,
  now: () => Date.now(),
});

const log = (...a) => !JSON_OUT && console.error(...a);
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

// ---- Phase A: seed realistic state ----------------------------------------
log(`seeding: ${INTENTS} intents, ${BENS} beneficiaries, ${MERCHANTS} merchants…`);
const tSeed = performance.now();
const benRefs = new Array(BENS);
for (let i = 0; i < BENS; i++) benRefs[i] = hashBeneficiary({ vpa: `user${i}@okbank` }, HK);
for (let i = 0; i < INTENTS; i++) {
  const kind = i % 3 === 0 ? 'LOAN_DISBURSAL' : i % 3 === 1 ? 'VENDOR_PAYOUT' : 'REFUND';
  fw.registerIntent(
    signIntent(
      { intentId: `seed-${i}`, kind, maxAmountPaise: 5_000_000_00, beneficiaryRef: benRefs[i % BENS], maxUses: 3, notBeforeMs: T0 - 1_000, expiresAtMs: T0 + 3_600_000, issuer: 'los-prod', keyId: 'los-1' },
      { alg: 'ed25519', privateKey: LOS },
    ),
  );
}
// Warm ledgers/dedupe with one payout per beneficiary so the measured phase
// runs against a full state, not an empty one.
for (let i = 0; i < BENS; i++) {
  fw.evaluate({
    payoutId: `warm-${i}`,
    kind: 'VENDOR_PAYOUT',
    amountPaise: 100_00 + (i % 500) * 1_00,
    beneficiaryRef: benRefs[i],
    channel: 'IMPS',
    sourceKeyId: 'load-gen',
    origin: 'prod',
    merchantId: `merch-${i % MERCHANTS}`,
    timestampMs: Date.now(),
  });
}
log(`seeded in ${((performance.now() - tSeed) / 1000).toFixed(1)}s — intents ${fw.metrics.intents}, beneficiaries ${fw.metrics.beneficiaries}`);
const heapAfterSeed = process.memoryUsage().heapUsed;

// ---- Phase B: measured evaluation ------------------------------------------
const lat = new Float64Array(SECONDS * 4000);
const hits = new Map();
let n = 0;
const tEnd = performance.now() + SECONDS * 1000;
let i = 0;
while (performance.now() < tEnd) {
  const kind = i % 3 === 0 ? 'LOAN_DISBURSAL' : i % 3 === 1 ? 'VENDOR_PAYOUT' : 'REFUND';
  const p = {
    payoutId: `run-${i}`,
    kind,
    amountPaise: 50_000_00 + (i % 97) * 10_000_00,
    beneficiaryRef: benRefs[i % BENS],
    channel: 'IMPS',
    sourceKeyId: 'load-gen',
    origin: 'prod',
    merchantId: `merch-${i % MERCHANTS}`,
    // Every third payout cites an intent — exercises verify+reserve; the
    // rest hit missing/reused paths. Realistic mix, not best case.
    ...(i % 3 === 0 ? { intentId: `seed-${i % INTENTS}` } : {}),
    timestampMs: Date.now(),
  };
  const t0 = performance.now();
  const v = fw.evaluate(p);
  lat[n++] = (performance.now() - t0) * 1000; // µs
  for (const h of v.hits) hits.set(h.rule, (hits.get(h.rule) ?? 0) + 1);
  i++;
}
const used = lat.subarray(0, n).sort();
const rps = Math.round(n / SECONDS);

// ---- Phase C: snapshot serialization stall ---------------------------------
// B3 split: exportState() is the residual SYNC cost (the consistency anchor —
// it must see one instant's state). serializeSnapshot signs + serializes in
// paced slices off the event loop, so wall time ≠ stall. We measure the max
// event-loop gap during serialization — the number that hits eval p99.
const stalls = [];
let bytes = 0;
for (let k = 0; k < 3; k++) {
  const t0 = performance.now();
  const snap = fw.exportState();
  const t1 = performance.now();
  let maxGap = 0;
  let last = performance.now();
  const probe = setImmediate(function tick() {
    const t = performance.now();
    if (t - last > maxGap) maxGap = t - last;
    last = t;
    setImmediate(tick);
  });
  const body = await serializeSnapshot(snap, 'load-check-state-key-0123456789abcdef');
  clearImmediate(probe);
  const t2 = performance.now();
  bytes = body.length;
  stalls.push({ exportMs: t1 - t0, serializeMs: t2 - t1, maxLoopGapMs: maxGap });
}
const stall = stalls[1]; // median of 3
const heapEnd = process.memoryUsage().heapUsed;

const report = {
  state: { intents: fw.metrics.intents, beneficiaries: fw.metrics.beneficiaries, merchants: MERCHANTS },
  evaluate: {
    samples: n,
    rps,
    p50_us: Math.round(pct(used, 0.5)),
    p95_us: Math.round(pct(used, 0.95)),
    p99_us: Math.round(pct(used, 0.99)),
    max_us: Math.round(used[used.length - 1]),
    hits: Object.fromEntries([...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
  },
  snapshot: {
    bytes,
    exportMs: +stall.exportMs.toFixed(1),
    serializeMs: +stall.serializeMs.toFixed(1),
    maxLoopGapMs: +stall.maxLoopGapMs.toFixed(2),
    stallPctOf5sCycle: +((stall.exportMs / 5000) * 100).toFixed(2),
  },
  memory: { heapAfterSeedMB: +(heapAfterSeed / 1048576).toFixed(1), heapAfterRunMB: +(heapEnd / 1048576).toFixed(1) },
  verdict: {
    evalP99ok: pct(used, 0.99) < 5_000 ? 'ok (<5ms)' : 'WATCH: p99 >5ms',
    snapshotStall: stall.exportMs < 250 ? 'ok — export is the only sync pause; serialization is sliced' : 'INVESTIGATE: exportState() alone exceeds the bound — shard or reduce state',
  },
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nevaluate: ${n} calls @ ~${rps} rps   p50 ${report.evaluate.p50_us}µs  p95 ${report.evaluate.p95_us}µs  p99 ${report.evaluate.p99_us}µs  max ${report.evaluate.max_us}µs`);
  console.log(`snapshot: ${(bytes / 1048576).toFixed(1)} MB   export ${stall.exportMs.toFixed(1)}ms (sync stall) + serialize ${stall.serializeMs.toFixed(1)}ms (sliced; worst loop gap ${stall.maxLoopGapMs.toFixed(1)}ms)`);
  console.log(`heap:     ${report.memory.heapAfterSeedMB} MB after seed → ${report.memory.heapAfterRunMB} MB after run`);
  console.log(`top hits: ${Object.entries(report.evaluate.hits).map(([k, v]) => `${k}×${v}`).join('  ') || 'none'}`);
  console.log(`\nverdict:  eval p99 — ${report.verdict.evalP99ok}`);
  console.log(`          snapshot — ${report.verdict.snapshotStall}`);
}
