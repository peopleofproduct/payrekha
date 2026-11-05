// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  AuthorizationError,
  canonicalJson,
  Engine,
  FileStateStore,
  formatIst,
  generateIssuerKeyPair,
  hashBeneficiary,
  intentSigningPayload,
  istParts,
  istToEpochMs,
  Keyring,
  looksLikeRawIdentifier,
  LruMap,
  normalizeMobile,
  Payrekha,
  signIntent,
  TimeRing,
  Verdict,
  type PayoutRequest,
  type Rule,
  type UnsignedIntent,
} from '@payrekha/core';

const KEY = 'core-test-hash-key-0123456789';
const T0 = Date.UTC(2026, 10, 4, 5, 30);

describe('canonicalJson', () => {
  it('sorts keys, drops undefined, rejects floats', () => {
    assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined }), '{"a":[true,null,"x"],"b":1}');
    assert.throws(() => canonicalJson({ a: 1.5 }));
    assert.throws(() => canonicalJson({ a: 2 ** 60 }));
  });
});

describe('hashBeneficiary', () => {
  it('is keyed, stable and normalises', () => {
    const a = hashBeneficiary({ vpa: 'Alice@OkBank' }, KEY);
    assert.equal(a, hashBeneficiary({ vpa: 'alice@okbank' }, KEY));
    assert.notEqual(a, hashBeneficiary({ vpa: 'alice@okbank' }, KEY + 'x'));
    assert.match(a, /^hb1_[A-Za-z0-9_-]{43}$/);
    assert.equal(hashBeneficiary({ mobile: '+91 98765 43210' }, KEY), hashBeneficiary({ mobile: '9876543210' }, KEY));
    assert.equal(normalizeMobile('09876543210'), '9876543210');
    assert.throws(() => hashBeneficiary({ vpa: 'aa@okbank' }, 'short'));
  });
  it('flags raw identifiers', () => {
    for (const raw of ['alice@okbank', '9876543210', '123456789012', 'HDFC0001234:1234567890']) assert.equal(looksLikeRawIdentifier(raw), true, raw);
    assert.equal(looksLikeRawIdentifier(hashBeneficiary({ vpa: 'aa@okbank' }, KEY)), false);
  });
});

const unsigned = (o: Partial<UnsignedIntent> = {}): UnsignedIntent => ({
  intentId: 'i-1',
  kind: 'LOAN_DISBURSAL',
  maxAmountPaise: 1_00_000_00,
  beneficiaryRef: hashBeneficiary({ vpa: 'aa@okbank' }, KEY),
  maxUses: 1,
  notBeforeMs: T0 - 1000,
  expiresAtMs: T0 + 60_000,
  issuer: 'los-prod',
  keyId: 'k1',
  ...o,
});

describe('intents', () => {
  it('Ed25519 round-trip, tamper, wrong issuer, kind scope, rotation, revoke', () => {
    const kp = generateIssuerKeyPair();
    const ring = new Keyring([{ keyId: 'k1', issuer: 'los-prod', alg: 'ed25519', publicKey: kp.publicKey, kinds: ['LOAN_DISBURSAL'], notAfterMs: T0 + 1000 }]);
    const i = signIntent(unsigned(), { alg: 'ed25519', privateKey: kp.privateKey });
    assert.deepEqual(ring.verify(i, T0), { ok: true });
    assert.deepEqual(ring.verify({ ...i, maxAmountPaise: i.maxAmountPaise + 1 }, T0), { ok: false, reason: 'bad-signature' });
    assert.deepEqual(ring.verify({ ...i, issuer: 'evil' }, T0), { ok: false, reason: 'issuer-mismatch' });
    assert.deepEqual(ring.verify(signIntent(unsigned({ kind: 'REFUND' }), { alg: 'ed25519', privateKey: kp.privateKey }), T0), { ok: false, reason: 'kind-not-allowed' });
    assert.deepEqual(ring.verify(i, T0 + 2000), { ok: false, reason: 'key-expired' });
    const g = ring.generation;
    ring.revoke('k1');
    assert.ok(ring.generation > g);
    assert.deepEqual(ring.verify(i, T0), { ok: false, reason: 'key-revoked' });
  });
  it('HMAC round-trip and short-secret refusal', () => {
    const secret = 's'.repeat(32);
    const ring = new Keyring([{ keyId: 'k1', issuer: 'los-prod', alg: 'hmac-sha256', secret, kinds: ['LOAN_DISBURSAL'] }]);
    const i = signIntent(unsigned(), { alg: 'hmac-sha256', secret });
    assert.deepEqual(ring.verify(i, T0), { ok: true });
    assert.deepEqual(ring.verify({ ...i, beneficiaryRef: hashBeneficiary({ vpa: 'xx@okbank' }, KEY) }, T0), { ok: false, reason: 'bad-signature' });
    assert.throws(() => ring.add({ keyId: 'k2', issuer: 'x', alg: 'hmac-sha256', secret: 'short', kinds: [] }));
  });
  it('signing payload is domain-separated canonical JSON without the signature', () => {
    const p = intentSigningPayload({ ...unsigned(), signature: 'zzz' } as never).toString();
    assert.ok(p.startsWith('payrekha-intent-v1\n{"beneficiaryRef":'));
    assert.ok(!p.includes('zzz'));
  });
  it('matches the shared cross-language vector', () => {
    const vec = JSON.parse(readFileSync(new URL('../../../clients/vectors/intent-v1.json', import.meta.url), 'utf8')) as {
      intent: UnsignedIntent;
      payload: string;
      hmacSecret: string;
      hmacSignature: string;
      ed25519PublicKey: string;
      ed25519Signature: string;
    };
    assert.equal(intentSigningPayload(vec.intent).toString(), vec.payload);
    assert.equal(signIntent(vec.intent, { alg: 'hmac-sha256', secret: vec.hmacSecret }).signature, vec.hmacSignature);
    const ring = new Keyring([{ keyId: vec.intent.keyId, issuer: vec.intent.issuer, alg: 'ed25519', publicKey: vec.ed25519PublicKey, kinds: [vec.intent.kind] }]);
    assert.deepEqual(ring.verify({ ...vec.intent, signature: vec.ed25519Signature }, vec.intent.notBeforeMs), { ok: true });
  });
});

