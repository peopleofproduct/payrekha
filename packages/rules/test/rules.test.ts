// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { hashBeneficiary, signIntent } from '@payrekha/core';
import { RULE_IDS } from '@payrekha/rules';
import { admin, firewall, HASH_KEY, intent, LOS, MIN, MULTI_KEYS, OPS, payout, ref, RISK, ruleIds, T0 } from './fixtures.ts';

const A = ref('alice@okbank');
const B = ref('mule@okbank');

describe('intent.*', () => {
  it('allows a payout that matches its signed intent', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId }));
    assert.equal(v.verdict, 'ALLOW', JSON.stringify(v.hits));
    assert.equal(v.effectiveAction, 'ALLOW');
  });
  it('intent.missing: no intent id', () => {
    const { fw } = firewall();
    const v = fw.evaluate(payout({ beneficiaryRef: A }));
    assert.equal(v.verdict, 'BLOCK');
    assert.deepEqual(ruleIds(v), ['intent.missing']);
    assert.equal(v.effectiveAction, 'DECLINE');
  });
  it('intent.missing: unregistered id', () => {
    const { fw } = firewall();
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: 'nope' }))), ['intent.missing']);
  });
  it('intent.missing not required for an exempt kind — until HIGH_ALERT', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } });
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 500_00 })).verdict, 'ALLOW');
    fw.raiseHighAlert('soc', 'drill');
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 500_00 }))), ['intent.missing']);
  });
  it('intent.bad-signature: tampered amount is rejected and the tombstone blocks', () => {
    const { fw } = firewall();
    const good = signIntent(
      {
        intentId: 'tamper',
        kind: 'LOAN_DISBURSAL',
        maxAmountPaise: 1_000_00,
        beneficiaryRef: A,
        maxUses: 1,
        notBeforeMs: T0 - MIN,
        expiresAtMs: T0 + MIN,
        issuer: 'los-prod',
        keyId: 'los-1',
      },
      { alg: 'ed25519', privateKey: LOS.privateKey },
    );
    const r = fw.registerIntent({ ...good, maxAmountPaise: 99_00_000_00 }, T0);
    assert.equal(r.accepted, false);
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: 'tamper', amountPaise: 50_00_000_00 }));
    assert.deepEqual(ruleIds(v), ['intent.bad-signature']);
  });
  it('intent.bad-signature after key revocation', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    fw.keyring.revoke('los-1');
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId }));
    assert.deepEqual(ruleIds(v), ['intent.bad-signature']);
    assert.equal(v.hits[0]!.evidence['detail'], 'key-revoked');
  });
  it('intent.kind-mismatch', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A, kind: 'REFUND' });
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId }))), ['intent.kind-mismatch']);
  });
  it('intent.expired', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A, expiresAtMs: T0 + MIN });
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId, timestampMs: T0 + 2 * MIN }))), [
      'intent.expired',
    ]);
  });
  it('intent.beneficiary-mismatch', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: B, intentId: i.intentId }))), ['intent.beneficiary-mismatch']);
  });
  it('intent.amount-exceeds', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A, maxAmountPaise: 1_00_000_00 });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId, amountPaise: 1_00_000_01 }));
    assert.deepEqual(ruleIds(v), ['intent.amount-exceeds']);
    assert.equal(v.hits[0]!.evidence['remainingPaise'], 1_00_000_00);
  });
  it('intent.reused; a failed payout gives the use back', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    const first = payout({ beneficiaryRef: A, intentId: i.intentId });
    assert.equal(fw.evaluate(first).verdict, 'ALLOW');
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId }))), ['intent.reused']);
    assert.equal(fw.reportOutcome(first.payoutId, 'failed', 'lms-prod'), true);
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId })).verdict, 'ALLOW');
  });
  it('a retry with the same payoutId is deduped, not counted as reuse', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    const p = payout({ beneficiaryRef: A, intentId: i.intentId });
    const a = fw.evaluate(p);
    const b = fw.evaluate(p);
    assert.equal(b.deduped, true);
    assert.equal(b.decisionId, a.decisionId);
    assert.equal(b.verdict, 'ALLOW');
  });
  it('a live intent id cannot be overwritten', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    const evil = signIntent({ ...i, beneficiaryRef: B, signature: undefined } as never, { alg: 'ed25519', privateKey: LOS.privateKey });
    assert.equal(fw.registerIntent(evil, T0).accepted, false);
  });
});

