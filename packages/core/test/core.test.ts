// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  serializeCanonical,
  serializeSnapshot,
  signIntent,
  signSnapshot,
  TimeRing,
  verifyAndUnwrap,
  Verdict,
  type PayoutContext,
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
  it('config validation fails loud on a typo\'d kind, a bad mode and a non-finite multiplier', () => {
    assert.throws(() => new Payrekha([], { config: { modeByKind: { LOAN_DISBURSALX: 'enforce' } as never } }), /modeByKind\.LOAN_DISBURSALX.*IntentKind/);
    assert.throws(() => new Payrekha([], { config: { requireIntent: { REFUNDS: false } as never } }), /requireIntent\.REFUNDS/);
    assert.throws(() => new Payrekha([], { config: { mode: 'block' as never } }), /mode must be shadow, advise or enforce/);
    assert.throws(() => new Payrekha([], { config: { multipliers: { NORMAL: { velocity: Number.NaN } } } }), /multipliers\.NORMAL\.velocity/);
    assert.throws(() => new Payrekha([], { config: { multipliers: { WEEKDAY: { velocity: 1 } } as never } }), /multipliers\.WEEKDAY/);
    assert.throws(() => new Payrekha([], { config: { maxTimestampSkewMs: -5 } }), /maxTimestampSkewMs/);
    assert.throws(() => new Payrekha([], { config: { adminTokenSha256: 'nothex' } }), /adminTokenSha256/);
    // A good config still boots.
    new Payrekha([], { config: { mode: 'enforce', modeByKind: { REFUND: 'shadow' }, requireIntent: { REFUND: false }, multipliers: { NORMAL: { velocity: 2 } }, maxTimestampSkewMs: 60_000 } });
  });
  it('an active beneficiary refreshes its ledger recency on every payout', () => {
    const fw = new Payrekha([], { config: { mode: 'enforce', ledgerCapacity: 2 } });
    const [a, b, c] = ['hb1_a', 'hb1_b', 'hb1_c'];
    fw.evaluate(po({ beneficiaryRef: a }));
    fw.evaluate(po({ beneficiaryRef: b }));
    // a pays again — recency refreshes, so the next insertion evicts b, not a.
    fw.evaluate(po({ beneficiaryRef: a }));
    fw.evaluate(po({ beneficiaryRef: c }));
    assert.ok(fw.beneficiaries.get(a) !== undefined, 'still-active beneficiary must not be evicted');
    assert.ok(fw.beneficiaries.get(b) === undefined, 'the least-recent entry goes');
  });
  it('a throwing decision hook does not break evaluation', () => {
    const fw = new Payrekha([], { onDecision: () => { throw new Error('x'); } });
    assert.equal(fw.evaluate(po()).verdict, 'ALLOW');
    assert.equal(fw.metrics.hookErrors, 1);
  });
  it('dedupe is scoped to the caller: one key cannot preload another key\'s payoutId', () => {
    const fw = new Payrekha([], { config: { mode: 'enforce' } });
    const id = 'shared-id-1';
    const a = fw.evaluate(po({ payoutId: id, sourceKeyId: 'key-a' }));
    const b = fw.evaluate(po({ payoutId: id, sourceKeyId: 'key-b' }));
    const retry = fw.evaluate(po({ payoutId: id, sourceKeyId: 'key-a' }));
    assert.equal(a.deduped, false);
    assert.equal(b.deduped, false);
    assert.notEqual(b.decisionId, a.decisionId);
    assert.equal(retry.deduped, true);
    assert.equal(retry.decisionId, a.decisionId);
  });
  it('outcome reports bind to the consuming key; denials and releases are audited', () => {
    const audits: string[] = [];
    const kp = generateIssuerKeyPair();
    const fw = new Payrekha([], {
      config: { mode: 'enforce', adminTokenSha256: sha },
      keys: [{ keyId: 'k1', issuer: 'los-prod', alg: 'ed25519', publicKey: kp.publicKey, kinds: ['LOAN_DISBURSAL'] }],
      onAudit: (e) => audits.push(e.action),
    });
    fw.registerIntent(signIntent(unsigned(), { alg: 'ed25519', privateKey: kp.privateKey }), T0);
    const uses = () => fw.intents.get('i-1')?.uses;
    const first = po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100, sourceKeyId: 'key-a' });
    assert.equal(fw.evaluate(first).verdict, 'ALLOW');
    assert.equal(uses(), 1);
    assert.equal(fw.reportOutcome(first.payoutId, 'failed', 'key-b'), false, 'another key must not free the intent');
    assert.equal(uses(), 1, 'denied release must not refund the intent use');
    assert.equal(fw.reportOutcome(first.payoutId, 'failed', 'key-a'), true);
    assert.equal(uses(), 0, 'the consuming key\'s failure report refunds the use');
    assert.deepEqual(audits, ['outcome.denied', 'outcome.failed']);
  });
  it('mintIntent builds, signs and registers — idempotent, audited, scope-checked', () => {
    const audits: string[] = [];
    const kp = generateIssuerKeyPair();
    const fw = new Payrekha([], {
      config: { mode: 'enforce' },
      keys: [{ keyId: 'mint-1', issuer: 'payrekha-managed', alg: 'ed25519', publicKey: kp.publicKey, kinds: ['LOAN_DISBURSAL'] }],
      onAudit: (e) => audits.push(e.action),
      now: () => T0,
    });
    const signer = { alg: 'ed25519' as const, privateKey: kp.privateKey };
    const spec = { keyId: 'mint-1', key: signer, kind: 'LOAN_DISBURSAL' as const, maxAmountPaise: 500_000, beneficiaryRef: 'h:v1:abc', ttlMs: 60_000 };
    const first = fw.mintIntent(spec, 'los-key-a');
    assert.equal(first.accepted, true);
    assert.ok(first.intentId?.startsWith('mint-'));
    // Same fields → same intentId → a retried mint is idempotent, not a duplicate.
    const retry = fw.mintIntent(spec, 'los-key-a');
    assert.equal(retry.accepted, true);
    assert.equal(retry.intentId, first.intentId);
    // A caller-chosen id wins (their own idempotency key, e.g. the loan id).
    const named = fw.mintIntent({ ...spec, intentId: 'loan-42' }, 'los-key-a');
    assert.equal(named.intentId, 'loan-42');
    // The minted intent verifies and binds a payout end to end.
    const v = fw.evaluate(po({ kind: 'LOAN_DISBURSAL', amountPaise: 500_000, beneficiaryRef: 'h:v1:abc', intentId: first.intentId }));
    assert.equal(v.verdict, 'ALLOW');
    // Negative: unknown signing key and an out-of-scope kind both fail closed.
    assert.equal(fw.mintIntent({ ...spec, keyId: 'nope' }, 'los-key-a').accepted, false);
    const badKind = fw.mintIntent({ ...spec, kind: 'VDA_WITHDRAWAL' }, 'los-key-a');
    assert.equal(badKind.accepted, false);
    assert.match(badKind.reason ?? '', /kind-not-allowed/);
    assert.deepEqual(audits.filter((a) => a === 'intent.minted').length, 3, 'every accepted mint call is audited, including idempotent retries');
  });
  it('a payoutId is bound to one intent for life — even across restarts', () => {
    const kp = generateIssuerKeyPair();
    const intentRule: Rule<PayoutRequest, PayoutContext> = {
      name: 'intent',
      evaluate: (_p, ctx) => (ctx.intent.status === 'reused' ? { rule: 'intent.reused', verdict: 'BLOCK', reason: 'reused', evidence: {} } : null),
    };
    const mk = () =>
      new Payrekha([intentRule], {
        config: { mode: 'enforce' },
        keys: [{ keyId: 'k1', issuer: 'los-prod', alg: 'ed25519', publicKey: kp.publicKey, kinds: ['LOAN_DISBURSAL'] }],
        now: () => T0,
      });
    const fw = mk();
    fw.registerIntent(signIntent(unsigned(), { alg: 'ed25519', privateKey: kp.privateKey }), T0);
    fw.registerIntent(signIntent(unsigned({ intentId: 'i-2' }), { alg: 'ed25519', privateKey: kp.privateKey }), T0);
    const p1 = po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100 });
    assert.equal(fw.evaluate(p1).verdict, 'ALLOW');
    // Snapshot → restore into a fresh firewall: dedupe is gone, reservations persist.
    const fw2 = mk();
    fw2.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    assert.equal(fw2.evaluate(p1).verdict, 'ALLOW', 'same payoutId + same intent must not read as reuse after a restart');
    // Restart again: replaying the taken payoutId under a different (valid)
    // intent is reuse, not a free pass — reserve() is idempotent per payoutId,
    // so without this check the new intent would be cited but never consumed.
    const fw3 = mk();
    fw3.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    const swap = fw3.evaluate({ ...p1, intentId: 'i-2' });
    assert.equal(swap.verdict, 'BLOCK');
    assert.equal(fw3.intents.get('i-2')?.uses, 0, 'a rebound payoutId must neither consume nor green-light the new intent');
    // A genuinely new payout citing the spent intent is still reused.
    assert.equal(fw3.evaluate(po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100 })).verdict, 'BLOCK');
  });
  it('a deduped verdict follows the mode in force — shadow→enforce must not keep ALLOWing a BLOCK', () => {
    const fw = new Payrekha([blockAll as never], { config: { mode: 'shadow', adminTokenSha256: sha } });
    const p = po();
    assert.equal(fw.evaluate(p).verdict, 'BLOCK');
    assert.equal(fw.evaluate(p).effectiveAction, 'ALLOW');
    fw.setMode('enforce', { actor: 'soc', reason: 'go live', adminToken });
    const r = fw.evaluate(p);
    assert.equal(r.deduped, true);
    assert.equal(r.verdict, 'BLOCK');
    assert.equal(r.effectiveAction, 'DECLINE');
    assert.equal(r.mode, 'enforce');
  });
  it('settled is final, keeps the payoutId bound, and unkeyed callers cannot touch bound reservations', () => {
    const audits: string[] = [];
    const kp = generateIssuerKeyPair();
    const mk = () =>
      new Payrekha([], {
        config: { mode: 'enforce' },
        keys: [{ keyId: 'k1', issuer: 'los-prod', alg: 'ed25519', publicKey: kp.publicKey, kinds: ['LOAN_DISBURSAL'] }],
        onAudit: (e) => audits.push(e.action),
        now: () => T0,
      });
    const fw = mk();
    fw.registerIntent(signIntent(unsigned(), { alg: 'ed25519', privateKey: kp.privateKey }), T0);
    const p = po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100, sourceKeyId: 'key-a' });
    assert.equal(fw.evaluate(p).verdict, 'ALLOW');
    // An unkeyed caller and a foreign key are both denied on a bound reservation.
    assert.equal(fw.reportOutcome(p.payoutId, 'settled'), false);
    assert.equal(fw.reportOutcome(p.payoutId, 'settled', 'key-b'), false);
    assert.equal(fw.reportOutcome(p.payoutId, 'settled', 'key-a'), true);
    assert.equal(fw.reportOutcome(p.payoutId, 'settled', 'key-a'), true, 'settled is idempotent');
    // Settled is final: a later "failed" is a state conflict — denied and audited.
    assert.equal(fw.reportOutcome(p.payoutId, 'failed', 'key-a'), false);
    // The binding survives restore: after dedupe is gone the payoutId cannot rebind.
    const fw2 = mk();
    fw2.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    fw2.registerIntent(signIntent(unsigned({ intentId: 'i-2' }), { alg: 'ed25519', privateKey: kp.privateKey }), T0);
    assert.equal(fw2.intents.check({ ...p, intentId: 'i-2' }, true).status, 'reused');
    assert.deepEqual(audits, ['outcome.denied', 'outcome.denied', 'outcome.settled', 'outcome.settled', 'outcome.denied']);
  });
  it('runtime key revocation: admin-only, audited, kills live intents, survives restart', () => {
    const audits: string[] = [];
    const kp = generateIssuerKeyPair();
    const intentRule: Rule<PayoutRequest, PayoutContext> = {
      name: 'intent',
      evaluate: (_p, ctx) => (ctx.intent.status === 'bad-signature' ? { rule: 'intent.bad-signature', verdict: 'BLOCK', reason: 'bad-signature', evidence: {} } : null),
    };
    const mk = () =>
      new Payrekha([intentRule], {
        config: { mode: 'enforce', adminTokenSha256: sha },
        keys: [{ keyId: 'k1', issuer: 'los-prod', alg: 'ed25519', publicKey: kp.publicKey, kinds: ['LOAN_DISBURSAL'] }],
        now: () => T0,
        onAudit: (e) => audits.push(e.action),
      });
    const fw = mk();
    fw.registerIntent(signIntent(unsigned(), { alg: 'ed25519', privateKey: kp.privateKey }), T0);
    const p1 = po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100 });
    assert.equal(fw.evaluate(p1).verdict, 'ALLOW');
    // Wrong admin token → AuthorizationError + a denied audit entry.
    assert.throws(() => fw.revokeIssuerKey('k1', { actor: 'x', reason: 'r', adminToken: 'wrong' }), AuthorizationError);
    assert.equal(fw.revokeIssuerKey('k1', { actor: 'soc', reason: 'key leaked', adminToken: adminToken }), true);
    // The same intent now fails verification — revocation applies to live intents.
    assert.equal(fw.evaluate(po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100 })).verdict, 'BLOCK');
    // And a restart must not un-revoke it.
    const fw2 = mk();
    fw2.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    assert.equal(fw2.evaluate(po({ intentId: 'i-1', kind: 'LOAN_DISBURSAL', amountPaise: 100 })).verdict, 'BLOCK');
    assert.ok(fw2.keyring.list().some((k) => k.keyId === 'k1' && k.revoked === true));
    assert.deepEqual(audits, ['key.revoke.denied', 'key.revoked']);
  });
});

