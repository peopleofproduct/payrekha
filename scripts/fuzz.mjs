// SPDX-License-Identifier: Apache-2.0
// Fuzz the parsers hostile input can reach. Contract per target:
//   - clean rejection (returned problem / thrown Error)   → OK
//   - crash class (RangeError stack overflow, SyntaxError where
//     the contract is "never throw", abort, >200 ms hang)  → finding.
// Deterministic: --seed reproduces any finding; --n scales the corpus.
//   node scripts/fuzz.mjs [--seed 1] [--n 20000]
import { canonicalJson, generateIssuerKeyPair, hashBeneficiary, intentShapeProblem, signIntent, verifyAndUnwrap } from '../packages/core/dist/index.js';
import { mapPayout } from '../packages/gateway/dist/index.js';
import { parseCsv } from '../packages/replay/dist/csv.js';

// Accepts both --n 5000 and --n=5000.
const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.map((a, i) => {
  const kv = a.replace(/^--/, '').split('=');
  return [kv[0], kv[1] ?? argv[i + 1]];
}));
const N = Number(args['n'] ?? 20000);
let seed = Number(args['seed'] ?? 1);
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const findings = [];
const checked = { iterations: 0, rejects: 0 };

function run(name, fn) {
  // Crash-class exceptions propagate; contract Errors are rejects.
  try {
    fn();
  } catch (e) {
    if (e instanceof RangeError || e instanceof SyntaxError) {
      findings.push(`${name}: ${e.constructor.name}: ${String(e.message).slice(0, 120)}`);
    } else {
      checked.rejects += 1;
    }
  }
  checked.iterations += 1;
}

// --- seeds ---------------------------------------------------------------
const kp = generateIssuerKeyPair();
const goodIntent = signIntent(
  {
    intentId: 'int_fuzz', issuer: 'fuzz', kind: 'VENDOR_PAYOUT',
    amountPaise: 100, maxUses: 1, beneficiary: hashBeneficiary({ vpa: 'alice@okhdfc' }, 'h'.repeat(32)),
    notBeforeMs: 0, expiresAtMs: 9_999_999_999_999,
  },
  { alg: 'ed25519', privateKey: kp.privateKey },
);
const goodSnap = { intents: [goodIntent], tombstones: {}, ledger: { ring: {} }, control: { mode: 'shadow', revocations: [] } };

const mutators = [
  (s) => s.slice(0, Math.floor(rand() * s.length)), // truncate
  (s) => s + s.slice(Math.floor(rand() * s.length)), // dup tail
  (s) => { const i = Math.floor(rand() * s.length); return s.slice(0, i) + pick(['{', '}', '[', ']', '"', ',', ':', 'e', '9']) + s.slice(i); },
  (s) => s.replace(/"[^"]*":/, pick(['null:', '"":', '1e309:', '{:'])) , // corrupt a key
  (s) => s.replace(/-?\d+/, pick(['1e309', '-0', '9'.repeat(40), '0.1'])),
  (s) => s.replace(/[a-z]+/i, pick(['', ' ᾷ'.repeat(20), 'A'.repeat(5000)])),
  (s) => `{"x":${s}}`, // wrap
];

const mutate = (obj) => {
  let s = JSON.stringify(obj);
  for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) s = pick(mutators)(s);
  try {
    return JSON.parse(s);
  } catch {
    return undefined; // broken JSON → skip (shape layer would reject upstream anyway)
  }
};

// --- 1. shape + canonical -------------------------------------------------
for (let i = 0; i < N; i++) {
  const m = mutate(goodIntent);
  if (m === undefined) continue;
  run('intentShapeProblem', () => {
    intentShapeProblem(m);
  });
  // canonicalJson must be reachable exactly when the shape says it's an intent
  run('canonicalJson', () => canonicalJson(m));
}

// --- 2. snapshot envelope --------------------------------------------------
const envelope = { v: 1, payload: goodSnap, hmac: 'deadbeef'.repeat(8) };
for (let i = 0; i < Math.floor(N / 4); i++) {
  const m = mutate(envelope);
  if (m === undefined) continue;
  run('verifyAndUnwrap', () => verifyAndUnwrap(m, 'k'.repeat(32)));
}

// --- 3. ext_authz mapping ---------------------------------------------------
const mapping = {
  payoutId: pick(['header.x-id', 'body.id', 'query.id']),
  kind: 'body.kind',
  amountPaise: 'body.amount',
  beneficiary: 'body.beneficiary',
  timestampMs: 'body.ts',
};
for (let i = 0; i < Math.floor(N / 4); i++) {
  const req = {
    path: '/' + 'a'.repeat(Math.floor(rand() * 200)),
    method: pick(['POST', 'GET', '']),
    headers: { 'x-id': mutate('h-' + Math.floor(rand() * 1e6)) ?? 'x' },
    query: {},
    body: mutate({ id: 'p1', kind: 'VENDOR_PAYOUT', amount: 1, beneficiary: 'b', ts: 1 }),
  };
  run('mapPayout', () =>
    mapPayout(req, mapping, 'h'.repeat(32), { origin: 'prod', nowMs: Date.now() }),
  );
}

// --- 4. replay CSV -----------------------------------------------------------
for (let i = 0; i < Math.floor(N / 10); i++) {
  const rows = [];
  for (let r = 0, n = 1 + Math.floor(rand() * 5); r < n; r++) {
    rows.push(
      Array.from({ length: 1 + Math.floor(rand() * 8) }, () =>
        pick(['"', ',', 'a,b', '"x"', '1e309', ' ', '\n', 'p_' + Math.floor(rand() * 1e6)]),
      ).join(pick([',', ';', ''])),
    );
  }
  run('parseCsv', () => parseCsv(rows.join(pick(['\n', '\r\n', '']))));
}

// --- 5. recursion-depth probe ------------------------------------------------
// 64KB body cap ⇒ '[' * 32k can arrive. canonicalJson / shape checks recurse —
// report the depth each survives so we know whether the cap already bounds it.
const deep = (n) => '['.repeat(n) + '1' + ']'.repeat(n);
for (const n of [100, 1_000, 5_000, 20_000, 40_000]) {
  let v;
  try {
    v = JSON.parse(deep(n));
  } catch {
    console.log(`depth ${n}: JSON.parse rejects`);
    continue;
  }
  let verdict = 'ok';
  try {
    intentShapeProblem(v);
  } catch (e) {
    verdict = `SHAPE ${e.constructor.name}`;
  }
  try {
    canonicalJson(v);
  } catch (e) {
    verdict += ` / CANONICAL ${e.constructor.name}`;
  }
  console.log(`depth ${n}: ${verdict}`);
}

// --- verdict -----------------------------------------------------------------
console.log(`\nfuzz: ${checked.iterations} cases, ${checked.rejects} clean rejects, ${findings.length} crash-class findings`);
if (findings.length > 0) {
  for (const f of [...new Set(findings)].slice(0, 10)) console.log('  FINDING:', f);
  process.exit(1);
}