describe('intent.approvals', () => {
  const approve = (fw: Parameters<typeof intent>[0], beneficiaryRef: string, keyId: string, issuer: string, privateKey: string) =>
    intent(fw, { beneficiaryRef, keyId, issuer }, privateKey);
  const cfg = { requiredApprovals: { LOAN_DISBURSAL: 2 } };

  it('primary + a distinct-issuer approval allows; both intents are consumed', () => {
    const { fw } = firewall(cfg, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    const app = approve(fw, A, 'risk-1', 'risk-desk', RISK.privateKey);
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [app.intentId] }));
    assert.equal(v.verdict, 'ALLOW', JSON.stringify(v.hits));
    assert.equal(fw.intents.get(pri.intentId)?.uses, 1);
    assert.equal(fw.intents.get(app.intentId)?.uses, 1, 'the approval is consumed too');
  });
  it('intent.approvals-insufficient: primary alone under a required-2 kind', () => {
    const { fw } = firewall(cfg, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId }));
    assert.equal(v.verdict, 'BLOCK');
    assert.deepEqual(ruleIds(v), ['intent.approvals-insufficient']);
    assert.equal(v.hits[0]!.evidence['provided'], 1);
    assert.equal(v.effectiveAction, 'DECLINE');
    assert.equal(fw.intents.get(pri.intentId)?.uses, 0, 'a declined payout consumes nothing');
  });
  it('onInsufficient: review holds instead of declining — the safeguard is on, the flow is not jammed', () => {
    const { fw } = firewall({ requiredApprovals: { LOAN_DISBURSAL: { count: 2, onInsufficient: 'review' } } }, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId }));
    assert.equal(v.verdict, 'REVIEW');
    assert.equal(v.effectiveAction, 'HOLD', 'held for the maker-checker queue, not declined');
  });
  it('intent.approvals-not-distinct: a second intent from the same issuer cannot approve', () => {
    const { fw } = firewall(cfg, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    const same = intent(fw, { beneficiaryRef: A }); // also los-prod
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [same.intentId] }));
    assert.deepEqual(ruleIds(v), ['intent.approvals-not-distinct']);
  });
  it('intent.approvals-invalid: unknown id, wrong beneficiary, expired', () => {
    const { fw } = firewall(cfg, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: ['ghost'] }))), [
      'intent.approvals-invalid',
    ]);
    const wrongBen = approve(fw, B, 'risk-1', 'risk-desk', RISK.privateKey);
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [wrongBen.intentId] }))), [
      'intent.approvals-invalid',
    ]);
    const stale = intent(
      fw,
      { beneficiaryRef: A, keyId: 'risk-1', issuer: 'risk-desk', notBeforeMs: T0 - 2 * MIN, expiresAtMs: T0 - 1 },
      RISK.privateKey,
    );
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [stale.intentId] }))), [
      'intent.approvals-invalid',
    ]);
  });
  it('approverIssuers: only allowlisted issuers count toward the requirement', () => {
    const { fw } = firewall({ requiredApprovals: { LOAN_DISBURSAL: { count: 2, approverIssuers: ['risk-desk'] } } }, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    const offlist = approve(fw, A, 'ops-1', 'ops-team', OPS.privateKey);
    assert.deepEqual(
      ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [offlist.intentId] }))),
      ['intent.approvals-insufficient'],
      'ops-team approval is valid but does not count',
    );
    const onlist = approve(fw, A, 'risk-1', 'risk-desk', RISK.privateKey);
    assert.equal(
      fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [offlist.intentId, onlist.intentId] })).verdict,
      'ALLOW',
      'a counted approval on top satisfies it',
    );
  });
  it('an approval already consumed by another payout is invalid', () => {
    const { fw } = firewall(cfg, {}, MULTI_KEYS);
    const pri1 = intent(fw, { beneficiaryRef: A });
    const app = approve(fw, A, 'risk-1', 'risk-desk', RISK.privateKey);
    fw.evaluate(payout({ beneficiaryRef: A, intentId: pri1.intentId, approvalIds: [app.intentId] }));
    const pri2 = intent(fw, { beneficiaryRef: A });
    assert.deepEqual(
      ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: pri2.intentId, approvalIds: [app.intentId] }))),
      ['intent.approvals-invalid'],
      'single-use approval cannot be re-spent',
    );
  });
  it('a failed outcome releases the primary and every approval', () => {
    const { fw } = firewall(cfg, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    const app = approve(fw, A, 'risk-1', 'risk-desk', RISK.privateKey);
    const po = payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: [app.intentId] });
    fw.evaluate(po);
    fw.reportOutcome(po.payoutId, 'failed', 'lms-prod');
    assert.equal(fw.intents.get(pri.intentId)?.uses, 0);
    assert.equal(fw.intents.get(app.intentId)?.uses, 0, 'the approval is released too');
  });
  it('approvals are validated even when the kind does not require them', () => {
    const { fw } = firewall({}, {}, MULTI_KEYS);
    const pri = intent(fw, { beneficiaryRef: A });
    assert.deepEqual(
      ruleIds(fw.evaluate(payout({ beneficiaryRef: A, intentId: pri.intentId, approvalIds: ['ghost'] }))),
      ['intent.approvals-invalid'],
      'a cited bad approval is evidence, never a free pass',
    );
  });
});