describe('timestamp trust boundary (maxTimestampSkewMs)', () => {
  const bound = { mode: 'enforce' as const, maxTimestampSkewMs: 60_000 };
  it('a timestamp inside the bound is honoured normally', () => {
    const fw = new Payrekha([], { config: bound, now: () => T0 });
    const v = fw.evaluate(po({ timestampMs: T0 - 30_000 }));
    assert.equal(v.verdict, 'ALLOW');
    assert.equal(v.degraded, false);
  });
  it('a timestamp outside the bound: evaluated at firewall time, degraded REVIEW + time.skew', () => {
    const fw = new Payrekha([], { config: bound, now: () => T0 });
    const v = fw.evaluate(po({ timestampMs: T0 - 25 * 3_600_000 }));
    assert.equal(v.verdict, 'REVIEW');
    assert.equal(v.effectiveAction, 'HOLD');
    assert.equal(v.degraded, true);
    const h = v.hits.at(-1)!;
    assert.equal(h.rule, 'time.skew');
    assert.equal(h.evidence['clientTimestampMs'], T0 - 25 * 3_600_000);
  });
  it('BLOCKs still block; the skew hit never whitewashes a verdict', () => {
    const fw = new Payrekha([blockAll as never], { config: bound, now: () => T0 });
    const v = fw.evaluate(po({ timestampMs: T0 + 86_400_000 }));
    assert.equal(v.verdict, 'BLOCK');
    assert.equal(v.degraded, true);
    assert.ok(v.hits.some((h) => h.rule === 'time.skew'));
  });
  it('a skewed clock cannot backdate a beneficiary out of the ledger', () => {
    // Beneficiary ledger ages from the stamped time, not the caller's claim.
    const fw = new Payrekha([], { config: bound, now: () => T0 });
    const ref = po().beneficiaryRef;
    fw.evaluate(po({ beneficiaryRef: ref, timestampMs: T0 - 86_400_000 }));
    const entry = fw.beneficiaries.get(ref);
    assert.equal(entry?.firstSeenMs, T0, 'firstSeen is firewall time, not the caller claim');
  });
});