describe('Engine (Krediwall semantics)', () => {
  type R = { n: number };
  const rule = (name: string, f: (r: R) => Verdict | null | 'throw'): Rule<R, null> => ({
    name,
    evaluate(r) {
      const v = f(r);
      if (v === 'throw') throw new Error('boom');
      return v === null ? null : { rule: name, verdict: v, reason: name, evidence: {} };
    },
  });
  const validate = (r: R) => (typeof r?.n === 'number' ? null : 'n');
  it('malformed input → degraded REVIEW, no rules run', () => {
    let ran = false;
    const e = new Engine<R, null>([rule('a', () => ((ran = true), null))], { validate });
    const ev = e.evaluate({} as R, null);
    assert.equal(ev.verdict, 'REVIEW');
    assert.equal(ev.degraded, true);
    assert.equal(ran, false);
  });
  it('folds to worst, first BLOCK short-circuits, rule errors are isolated', () => {
    let after = false;
    const errs: string[] = [];
    const e = new Engine<R, null>(
      [rule('err', () => 'throw'), rule('rev', () => 'REVIEW'), rule('blk', () => 'BLOCK'), rule('after', () => ((after = true), null))],
      { validate, onRuleError: (n) => errs.push(n) },
    );
    const ev = e.evaluate({ n: 1 }, null);
    assert.equal(ev.verdict, 'BLOCK');
    assert.deepEqual(ev.hits.map((h) => h.rule), ['rev', 'blk']);
    assert.deepEqual(ev.ruleErrors.map((r) => r.rule), ['err']);
    assert.equal(ev.degraded, true);
    assert.equal(after, false);
    assert.deepEqual(errs, ['err']);
    assert.ok(ev.elapsedMicros >= 0);
  });
  it('hot-swaps rules and carries state across same-named rules', () => {
    let restored: unknown = null;
    const mk = (): Rule<R, null> => ({ name: 's', evaluate: () => null, exportState: () => ({ x: 1 }), restoreState: (s) => void (restored = s) });
    const e = new Engine<R, null>([mk()], { validate });
    e.replaceRules([mk()]);
    assert.deepEqual(restored, { x: 1 });
  });
});

describe('LruMap / TimeRing / IST', () => {
  it('LRU evicts least recent', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.get('a');
    m.set('c', 3);
    assert.equal(m.has('b'), false);
    assert.equal(m.evictedCount, 1);
    assert.deepEqual([...m.entriesLeastRecentFirst()].map(([k]) => k), ['a', 'c']);
  });
  it('TimeRing windows and stays bounded', () => {
    const r = new TimeRing(3);
    for (let k = 1; k <= 5; k++) r.push(k * 1000, k);
    assert.equal(r.length, 3);
    assert.deepEqual(r.window(3500, 5000), { count: 2, sum: 9 });
    assert.deepEqual(TimeRing.from(3, r.toJSON()).window(0, 9999), { count: 3, sum: 12 });
  });
  it('IST conversions', () => {
    const t = istToEpochMs(2026, 11, 8, 0, 30);
    assert.equal(t, Date.UTC(2026, 10, 7, 19, 0));
    assert.equal(istParts(t).date, '2026-11-08');
    assert.equal(istParts(t).dayOfWeek, 0);
    assert.match(formatIst(t), /^2026-11-08 00:30/);
  });
});