describe('probe.micro-then-large', () => {
  it('reviews ₹1 then ₹4,99,999 to the same account', () => {
    const { fw } = firewall({ requireIntent: { VENDOR_PAYOUT: false } });
    fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 100 }));
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 4_99_999_00, timestampMs: T0 + 4 * MIN }));
    assert.equal(v.verdict, 'REVIEW');
    assert.ok(ruleIds(v).includes('probe.micro-then-large'), JSON.stringify(v.hits));
    assert.match(v.hits.find((h) => h.rule === 'probe.micro-then-large')!.reason, /₹1 test transfer 4 min ago, now ₹4,99,999/);
  });
  it('blocks the same in HIGH_ALERT', () => {
    const { fw } = firewall({ requireIntent: { VENDOR_PAYOUT: false } });
    fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 100 }));
    fw.raiseHighAlert('soc', 'drill');
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 4_99_999_00, timestampMs: T0 + 4 * MIN }));
    // HIGH_ALERT forces an intent on every kind, so intent.missing short-circuits first.
    assert.equal(v.verdict, 'BLOCK');
  });
  it('legitimate penny-drop: VERIFICATION intent then the loan for the same subject is ALLOWED', () => {
    const { fw } = firewall();
    const vi = intent(fw, { beneficiaryRef: A, kind: 'VERIFICATION', maxAmountPaise: 100, subjectRef: 'loan-42' });
    assert.equal(
      fw.evaluate(payout({ beneficiaryRef: A, kind: 'VERIFICATION', intentId: vi.intentId, amountPaise: 100 })).verdict,
      'ALLOW',
    );
    const li = intent(fw, { beneficiaryRef: A, subjectRef: 'loan-42', maxAmountPaise: 4_99_999_00 });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: li.intentId, amountPaise: 4_99_999_00, timestampMs: T0 + 3 * MIN }));
    assert.equal(v.verdict, 'ALLOW', JSON.stringify(v.hits));
  });
  it('penny-drop for a different subject does not launder the probe', () => {
    const { fw } = firewall();
    const vi = intent(fw, { beneficiaryRef: A, kind: 'VERIFICATION', maxAmountPaise: 100, subjectRef: 'loan-1' });
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'VERIFICATION', intentId: vi.intentId, amountPaise: 100 }));
    const li = intent(fw, { beneficiaryRef: A, subjectRef: 'loan-2' });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: li.intentId, amountPaise: 2_00_000_00, timestampMs: T0 + 3 * MIN }));
    assert.ok(ruleIds(v).includes('probe.micro-then-large'));
  });
  it('quiet after the window', () => {
    const { fw } = firewall({ requireIntent: { VENDOR_PAYOUT: false } });
    fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 100, timestampMs: T0 - 25 * 60 * MIN }));
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 20_000_00 }));
    assert.ok(!ruleIds(v).includes('probe.micro-then-large'));
  });
});