describe('snapshot integrity (PAYREKHA_STATE_KEY)', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'prk-'));
  const key = 'state-key-0123456789abcdef0123456789';
  it('signed snapshots round-trip; tampering and wrong keys are refused', async () => {
    const file = join(dir(), 's.json');
    const fw = new Payrekha([], { config: { mode: 'enforce' } });
    fw.evaluate(po());
    await new FileStateStore(file, key).save(fw);
    const fw2 = new Payrekha([], {});
    assert.equal(new FileStateStore(file, key).load(fw2), true);
    // Wrong key and tampered content both fail closed.
    assert.throws(() => new FileStateStore(file, 'x'.repeat(32)).load(fw2), /signature mismatch/);
    const tampered = JSON.parse(readFileSync(file, 'utf8')) as { d: Record<string, unknown>; m: string };
    tampered.d['canaries'] = { beneficiaryRefs: [] };
    writeFileSync(file, JSON.stringify(tampered));
    assert.throws(() => new FileStateStore(file, key).load(fw2), /signature mismatch/);
  });
  it('a key set against a legacy unsigned file refuses to load (no silent upgrade)', async () => {
    const file = join(dir(), 's.json');
    await new FileStateStore(file).save(new Payrekha([], {}));
    assert.throws(() => new FileStateStore(file, key).load(new Payrekha([], {})), /unsigned/);
    // And the unsigned path is untouched for deployments without the key.
    assert.equal(new FileStateStore(file).load(new Payrekha([], {})), true);
  });
  it('previous keys verify during rotation but never sign', async () => {
    const file = join(dir(), 's.json');
    await new FileStateStore(file, 'old-key-0123456789abcdef012345678').save(new Payrekha([], {}));
    // Rotated primary + retiring key → loads; save re-signs with the new key.
    const rotated = new FileStateStore(file, key, ['old-key-0123456789abcdef012345678']);
    assert.equal(rotated.load(new Payrekha([], {})), true);
    await rotated.save(new Payrekha([], {}));
    assert.equal(new FileStateStore(file, key).load(new Payrekha([], {})), true);
    assert.throws(() => new FileStateStore(file, 'old-key-0123456789abcdef012345678').load(new Payrekha([], {})), /mismatch/);
  });
});