const adminToken = 'tok-tok-tok';
const sha = createHash('sha256').update(adminToken).digest('hex');
const blockAll: Rule<PayoutRequest, never> = { name: 'x', evaluate: (p) => ({ rule: 'x', verdict: 'BLOCK', reason: 'x', evidence: { kind: p.kind } }) };
const po = (o: Partial<PayoutRequest> = {}): PayoutRequest => ({
  payoutId: `p-${Math.random()}`,
  kind: 'REFUND',
  amountPaise: 100,
  beneficiaryRef: hashBeneficiary({ vpa: 'aa@okbank' }, KEY),
  channel: 'UPI',
  sourceKeyId: 'k',
  origin: 'prod',
  timestampMs: T0,
  ...o,
});

describe('Payrekha firewall', () => {
  it('defaults to shadow: calculated BLOCK, effective ALLOW', () => {
    const fw = new Payrekha([blockAll as never]);
    const v = fw.evaluate(po());
    assert.equal(v.mode, 'shadow');
    assert.equal(v.verdict, 'BLOCK');
    assert.equal(v.effectiveAction, 'ALLOW');
  });
  it('advise reports DECLINE/HOLD like enforce; the caller chooses to honour it', () => {
    const fw = new Payrekha([blockAll as never], { config: { mode: 'advise' } });
    assert.equal(fw.evaluate(po()).effectiveAction, 'DECLINE');
  });
  it('refuses raw identifiers and malformed payouts as degraded REVIEW, naming the field only', () => {
    const fw = new Payrekha([], { config: { mode: 'enforce' } });
    const v = fw.evaluate(po({ beneficiaryRef: 'alice@okbank' }));
    assert.equal(v.verdict, 'REVIEW');
    assert.equal(v.degraded, true);
    assert.ok(!JSON.stringify(v).includes('alice@okbank'));
    for (const bad of [null, {}, { ...po(), amountPaise: 1.5 }, { ...po(), amountPaise: -1 }, { ...po(), channel: 'SWIFT' }]) {
      const r = fw.evaluate(bad as never);
      assert.equal(r.verdict, 'REVIEW');
      assert.equal(r.degraded, true);
      assert.equal(r.effectiveAction, 'HOLD');
    }
  });
  it('HIGH_ALERT: burst of blocks raises it; reset needs the admin token; it survives restart', () => {
    const audits: string[] = [];
    const fw = new Payrekha([blockAll as never], { config: { mode: 'enforce', adminTokenSha256: sha, highAlertOnBlocks: { count: 3, windowMs: 60_000 } }, onAudit: (e) => audits.push(e.action) });
    for (let k = 0; k < 3; k++) fw.evaluate(po({ timestampMs: T0 + k }));
    assert.equal(fw.alertState, 'HIGH_ALERT');
    assert.throws(() => fw.resetHighAlert({ actor: 'x', reason: 'y', adminToken: 'wrong' }), AuthorizationError);
    const fw2 = new Payrekha([], { config: { mode: 'enforce', adminTokenSha256: sha } });
    fw2.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    assert.equal(fw2.alertState, 'HIGH_ALERT');
    fw2.resetHighAlert({ actor: 'soc', reason: 'contained', adminToken });
    assert.equal(fw2.alertState, 'NORMAL');
    assert.deepEqual(audits, ['alert.enter', 'alert.reset.denied']);
  });
  it('a state file cannot flip the configured mode', () => {
    const fw = new Payrekha([], { config: { mode: 'enforce' } });
    const snap = { ...fw.exportState(), mode: 'shadow' as const };
    fw.restoreState(snap);
    assert.equal(fw.currentMode.mode, 'enforce');
  });
  it('mode changes need the admin token', () => {
    const fw = new Payrekha([], { config: { adminTokenSha256: sha } });
    assert.throws(() => fw.setMode('enforce', { actor: 'x', reason: 'y' }), AuthorizationError);
    fw.setMode('enforce', { actor: 'x', reason: 'y', adminToken }, 'REFUND');
    assert.equal(fw.evaluate(po()).mode, 'enforce');
    assert.equal(fw.evaluate(po({ kind: 'VENDOR_PAYOUT' })).mode, 'shadow');
  });
  it('a throwing decision hook does not break evaluation', () => {
    const fw = new Payrekha([], { onDecision: () => { throw new Error('x'); } });
    assert.equal(fw.evaluate(po()).verdict, 'ALLOW');
    assert.equal(fw.metrics.hookErrors, 1);
  });
});

describe('FileStateStore', () => {
  it('writes atomically with 0600 and restores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'payrekha-'));
    const path = join(dir, 'state.json');
    const fw = new Payrekha([]);
    fw.raiseHighAlert('t', 't');
    const store = new FileStateStore(path);
    store.save(fw);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const fw2 = new Payrekha([]);
    assert.equal(store.load(fw2), true);
    assert.equal(fw2.alertState, 'HIGH_ALERT');
  });
});