describe('beneficiary.cooling', () => {
  it('reviews a large payout to a beneficiary first seen minutes ago', () => {
    const { fw } = firewall({ requireIntent: { VENDOR_PAYOUT: false } });
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 60_000_00 }));
    assert.deepEqual(ruleIds(v), ['beneficiary.cooling']);
    assert.equal(v.verdict, 'REVIEW');
    assert.equal(v.effectiveAction, 'HOLD');
  });
  it('small payouts and old beneficiaries pass', () => {
    const { fw } = firewall({ requireIntent: { VENDOR_PAYOUT: false } });
    assert.equal(fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 10_000_00 })).verdict, 'ALLOW');
    assert.equal(
      fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 60_000_00, timestampMs: T0 + 31 * MIN })).verdict,
      'ALLOW',
    );
  });
  it('threshold tightens on a holiday (×0.5)', () => {
    const { fw } = firewall({
      requireIntent: { VENDOR_PAYOUT: false },
      calendar: { holidays: [{ date: '2026-11-04', name: 'Test Day' }] },
    });
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'VENDOR_PAYOUT', amountPaise: 30_000_00 }));
    assert.equal(v.alertState, 'HOLIDAY');
    assert.deepEqual(ruleIds(v), ['beneficiary.cooling', 'calendar.window']);
    assert.equal(v.hits[0]!.evidence['thresholdPaise'], 25_000_00);
  });
});

describe('velocity.outflow', () => {
  it('reviews past the per-key budget and blocks past the hard cap', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } }, { velocity: { perSourceKey: { count: 3, sumPaise: 1e12 } } });
    const vs = Array.from({ length: 7 }, (_, k) =>
      fw.evaluate(payout({ beneficiaryRef: ref(`r${k}@okbank`), kind: 'REFUND', amountPaise: 100_00, timestampMs: T0 + k * 1000 })),
    );
    assert.deepEqual(
      vs.map((v) => v.verdict),
      ['ALLOW', 'ALLOW', 'ALLOW', 'REVIEW', 'REVIEW', 'REVIEW', 'BLOCK'],
    );
    assert.equal(vs[3]!.hits[0]!.evidence['scope'], 'sourceKey');
  });
  it('per-merchant sum budget', () => {
    const { fw } = firewall(
      { requireIntent: { PA_SETTLEMENT: false } },
      { velocity: { perMerchant: { count: 100, sumPaise: 10_000_00 } } },
    );
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 9_000_00 }));
    const v = fw.evaluate(
      payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 2_000_00, timestampMs: T0 + 1000 }),
    );
    assert.ok(ruleIds(v).includes('velocity.outflow'));
  });
  it('merchant-churn cannot evict the source-key velocity budget', () => {
    const { fw } = firewall(
      { requireIntent: { PA_SETTLEMENT: false } },
      {
        velocity: {
          perSourceKey: { count: 3, sumPaise: 1e12 },
          perMerchant: { count: 1e6, sumPaise: 1e15 },
          global: { count: 1e6, sumPaise: 1e15 },
          maxTrackedKeys: 4,
        },
      },
    );
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 100_00 }));
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm2', amountPaise: 100_00, timestampMs: T0 + 1 }));
    for (let k = 0; k < 6; k++)
      fw.evaluate(
        payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: `churn${k}`, amountPaise: 100_00, timestampMs: T0 + 2 + k }),
      );
    const v = fw.evaluate(
      payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm9', amountPaise: 100_00, timestampMs: T0 + 10 }),
    );
    assert.ok(ruleIds(v).includes('velocity.outflow'), 'the source-key ring must survive merchant churn');
  });
  it('state survives export/restore', () => {
    const cfg = { velocity: { perSourceKey: { count: 1, sumPaise: 1e12 } } };
    const { fw } = firewall({ requireIntent: { REFUND: false } }, cfg);
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00 }));
    const { fw: fw2 } = firewall({ requireIntent: { REFUND: false } }, cfg);
    fw2.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    assert.ok(
      ruleIds(fw2.evaluate(payout({ beneficiaryRef: B, kind: 'REFUND', amountPaise: 100_00, timestampMs: T0 + 1 }))).includes(
        'velocity.outflow',
      ),
    );
  });
});