describe('FileStateStore', () => {
  it('writes atomically with 0600 and restores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'payrekha-'));
    const path = join(dir, 'state.json');
    const fw = new Payrekha([]);
    fw.raiseHighAlert('t', 't');
    const store = new FileStateStore(path);
    await store.save(fw);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const fw2 = new Payrekha([]);
    assert.equal(store.load(fw2), true);
    assert.equal(fw2.alertState, 'HIGH_ALERT');
  });
});

describe('serializeSnapshot (B3 — chunked, off the event loop)', () => {
  it('emits bytes identical to canonicalJson on arbitrary values', async () => {
    const value = {
      z: [1, 'x', null, true, [2, { b: [3, 4], a: 'k' }]],
      a: { nested: { list: ['q', 7] }, s: 'trail' },
      undef: undefined,
    };
    assert.equal(await serializeCanonical(value), canonicalJson(value));
    assert.equal(await serializeCanonical(value, 1), canonicalJson(value), 'byte-identical even when yielding every step');
    assert.throws(() => canonicalJson({ f: 1.5 }), /non-integer/);
    await assert.rejects(serializeCanonical({ f: 1.5 }), /non-integer/);
  });

  it('signed output verifies; unsigned output is the canonical snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'payrekha-'));
    const key = 'state-key-0123456789abcdef0123456789';
    const fw = new Payrekha([], { config: { mode: 'enforce' } });
    fw.evaluate(po());
    fw.raiseHighAlert('t', 't');
    const snap = fw.exportState();
    const signed = await serializeSnapshot(snap, key);
    // Round-trips through the same verifyAndUnwrap the stores use on load.
    const back = verifyAndUnwrap(JSON.parse(signed), key);
    assert.deepEqual(back.canaries, (snap as unknown as Record<string, unknown>)['canaries']);
    assert.equal(back.highAlert === null, false);
    const wrong = await serializeSnapshot(snap, 'other-key-0123456789abcdef0123456');
    assert.throws(() => verifyAndUnwrap(JSON.parse(wrong), key), /signature mismatch/);
    const unsigned = await serializeSnapshot(snap, undefined);
    const backU = verifyAndUnwrap(JSON.parse(unsigned), undefined);
    assert.equal(backU.mode, 'enforce');
    // FileStateStore writes these exact bytes — a real save→load cycle.
    const file = join(dir, 's.json');
    await new FileStateStore(file, key).save(fw);
    const fw2 = new Payrekha([], {});
    assert.equal(new FileStateStore(file, key).load(fw2), true);
    assert.equal(fw2.alertState, 'HIGH_ALERT');
  });

  it('yields to the event loop between record slices', async () => {
    // 20k leaf records forces several pause() ticks at the default budget —
    // if another macrotask runs mid-serialization the loop stayed live.
    const value = { rows: Array.from({ length: 20_000 }, (_, i) => ({ k: `r${i}`, v: i })) };
    let ran = false;
    setTimeout(() => {
      ran = true;
    }, 0);
    const body = await serializeCanonical(value, 512);
    assert.equal(ran, true, 'a timer scheduled before serialize must fire before it finishes');
    assert.equal(body, canonicalJson(value));
  });

  it('signSnapshot still exists for callers that serialize whole', () => {
    const snap = new Payrekha([], {}).exportState();
    const env = signSnapshot(snap, 'k'.repeat(32)) as { m: string };
    assert.equal(typeof env.m, 'string');
  });
});