describe('amount.band-anomaly', () => {
  it('reviews an amount far above the rolling band', () => {
    const { fw } = firewall(
      { requireIntent: { REFUND: false } },
      { band: { minSamples: 20 }, velocity: { perSourceKey: { count: 1e6, sumPaise: 1e15 }, global: { count: 1e6, sumPaise: 1e15 } } },
    );
    for (let k = 0; k < 40; k++)
      fw.evaluate(
        payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 1_000_00 + (k % 7) * 50_00, timestampMs: T0 - 60 * MIN + k * MIN }),
      );
    const v = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 3_00_000_00 }));
    assert.ok(ruleIds(v).includes('amount.band-anomaly'), JSON.stringify(v.hits));
    const ok = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 1_200_00 }));
    assert.ok(!ruleIds(ok).includes('amount.band-anomaly'));
  });
});

describe('settlement.*', () => {
  it('settlement.account-changed: merchant switches settlement account', () => {
    const { fw } = firewall({ requireIntent: { PA_SETTLEMENT: false } });
    fw.evaluate(
      payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 10_000_00, timestampMs: T0 - 3 * 24 * 60 * MIN }),
    );
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 10_000_00 }));
    assert.deepEqual(ruleIds(v), ['settlement.account-changed']);
    const later = fw.evaluate(
      payout({ beneficiaryRef: B, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 10_000_00, timestampMs: T0 + 60 * MIN }),
    );
    assert.deepEqual(ruleIds(later), ['settlement.account-changed']);
    const clear = fw.evaluate(
      payout({ beneficiaryRef: B, kind: 'PA_SETTLEMENT', merchantId: 'm1', amountPaise: 10_000_00, timestampMs: T0 + 25 * 60 * MIN }),
    );
    assert.deepEqual(ruleIds(clear), []);
  });
  it('settlement.account-changed: explicit notice from onboarding', () => {
    const { fw } = firewall({ requireIntent: { PA_SETTLEMENT: false } });
    fw.noteMerchantAccountChange('m2', B, T0 - 10 * MIN);
    const v = fw.evaluate(payout({ beneficiaryRef: B, kind: 'PA_SETTLEMENT', merchantId: 'm2', amountPaise: 10_000_00 }));
    assert.deepEqual(ruleIds(v), ['settlement.account-changed']);
    assert.equal(v.hits[0]!.evidence['minutesSinceChange'], 10);
  });
  it('settlement.over-captured: settlement above the reconciled net', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A, kind: 'PA_SETTLEMENT', maxAmountPaise: 8_00_000_00 });
    const v = fw.evaluate(
      payout({ beneficiaryRef: A, kind: 'PA_SETTLEMENT', merchantId: 'm1', intentId: i.intentId, amountPaise: 9_00_000_00 }),
    );
    assert.deepEqual(ruleIds(v), ['settlement.over-captured']);
    assert.equal(v.verdict, 'BLOCK');
  });
});

describe('origin.nonprod', () => {
  it('blocks a nonprod network origin even with a valid intent', () => {
    const { fw } = firewall();
    const i = intent(fw, { beneficiaryRef: A });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId, origin: 'nonprod' }));
    assert.deepEqual(ruleIds(v), ['origin.nonprod']);
  });
  it('blocks a UAT key id', () => {
    const { fw } = firewall({}, { origin: { nonProdKeyIds: ['lms-qa'] } });
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, sourceKeyId: 'uat_lms' }))), ['origin.nonprod']);
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, sourceKeyId: 'lms-qa' }))), ['origin.nonprod']);
  });
});

describe('identity.fingerprint', () => {
  it('enrols the first hint, stays quiet while it matches, reviews a change', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } });
    const p1 = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '10.0.0.7' }));
    assert.deepEqual(ruleIds(p1), ['identity.fingerprint']);
    assert.equal(p1.verdict, 'ALLOW', 'enrolment is evidence only');
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '10.0.0.7' })).hits.length, 0);
    const moved = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '203.0.113.9' }));
    assert.equal(moved.verdict, 'REVIEW');
    assert.equal(moved.hits[0]!.rule, 'identity.fingerprint');
    assert.equal(moved.hits[0]!.evidence['previousHint'], '10.0.0.7');
  });
  it('no hint → the rule stays out of the way entirely', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } });
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00 })).hits.length, 0);
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00 })).hits.length, 0);
  });
  it('onChange: evidence logs the change without holding the payout', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } }, { fingerprint: { onChange: 'evidence' } });
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '10.0.0.7' }));
    const v = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '203.0.113.9' }));
    assert.equal(v.verdict, 'ALLOW');
    assert.deepEqual(ruleIds(v), ['identity.fingerprint']);
  });
  it('enrolment survives export/restore', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } });
    fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '10.0.0.7' }));
    const { fw: fw2 } = firewall({ requireIntent: { REFUND: false } });
    fw2.restoreState(JSON.parse(JSON.stringify(fw.exportState())));
    assert.equal(
      fw2.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '10.0.0.7' })).hits.length,
      0,
      'restored fingerprint means no enrolment hit',
    );
    assert.equal(
      fw2.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceHint: '172.16.0.1' })).verdict,
      'REVIEW',
    );
  });
});

describe('origin.mismatch', () => {
  it('reviews a caller declared nonprod arriving on a prod route — a name the block lists do not know', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } }, { origin: { keyOrigins: { 'lms-uat': 'nonprod' } } });
    const v = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceKeyId: 'lms-uat' }));
    assert.deepEqual(ruleIds(v), ['origin.mismatch']);
    assert.equal(v.verdict, 'REVIEW');
    assert.equal(v.hits[0]!.evidence['expected'], 'nonprod');
    assert.equal(v.hits[0]!.evidence['actual'], 'prod');
  });
  it('matching declarations and unlisted callers stay quiet', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } }, { origin: { keyOrigins: { 'lms-prod': 'prod' } } });
    assert.deepEqual(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00 })).hits, []);
    assert.deepEqual(fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, sourceKeyId: 'unlisted' })).hits, []);
  });
  it('a prod-declared caller on a nonprod route BLOCKs at origin.nonprod first', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } }, { origin: { keyOrigins: { 'lms-prod': 'prod' } } });
    const v = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, origin: 'nonprod' }));
    assert.deepEqual(ruleIds(v), ['origin.nonprod']);
  });
});

describe('canary.tripped', () => {
  it('blocks, raises HIGH_ALERT, and the next unbound payout of an exempt kind is blocked too', () => {
    const { fw } = firewall({ requireIntent: { REFUND: false } });
    fw.addCanaries({ beneficiaryRefs: [ref('canary@okbank')] }, admin);
    const v = fw.evaluate(payout({ beneficiaryRef: ref('canary@okbank'), kind: 'REFUND', amountPaise: 100_00 }));
    assert.deepEqual(ruleIds(v), ['canary.tripped']);
    assert.equal(fw.alertState, 'HIGH_ALERT');
    const next = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, timestampMs: T0 + MIN }));
    assert.equal(next.alertState, 'HIGH_ALERT');
    assert.deepEqual(ruleIds(next), ['intent.missing']);
  });
  it('canary source key and intent id', () => {
    const { fw } = firewall();
    fw.addCanaries({ sourceKeyIds: ['honey-key'] }, admin);
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, sourceKeyId: 'honey-key' }))), ['canary.tripped']);
  });
});

describe('calendar.window', () => {
  it('adds evidence on weekends and nights, never changes the verdict by itself', () => {
    const { fw } = firewall();
    const sat = Date.UTC(2026, 10, 7, 5, 30);
    const i = intent(fw, { beneficiaryRef: A, notBeforeMs: sat - MIN, expiresAtMs: sat + MIN });
    const v = fw.evaluate(payout({ beneficiaryRef: A, intentId: i.intentId, amountPaise: 10_000_00, timestampMs: sat }));
    assert.equal(v.verdict, 'ALLOW');
    assert.deepEqual(ruleIds(v), ['calendar.window']);
    assert.equal(v.hits[0]!.evidence['window'], 'weekend');
  });
});

describe('feed.reputation', () => {
  it('reviews HIGH and blocks VERY_HIGH beneficiaries from an operator snapshot', () => {
    const { fw, feed } = firewall({ requireIntent: { REFUND: false } });
    feed.load(
      {
        version: 1,
        source: 'dot-fri',
        entries: [
          { mobile: '9876543210', band: 'HIGH' },
          { mobile: '+91 98765 43211', band: 'VERY_HIGH' },
        ],
      },
      'test-hash-key-0123456789abcdef',
      T0,
    );
    const high = fw.evaluate(
      payout({
        beneficiaryRef: A,
        kind: 'REFUND',
        amountPaise: 100_00,
        beneficiaryMobileRef: hashBeneficiary({ mobile: '9876543210' }, 'test-hash-key-0123456789abcdef'),
      }),
    );
    assert.equal(high.verdict, 'REVIEW');
    assert.deepEqual(ruleIds(high), ['feed.reputation']);
    const vh = fw.evaluate(
      payout({
        beneficiaryRef: A,
        kind: 'REFUND',
        amountPaise: 100_00,
        beneficiaryMobileRef: hashBeneficiary({ mobile: '9876543211' }, 'test-hash-key-0123456789abcdef'),
      }),
    );
    assert.equal(vh.verdict, 'BLOCK');
  });
  it('a malformed snapshot is refused and the old one stays live', () => {
    const { feed } = firewall();
    feed.load({ version: 1, entries: [{ mobile: '9876543210', band: 'HIGH' }] }, 'test-hash-key-0123456789abcdef');
    assert.throws(() => feed.load({ version: 1, entries: [{ band: 'NOPE' }] }));
    assert.equal(feed.size, 1);
  });
  it('matches any beneficiary ref — account+IFSC, VPA and VDA address, not just mobile', () => {
    const { fw, feed } = firewall({ requireIntent: { VENDOR_PAYOUT: false, VDA_WITHDRAWAL: false } });
    const acct = hashBeneficiary({ account: '123456789012', ifsc: 'HDFC0001234' }, HASH_KEY);
    const vpa = hashBeneficiary({ vpa: 'mule@okbank' }, HASH_KEY);
    const vda = hashBeneficiary({ address: '0xDEADbeef', network: 'ethereum' }, HASH_KEY);
    feed.load(
      {
        version: 1,
        source: 'i4c-cfcfrms',
        entries: [
          { ref: acct, band: 'VERY_HIGH' },
          { beneficiary: { vpa: 'mule@okbank' }, band: 'HIGH' },
          { ref: vda, band: 'VERY_HIGH' },
        ],
      },
      HASH_KEY,
      T0,
    );
    assert.equal(fw.evaluate(payout({ beneficiaryRef: acct, kind: 'VENDOR_PAYOUT', amountPaise: 100_00 })).verdict, 'BLOCK');
    const vp = fw.evaluate(payout({ beneficiaryRef: vpa, kind: 'VENDOR_PAYOUT', amountPaise: 100_00 }));
    assert.equal(vp.verdict, 'REVIEW');
    assert.equal(vp.hits[0]!.evidence['matched'], 'beneficiary');
    assert.equal(
      fw.evaluate(payout({ beneficiaryRef: vda, kind: 'VDA_WITHDRAWAL', channel: 'CRYPTO', amountPaise: 100_00 })).verdict,
      'BLOCK',
    );
  });
  it('a pre-hashed ref snapshot needs no hash key', () => {
    const { feed } = firewall();
    const acct = hashBeneficiary({ account: '123456789012', ifsc: 'HDFC0001234' }, HASH_KEY);
    assert.equal(feed.load({ version: 1, entries: [{ ref: acct, band: 'HIGH' }] }), 1);
  });
  it('when beneficiary and mobile both match, the worse band wins', () => {
    const { fw, feed } = firewall({ requireIntent: { REFUND: false } });
    const mobile = hashBeneficiary({ mobile: '9876543210' }, HASH_KEY);
    feed.load(
      {
        version: 1,
        entries: [
          { ref: A, band: 'MEDIUM' },
          { mobileRef: mobile, band: 'VERY_HIGH' },
        ],
      },
      undefined,
      T0,
    );
    const v = fw.evaluate(payout({ beneficiaryRef: A, kind: 'REFUND', amountPaise: 100_00, beneficiaryMobileRef: mobile }));
    assert.equal(v.verdict, 'BLOCK');
    assert.equal(v.hits[0]!.evidence['matched'], 'mobile');
  });
  it('refuses raw-looking refs and malformed beneficiary objects', () => {
    const { feed } = firewall();
    feed.load({ version: 1, entries: [{ mobile: '9876543210', band: 'HIGH' }] }, HASH_KEY);
    assert.throws(() => feed.load({ version: 1, entries: [{ ref: '123456789012', band: 'HIGH' }] }, HASH_KEY), /needs ref, beneficiary/);
    assert.throws(
      () => feed.load({ version: 1, entries: [{ beneficiary: { account: 'not-digits', ifsc: 'HDFC0001234' }, band: 'HIGH' }] }, HASH_KEY),
      /invalid identifier: account number/,
    );
    assert.equal(feed.size, 1);
  });
});

describe('client.unattested', () => {
  it('reviews VDA withdrawals without attestation when required', () => {
    const { fw } = firewall({ requireIntent: { VDA_WITHDRAWAL: false } }, { requireAttestation: ['VDA_WITHDRAWAL'] });
    assert.deepEqual(ruleIds(fw.evaluate(payout({ beneficiaryRef: A, kind: 'VDA_WITHDRAWAL', channel: 'CRYPTO', amountPaise: 100_00 }))), [
      'client.unattested',
    ]);
    assert.deepEqual(
      ruleIds(
        fw.evaluate(payout({ beneficiaryRef: A, kind: 'VDA_WITHDRAWAL', channel: 'CRYPTO', amountPaise: 100_00, clientAttested: true })),
      ),
      [],
    );
  });
});

describe('external.*', () => {
  it('advisory upstream signals only ever make verdicts stricter', () => {
    const { fw } = firewall({ requireIntent: { LOAN_DISBURSAL: false } });
    // Small amounts so only the external rule can fire (cooling stays quiet).
    const clean = payout({ beneficiaryRef: A, amountPaise: 100_00 });
    assert.equal(fw.evaluate(clean).verdict, 'ALLOW', 'no signal → untouched verdict');
    // Score bands.
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, riskScore: 0.95 })).hits[0]?.rule, 'external.score');
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, riskScore: 0.95 })).verdict, 'BLOCK');
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, riskScore: 0.75 })).verdict, 'REVIEW');
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, riskScore: 0.3 })).verdict, 'ALLOW');
    // Verdict words.
    assert.equal(
      fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, externalVerdict: 'decline', externalSource: 'feedzai' })).hits[0]?.rule,
      'external.verdict',
    );
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, externalVerdict: 'challenge' })).verdict, 'REVIEW');
    // Low/false claims are simply ignored — advisory means never-looser.
    assert.equal(fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, riskScore: 0, externalVerdict: 'allow' })).verdict, 'ALLOW');
    // A tuned deployment can move the bands.
    const strict = firewall({ requireIntent: { LOAN_DISBURSAL: false } }, { external: { reviewScore: 0.5, blockScore: 0.6 } });
    assert.equal(strict.fw.evaluate(payout({ beneficiaryRef: A, amountPaise: 100_00, riskScore: 0.62 })).verdict, 'BLOCK');
  });
});

describe('coverage', () => {
  it('every documented rule id is exercised by this file', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    for (const id of RULE_IDS) assert.ok(src.includes(`'${id}'`), `no test mentions ${id}`);
  });
});
