// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { generateIssuerKeyPair, hashBeneficiary, MemorySharedBackend, Payrekha, signIntent, type IntentKind } from '@payrekha/core';
import { auditRecord, createGateway, memoryDecisionLog, parseApiKeys, signWebhook, toCef, WebhookSender, type GatewayHandle } from '@payrekha/gateway';
import { payrekhaRules } from '@payrekha/rules';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const API = 'api-token-0123456789';
const UAT = 'uat-token-0123456789';
const ADMIN = 'admin-token-0123456789';
const EXT = 'ext-token-0123456789';
const EVALTOK = 'eval-token-0123456789';
const REGTOK = 'registrar-token-0123456789';
const PATOK = 'pa-scoped-token-0123456789';
const MINTTOK = 'minter-token-0123456789';
const HK = 'gateway-hash-key-0123456789';
const T0 = Date.UTC(2026, 10, 4, 5, 30);
const LOS = generateIssuerKeyPair();
const LOS2 = generateIssuerKeyPair();
const RISK = generateIssuerKeyPair();

function boot(mode: 'shadow' | 'enforce', extra: { intentVerificationsPerMinute?: number; requiredApprovals?: Partial<Record<IntentKind, number>>; mint?: boolean | { maxAmountPaise?: number; mintsPerMinute?: number; modes?: readonly ('shadow' | 'advise' | 'enforce')[] } } = {}) {
  const log = memoryDecisionLog();
  const fw = new Payrekha(payrekhaRules({ band: false }).rules, {
    config: { mode, adminTokenSha256: sha(ADMIN), ...(extra.requiredApprovals !== undefined ? { requiredApprovals: extra.requiredApprovals } : {}) },
    keys: [
      { keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519', publicKey: LOS.publicKey, kinds: ['LOAN_DISBURSAL', 'VERIFICATION'] },
      { keyId: 'los-2', issuer: 'los-prod', alg: 'ed25519', publicKey: LOS2.publicKey, kinds: ['LOAN_DISBURSAL'] },
      { keyId: 'risk-1', issuer: 'risk-desk', alg: 'ed25519', publicKey: RISK.publicKey, kinds: ['LOAN_DISBURSAL'] },
    ],
    now: () => T0,
  });
  const gw = createGateway({
    firewall: fw,
    apiKeys: [
      { id: 'lms-prod', sha256: sha(API), origin: 'prod' },
      { id: 'lms-uat', sha256: sha(UAT), origin: 'nonprod' },
      { id: 'eval-only', sha256: sha(EVALTOK), origin: 'prod', roles: ['evaluate'] },
      { id: 'registrar', sha256: sha(REGTOK), origin: 'prod', roles: ['intents'] },
      { id: 'pa-scoped', sha256: sha(PATOK), origin: 'prod', roles: ['evaluate'], merchantIds: ['merch-a'] },
      { id: 'minter', sha256: sha(MINTTOK), origin: 'prod', roles: ['mint'] },
    ],
    adminKeySha256: sha(ADMIN),
    hashKey: HK,
    decisionLog: log,
    now: () => T0,
    ...(extra.mint !== undefined && extra.mint !== false
      // gitleaks:allow — LOS2 is a per-run generated keypair, not a committed secret
      ? { mint: { keyId: 'los-2', key: { alg: 'ed25519' as const, privateKey: LOS2.privateKey }, defaultTtlMs: 60_000, maxTtlMs: 3_600_000, ...(typeof extra.mint === 'object' ? extra.mint : {}) } }
      : {}),
    ...(extra.intentVerificationsPerMinute !== undefined ? { intentVerificationsPerMinute: extra.intentVerificationsPerMinute } : {}),
    extAuthz: {
      origin: 'prod',
      keySha256: sha(EXT),
      mapping: {
        payoutId: 'body.request_id',
        kind: { const: 'LOAN_DISBURSAL' },
        amountPaise: 'body.amount_in_paise',
        intentId: 'header.x-payrekha-intent',
        approvalIds: 'header.x-payrekha-approvals',
        beneficiary: { account: 'body.beneficiary.account_number', ifsc: 'body.beneficiary.ifsc', address: 'body.beneficiary.address', network: 'body.beneficiary.network' },
        channel: { const: 'IMPS' },
        sourceKeyId: 'header.x-client-id',
        timestampMs: 'body.claimed_ts',
        sourceHint: 'header.x-forwarded-for',
      },
    },
  });
  return { fw, gw, log };
}

async function listen(gw: GatewayHandle): Promise<string> {
  await new Promise<void>((r) => gw.server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(gw.server.address() as AddressInfo).port}`;
}

const benRef = hashBeneficiary({ account: '000123456789', ifsc: 'HDFC0001234' }, HK);
const loanIntent = (id: string, keyId = 'los-1', privateKey: string = LOS.privateKey) =>
  signIntent(
    { intentId: id, kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: benRef, maxUses: 1, notBeforeMs: T0 - 60_000, expiresAtMs: T0 + 3_600_000, issuer: 'los-prod', keyId },
    { alg: 'ed25519', privateKey },
  );

describe('gateway (enforce)', () => {
  const { gw, log, fw } = boot('enforce');
  let url = '';
  before(async () => (url = await listen(gw)));
  after(() => gw.server.close());
  const post = (path: string, body: unknown, token = API, extra: Record<string, string> = {}) =>
    fetch(url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });

  it('health, readiness, request ids, auth', async () => {
    const h = await fetch(url + '/healthz');
    assert.equal(h.status, 200);
    assert.ok(h.headers.get('x-request-id'));
    const r = await fetch(url + '/readyz', { headers: { 'x-request-id': 'abc-123' } });
    assert.equal(r.headers.get('x-request-id'), 'abc-123');
    assert.equal((await post('/v1/evaluate', {}, 'wrong-token-000000')).status, 401);
    assert.equal((await fetch(url + '/metrics')).status, 401);
  });

  it('registers an intent and allows the matching payout; raw beneficiary hashed at entry and never logged', async () => {
    assert.equal((await post('/v1/intents', loanIntent('int-a'))).status, 201);
    const res = await post('/v1/evaluate', { payoutId: 'p-a', kind: 'LOAN_DISBURSAL', intentId: 'int-a', amountPaise: 2_40_000_00, beneficiary: { account: '000123456789', ifsc: 'HDFC0001234' }, channel: 'IMPS' });
    const v = (await res.json()) as { verdict: string; effectiveAction: string };
    assert.equal(v.verdict, 'ALLOW', JSON.stringify(v));
    const line = JSON.stringify(log.lines.at(-1));
    assert.ok(!line.includes('000123456789'));
    assert.ok(line.includes(benRef));
    assert.equal(log.lines.at(-1)!.sourceKeyId, 'lms-prod');
  });

  it('origin and sourceKeyId come from the key, not the body', async () => {
    const v = (await (await post('/v1/evaluate', { payoutId: 'p-u', kind: 'REFUND', amountPaise: 100_00, beneficiaryRef: benRef, channel: 'IMPS', origin: 'prod', sourceKeyId: 'lms-prod' }, UAT)).json()) as { hits: { rule: string }[] };
    assert.deepEqual(v.hits.map((h) => h.rule), ['origin.nonprod']);
  });

  it('sourceHint: the socket peer is stamped, a body-supplied hint is dropped', async () => {
    const res = await post('/v1/evaluate', { payoutId: 'p-sh', kind: 'REFUND', amountPaise: 100_00, beneficiaryRef: benRef, channel: 'IMPS', sourceHint: 'attacker-asserted-1.2.3.4' });
    assert.equal(res.status, 200);
    const line = log.lines.at(-1) as { sourceHint?: string };
    assert.equal(line.sourceHint, '127.0.0.1', 'the peer IP is the only honest hint on /v1/evaluate');
  });

  it('ext_authz: sourceHint maps from proxy headers and fingerprints token usage', async () => {
    await post('/v1/intents', loanIntent('int-fp1'));
    await post('/v1/intents', loanIntent('int-fp2'));
    const first = await post('/ext_authz/payouts',
      { request_id: 'fp-1', amount_in_paise: 24000000, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } },
      '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'int-fp1', 'x-client-id': 'fp-key', 'x-forwarded-for': '198.51.100.7' });
    assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
    assert.equal(first.headers.get('x-payrekha-rules'), 'identity.fingerprint', 'first hint enrols as evidence');
    assert.equal((log.lines.at(-1) as { sourceHint?: string }).sourceHint, '198.51.100.7');
    const moved = await post('/ext_authz/payouts',
      { request_id: 'fp-2', amount_in_paise: 24000000, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } },
      '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'int-fp2', 'x-client-id': 'fp-key', 'x-forwarded-for': '203.0.113.9' });
    assert.equal(moved.status, 403, 'a changed hint REVIEWs → HOLD in enforce');
    assert.equal(moved.headers.get('x-payrekha-rules'), 'identity.fingerprint');
  });

  it('unparseable body → degraded REVIEW, never ALLOW', async () => {
    const res = await fetch(url + '/v1/evaluate', { method: 'POST', headers: { authorization: `Bearer ${API}` }, body: '{not json' });
    const v = (await res.json()) as { verdict: string; degraded: boolean };
    assert.equal(v.verdict, 'REVIEW');
    assert.equal(v.degraded, true);
  });

  it('ext_authz: 200 for a bound payout, 403 + headers for an unbound one', async () => {
    await post('/v1/intents', loanIntent('int-x'));
    const ok = await post('/ext_authz/payouts', { request_id: 'x-1', amount_in_paise: '24000000', beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } }, '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'int-x', 'x-client-id': 'lms' });
    assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
    assert.equal(ok.headers.get('x-payrekha-verdict'), 'ALLOW');
    const bad = await post('/ext_authz/payouts', { request_id: 'x-2', amount_in_paise: 24000000, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } }, '', { 'x-payrekha-key': EXT });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get('x-payrekha-verdict'), 'BLOCK');
    assert.equal(bad.headers.get('x-payrekha-rules'), 'intent.missing');
    assert.equal((await post('/ext_authz/payouts', {}, '', {})).status, 401);
  });

  it('ext_authz: crypto beneficiary (address+network) hashes to a vda ref and binds intents', async () => {
    const vdaRef = hashBeneficiary({ address: 'bc1qexample0address0for0tests', network: 'BTC' }, HK);
    const intent = signIntent(
      { intentId: 'int-crypto', kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: vdaRef, maxUses: 1, notBeforeMs: T0 - 60_000, expiresAtMs: T0 + 3_600_000, issuer: 'los-prod', keyId: 'los-1' },
      { alg: 'ed25519', privateKey: LOS.privateKey },
    );
    await post('/v1/intents', intent);
    const res = await post('/ext_authz/payouts',
      { request_id: 'c-1', amount_in_paise: '5000', beneficiary: { address: 'bc1qexample0address0for0tests', network: 'BTC' } },
      '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'int-crypto', 'x-client-id': 'lms' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.equal(res.headers.get('x-payrekha-verdict'), 'ALLOW');
  });

  it('state: GET with api key, PUT needs admin + reason; HIGH_ALERT raise/reset audited', async () => {
    const g = (await (await fetch(url + '/v1/state', { headers: { authorization: `Bearer ${API}` } })).json()) as { mode: string };
    assert.equal(g.mode, 'enforce');
    const put = (body: unknown, token: string) => fetch(url + '/v1/state', { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await put({ highAlert: 'raise', reason: 'x' }, API)).status, 401);
    assert.equal((await put({ highAlert: 'raise' }, ADMIN)).status, 400);
    assert.equal(((await (await put({ highAlert: 'raise', reason: 'drill', actor: 'soc' }, ADMIN)).json()) as { alertState: string }).alertState, 'HIGH_ALERT');
    assert.equal(((await (await put({ highAlert: 'reset', reason: 'drill over', actor: 'soc' }, ADMIN)).json()) as { alertState: string }).alertState, 'NORMAL');
    assert.ok(fw.auditTrail().some((e) => e.action === 'alert.reset'));
  });

  it('canaries (admin) and outcomes', async () => {
    const c = await fetch(url + '/v1/canaries', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ beneficiaries: [{ vpa: 'canary@okbank' }], reason: 'apk canary' }) });
    assert.equal(c.status, 201);
    const raw = await fetch(url + '/v1/canaries', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ beneficiaryRefs: ['canary@okbank'] }) });
    assert.equal(raw.status, 400);
    const o = (await (await post('/v1/outcomes', { payoutId: 'p-a', outcome: 'settled' })).json()) as { known: boolean };
    assert.equal(o.known, true);
  });

  it('roles: an evaluate-only key cannot register intents or read; a registrar cannot evaluate', async () => {
    assert.equal((await post('/v1/intents', loanIntent('int-r1'), EVALTOK)).status, 403);
    assert.equal((await fetch(url + '/metrics', { headers: { authorization: `Bearer ${EVALTOK}` } })).status, 403);
    assert.equal((await fetch(url + '/v1/state', { headers: { authorization: `Bearer ${EVALTOK}` } })).status, 403);
    assert.equal((await post('/v1/evaluate', { payoutId: 'p-r1', kind: 'REFUND', amountPaise: 100_00, beneficiaryRef: benRef, channel: 'IMPS' }, REGTOK)).status, 403);
    assert.equal((await post('/v1/intents', loanIntent('int-r2'), REGTOK)).status, 201);
    assert.equal((await post('/v1/evaluate', { payoutId: 'p-r2', kind: 'REFUND', amountPaise: 100_00, beneficiaryRef: benRef, channel: 'IMPS' }, EVALTOK)).status, 200);
  });

  it('merchant scope: a scoped key cannot mint or impersonate merchants', async () => {
    const settle = (mid?: string, token = PATOK, payoutId = 'p-ms1') =>
      post('/v1/evaluate', { payoutId, kind: 'PA_SETTLEMENT', amountPaise: 100_00, beneficiaryRef: benRef, channel: 'IMPS', ...(mid !== undefined ? { merchantId: mid } : {}) }, token);
    assert.equal((await settle('merch-b')).status, 403, 'out-of-scope merchantId refused');
    assert.equal((await settle(undefined, PATOK, 'p-ms2')).status, 403, 'PA_SETTLEMENT without merchantId refuses under a scoped key');
    assert.equal((await settle('merch-a', PATOK, 'p-ms3')).status, 200, 'in-scope merchantId allowed');
    const refund = await post('/v1/evaluate', { payoutId: 'p-ms4', kind: 'REFUND', amountPaise: 100_00, beneficiaryRef: benRef, channel: 'IMPS' }, PATOK);
    assert.equal(refund.status, 200, 'non-settlement kinds need no merchantId');
    // An unscoped key is unaffected.
    assert.equal((await settle('merch-b', API, 'p-ms5')).status, 200);
  });

  it('DELETE /v1/issuers/:keyId revokes a signing key at runtime (admin + reason, audited)', async () => {
    assert.equal((await post('/v1/intents', loanIntent('int-rev', 'los-2', LOS2.privateKey))).status, 201);
    const alive = (await (await post('/v1/evaluate', { payoutId: 'p-rev', kind: 'LOAN_DISBURSAL', intentId: 'int-rev', amountPaise: 2_40_000_00, beneficiary: { account: '000123456789', ifsc: 'HDFC0001234' }, channel: 'IMPS' })).json()) as { verdict: string };
    assert.equal(alive.verdict, 'ALLOW');
    const del = (body: unknown, token = ADMIN) => fetch(url + '/v1/issuers/los-2', { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await del({ reason: 'x' }, API)).status, 401);
    assert.equal((await del({})).status, 400);
    const gone = (await (await del({ actor: 'soc', reason: 'los-2 private key leaked' })).json()) as { revoked: boolean };
    assert.equal(gone.revoked, true);
    const bad = await fetch(url + '/v1/issuers/%e0%a4%a', { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ reason: 'bad encoding' }) });
    assert.equal(bad.status, 400, 'malformed percent-encoding must be a 400, not a 500');
    const miss = await fetch(url + '/v1/issuers/no-such-key', { method: 'DELETE', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ reason: 'typo check' }) });
    assert.equal(miss.status, 404, 'revoking an unknown key is a miss');
    const dead = (await (await post('/v1/evaluate', { payoutId: 'p-rev-2', kind: 'LOAN_DISBURSAL', intentId: 'int-rev', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS' })).json()) as { verdict: string; hits: { rule: string }[] };
    assert.equal(dead.verdict, 'BLOCK');
    assert.ok(dead.hits.some((h) => h.rule === 'intent.bad-signature'), JSON.stringify(dead.hits));
    assert.ok(fw.auditTrail().some((e) => e.action === 'key.revoked' && e.actor === 'soc'));
  });

  it('caller timestamps are evidence, not the decision clock (gateway stamps server time)', async () => {
    // Intent valid only 1-2h after T0; the caller claims a time inside that window.
    const future = signIntent(
      { intentId: 'int-future', kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: benRef, maxUses: 1, notBeforeMs: T0 + 3_600_000, expiresAtMs: T0 + 7_200_000, issuer: 'los-prod', keyId: 'los-1' },
      { alg: 'ed25519', privateKey: LOS.privateKey },
    );
    assert.equal((await post('/v1/intents', future)).status, 201);
    const res = await post('/v1/evaluate', { payoutId: 'p-ts', kind: 'LOAN_DISBURSAL', intentId: 'int-future', amountPaise: 2_40_000_00, beneficiary: { account: '000123456789', ifsc: 'HDFC0001234' }, channel: 'IMPS', timestampMs: T0 + 5_400_000 });
    const v = (await res.json()) as { verdict: string; hits: { rule: string }[] };
    assert.equal(v.verdict, 'BLOCK');
    assert.ok(v.hits.some((h) => h.rule === 'intent.expired'), JSON.stringify(v.hits));
    assert.equal((log.lines.at(-1) as { clientTimestampMs?: number }).clientTimestampMs, T0 + 5_400_000);
  });

  it('outcomes bind to the evaluating key: another key cannot free its intent', async () => {
    assert.equal((await post('/v1/intents', loanIntent('int-bind'))).status, 201);
    const first = (await (await post('/v1/evaluate', { payoutId: 'p-bind', kind: 'LOAN_DISBURSAL', intentId: 'int-bind', amountPaise: 2_40_000_00, beneficiary: { account: '000123456789', ifsc: 'HDFC0001234' }, channel: 'IMPS' })).json()) as { verdict: string };
    assert.equal(first.verdict, 'ALLOW');
    const denied = (await (await post('/v1/outcomes', { payoutId: 'p-bind', outcome: 'failed' }, UAT)).json()) as { known: boolean };
    assert.equal(denied.known, false);
    const replay = (await (await post('/v1/evaluate', { payoutId: 'p-bind-2', kind: 'LOAN_DISBURSAL', intentId: 'int-bind', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS' })).json()) as { hits: { rule: string }[] };
    assert.ok(replay.hits.some((h) => h.rule === 'intent.reused'), JSON.stringify(replay.hits));
    const released = (await (await post('/v1/outcomes', { payoutId: 'p-bind', outcome: 'failed' })).json()) as { known: boolean };
    assert.equal(released.known, true);
    const third = (await (await post('/v1/evaluate', { payoutId: 'p-bind-3', kind: 'LOAN_DISBURSAL', intentId: 'int-bind', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS' })).json()) as { verdict: string };
    assert.equal(third.verdict, 'ALLOW');
    assert.ok(fw.auditTrail().some((e) => e.action === 'outcome.denied'));
  });

  it('ext_authz: a claimed_ts in the body is kept as clientTimestampMs evidence, not honoured', async () => {
    assert.equal((await post('/v1/intents', loanIntent('int-ts'))).status, 201);
    // int-ts is valid at T0 but expired by T0+2.5h — trusting claimed_ts would flip this to BLOCK.
    const res = await post('/ext_authz/payouts', { request_id: 'x-ts', amount_in_paise: 24000000, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' }, claimed_ts: T0 + 9_000_000 }, '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'int-ts', 'x-client-id': 'lms' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.equal((log.lines.at(-1) as { clientTimestampMs?: number }).clientTimestampMs, T0 + 9_000_000);
  });

  it('metrics in Prometheus text', async () => {
    const t = await (await fetch(url + '/metrics', { headers: { authorization: `Bearer ${API}` } })).text();
    assert.match(t, /payrekha_verdicts_total\{verdict="BLOCK"\} \d+/);
    assert.match(t, /payrekha_rule_hits_total\{rule="intent.missing"\} \d+/);
    assert.match(t, /payrekha_eval_latency_micros_bucket\{le="\+Inf"\}/);
  });
});

describe('gateway (enforce): analyst read surface', () => {
  const { gw } = boot('enforce');
  let url = '';
  before(async () => (url = await listen(gw)));
  after(() => gw.server.close());
  const get = (p: string, tok = API) => fetch(url + p, { headers: { authorization: `Bearer ${tok}` } });
  it('decisions ring, intent lookup and audit entries serve consoles — read role only', async () => {
    // Register + evaluate so the ring has a BLOCK and an ALLOW to filter on.
    await fetch(url + '/v1/intents', { method: 'POST', headers: { authorization: `Bearer ${REGTOK}`, 'content-type': 'application/json' }, body: JSON.stringify(loanIntent('an-1')) });
    const post = (b: unknown) => fetch(url + '/v1/evaluate', { method: 'POST', headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const v1 = (await (await post({ payoutId: 'an-p1', kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS', intentId: 'an-1' })).json()) as { verdict: string; riskScore: number };
    assert.equal(v1.verdict, 'ALLOW');
    assert.equal(typeof v1.riskScore, 'number', 'verdicts carry the deterministic risk score');
    await post({ payoutId: 'an-p2', kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS' });

    const dec = (await (await get('/v1/decisions')).json()) as { decisions: { payoutId: string; verdict: string }[]; total: number };
    assert.equal(dec.decisions[0]?.payoutId, 'an-p2', 'newest first');
    const blocked = (await (await get('/v1/decisions?verdict=BLOCK')).json()) as { decisions: { verdict: string }[] };
    assert.ok(blocked.decisions.length > 0 && blocked.decisions.every((d) => d.verdict === 'BLOCK'), 'verdict filter');
    const byPid = (await (await get('/v1/decisions?payoutId=an-p1')).json()) as { decisions: { payoutId: string }[] };
    assert.equal(byPid.decisions.length, 1);

    const it1 = (await (await get('/v1/intents/an-1')).json()) as { intent: { intentId: string; signature?: string }; uses: number; verification: string };
    assert.equal(it1.intent.intentId, 'an-1');
    assert.equal(it1.uses, 1, 'the evaluate consumed the intent');
    assert.equal(it1.verification, 'ok');
    assert.equal(it1.intent.signature, undefined, 'signature is not served to readers');
    assert.equal((await get('/v1/intents/nope')).status, 404);
    assert.equal((await get('/v1/intents/%zz')).status, 400, 'malformed escape → 400 not 500');

    const au = (await (await get('/v1/audit')).json()) as { audit: { action: string }[] };
    assert.ok(Array.isArray(au.audit));
    // Role discipline: an evaluate-only key cannot read the analyst surface.
    assert.equal((await get('/v1/decisions', EVALTOK)).status, 403);
    assert.equal((await get('/v1/audit', EVALTOK)).status, 403);
    assert.equal((await get('/v1/intents/an-1', EVALTOK)).status, 403);
  });
});
describe('gateway (enforce): managed intents', () => {
  const { gw, fw } = boot('enforce', { mint: true });
  let url = '';
  before(async () => (url = await listen(gw)));
  after(() => gw.server.close());
  const mint = (body: unknown, tok = MINTTOK) => fetch(url + '/v1/intents/mint', { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  it('mint → evaluate round-trip; retries are idempotent; scope and roles hold', async () => {
    // The LOS sends payout-shaped JSON — raw beneficiary fields get hashed at
    // entry. los-2 may only mint LOAN_DISBURSAL.
    const body = { kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiary: { account: '000123456789', ifsc: 'HDFC0001234' }, subjectRef: 'loan-007' };
    const r1 = await mint(body);
    assert.equal(r1.status, 201);
    const m1 = (await r1.json()) as { accepted: boolean; intentId: string };
    assert.equal(m1.accepted, true);
    assert.ok(m1.intentId.length > 0);
    const m2 = (await (await mint(body)).json()) as { intentId: string };
    assert.equal(m2.intentId, m1.intentId, 'identical fields derive the same intentId');
    // The minted intent actually authorises the payout it describes.
    const v = (await (await fetch(url + '/v1/evaluate', {
      method: 'POST',
      headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payoutId: 'mint-p1', kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS', intentId: m1.intentId }),
    })).json()) as { verdict: string };
    assert.equal(v.verdict, 'ALLOW');
    // Negative paths.
    assert.equal((await mint({ ...body, kind: 'VDA_WITHDRAWAL' })).status, 422, 'mint key kind scope is enforced');
    assert.equal((await mint({ ...body, ttlMs: 99_999_999 })).status, 400, 'ttl above maxTtlMs refused');
    assert.equal((await mint({ kind: 'LOAN_DISBURSAL' })).status, 400, 'missing amount/ref');
    assert.equal((await mint(body, EVALTOK)).status, 403, 'evaluate role cannot mint');
    assert.equal((await fetch(url + '/v1/intents', { method: 'POST', headers: { authorization: `Bearer ${MINTTOK}`, 'content-type': 'application/json' }, body: JSON.stringify(loanIntent('m-x')) })).status, 403, 'mint role cannot register foreign-signed intents');
    assert.equal(fw.intents.get(m1.intentId)?.intent.issuer, 'los-prod');
  });
});
describe('gateway (enforce): mint guardrails', () => {
  const mintBody = { kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiaryRef: benRef };
  const call = (base: string, body: unknown = mintBody) => fetch(`${base}/v1/intents/mint`, { method: 'POST', headers: { authorization: `Bearer ${MINTTOK}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  it('amount ceiling refuses, per-key rate limits, mode allowlist blocks enforce mints', async () => {
    const { gw } = boot('enforce', { mint: { maxAmountPaise: 3_00_000_00, mintsPerMinute: 3 } });
    const u1 = await listen(gw);
    try {
      assert.equal((await call(u1, { ...mintBody, amountPaise: 3_00_000_01 })).status, 400, 'above the mint ceiling refused');
      assert.equal((await call(u1)).status, 201);
      assert.equal((await call(u1)).status, 201);
      assert.equal((await call(u1)).status, 429, 'fourth mint inside the minute is rate-limited');
    } finally {
      gw.server.close();
    }
    const { gw: gw2 } = boot('enforce', { mint: { modes: ['shadow', 'advise'] } });
    const u2 = await listen(gw2);
    try {
      const r = await call(u2);
      assert.equal(r.status, 403, 'minting refused while the kind is in enforce');
      assert.match(((await r.json()) as { error?: string }).error ?? '', /enforce mode/);
    } finally {
      gw2.server.close();
    }
    const { gw: gw3 } = boot('shadow', { mint: { modes: ['shadow', 'advise'] } });
    const u3 = await listen(gw3);
    try {
      assert.equal((await call(u3)).status, 201, 'same allowlist mints in shadow');
    } finally {
      gw3.server.close();
    }
  });
});
describe('gateway (enforce): multi-approval payouts', () => {
  const { gw, log } = boot('enforce', { requiredApprovals: { LOAN_DISBURSAL: 2 } });
  let url = '';
  before(async () => (url = await listen(gw)));
  after(() => gw.server.close());
  const post = (path: string, body: unknown, tok = API, extra: Record<string, string> = {}) =>
    fetch(url + path, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const approvalIntent = (id: string) =>
    signIntent({ intentId: id, kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: benRef, maxUses: 1, notBeforeMs: T0 - 60_000, expiresAtMs: T0 + 3_600_000, issuer: 'risk-desk', keyId: 'risk-1' }, { alg: 'ed25519', privateKey: RISK.privateKey });
  const evalBody = (payoutId: string, extra: Record<string, unknown> = {}) => ({ payoutId, kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS', ...extra });

  it('primary alone declines; citing a distinct-issuer approval allows', async () => {
    assert.equal((await post('/v1/intents', loanIntent('ma-p1'), REGTOK)).status, 201);
    assert.equal((await post('/v1/intents', approvalIntent('ma-a1'), REGTOK)).status, 201);
    const v1 = (await (await post('/v1/evaluate', evalBody('ma-x1', { intentId: 'ma-p1' }))).json()) as { verdict: string; hits: { rule: string }[] };
    assert.equal(v1.verdict, 'BLOCK');
    assert.ok(v1.hits.some((h) => h.rule === 'intent.approvals-insufficient'), JSON.stringify(v1.hits));
    const v2 = (await (await post('/v1/evaluate', evalBody('ma-x2', { intentId: 'ma-p1', approvalIds: ['ma-a1'] }))).json()) as { verdict: string };
    assert.equal(v2.verdict, 'ALLOW', 'the declined first attempt consumed nothing — retry with the approval works');
  });
  it('ext_authz maps a comma-joined approvals header', async () => {
    assert.equal((await post('/v1/intents', loanIntent('ma-p2'), REGTOK)).status, 201);
    assert.equal((await post('/v1/intents', approvalIntent('ma-a2'), REGTOK)).status, 201);
    const res = await post('/ext_authz/payouts', { request_id: 'ma-x3', amount_in_paise: 24000000, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } }, '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'ma-p2', 'x-payrekha-approvals': 'ma-a2', 'x-client-id': 'lms' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    assert.equal((log.lines.at(-1) as { verdict?: string }).verdict, 'ALLOW', 'both ids mapped through and satisfied the requirement');
    const res2 = await post('/ext_authz/payouts', { request_id: 'ma-x4', amount_in_paise: 24000000, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } }, '', { 'x-payrekha-key': EXT, 'x-payrekha-intent': 'ma-p2', 'x-client-id': 'lms' });
    assert.equal(res2.status, 403, 'primary alone is insufficient — and already consumed anyway');
    assert.equal((log.lines.at(-1) as { verdict?: string }).verdict, 'BLOCK');
  });
});
describe('gateway (enforce): intent verification budget', () => {
  const { gw } = boot('enforce', { intentVerificationsPerMinute: 3 });
  let url = '';
  before(async () => (url = await listen(gw)));
  after(() => gw.server.close());
  it('429 when a key spends its per-minute verification budget', async () => {
    const post = (body: unknown) => fetch(url + '/v1/intents', { method: 'POST', headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(loanIntent('int-b1'))).status, 201);
    assert.equal((await post(loanIntent('int-b2'))).status, 201);
    assert.equal((await post([loanIntent('int-b3'), loanIntent('int-b4')])).status, 429, 'would exceed the budget — no partial processing');
    assert.equal((await post(loanIntent('int-b5'))).status, 201, 'lands exactly on the budget');
    assert.equal((await post(loanIntent('int-b6'))).status, 429, 'one over the budget is refused');
  });
});

describe('gateway (shadow)', () => {
  it('ext_authz always returns 200 but logs the calculated BLOCK', async () => {
    const { gw, log } = boot('shadow');
    const url = await listen(gw);
    const res = await fetch(url + '/ext_authz/payouts', { method: 'POST', headers: { 'x-payrekha-key': EXT }, body: JSON.stringify({ request_id: 's-1', amount_in_paise: 100, beneficiary: { account_number: '000123456789', ifsc: 'HDFC0001234' } }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-payrekha-verdict'), 'BLOCK');
    assert.equal(log.lines.at(-1)!.verdict, 'BLOCK');
    assert.equal(log.lines.at(-1)!.effectiveAction, 'ALLOW');
    gw.server.close();
  });
});

describe('webhooks and CEF', () => {
  it('signed, retried, never blocks', async () => {
    const got: { sig: string; ts: string; body: string }[] = [];
    let fails = 1;
    const srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        if (fails-- > 0) return void res.writeHead(500).end();
        got.push({ sig: String(req.headers['x-payrekha-signature']), ts: String(req.headers['x-payrekha-timestamp']), body: b });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const w = new WebhookSender({ url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/hook`, secret: 'webhook-secret-0123456789' });
    const t = performance.now();
    w.send({ type: 'alert.entered', atMs: T0, actor: 'rule:canary.tripped', reason: 'x' });
    assert.ok(performance.now() - t < 5);
    await w.idle();
    srv.close();
    assert.equal(got.length, 1);
    assert.equal(got[0]!.sig, signWebhook('webhook-secret-0123456789', got[0]!.ts, got[0]!.body));
    assert.equal(got[0]!.sig, `sha256=${createHmac('sha256', 'webhook-secret-0123456789').update(`${got[0]!.ts}.${got[0]!.body}`).digest('hex')}`);
  });
  it('CEF escapes header and extension fields', () => {
    const line = toCef({ type: 'decision' as const, ts: new Date(T0).toISOString(), requestId: 'r', decisionId: 'd', payoutId: 'p=1|x', via: 'evaluate', mode: 'enforce', alertState: 'NORMAL', verdict: 'BLOCK', effectiveAction: 'DECLINE', degraded: false, deduped: false, rules: ['intent.missing'], hits: [{ rule: 'intent.missing', verdict: 'BLOCK', reason: 'a|b', evidence: {} }], ruleErrors: [], elapsedMicros: 3 });
    assert.match(line, /^CEF:0\|People of Product\|Payrekha\|0\.1\.0\|intent\.missing\|a\\\|b\|9\|/);
    assert.ok(line.includes('cs1=p\\=1|x'));
  });
});

describe('bootFromEnv state loading', () => {
  it('serves 503 until the snapshot is read, never saves while unready, then recovers HIGH_ALERT', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { bootFromEnv } = await import('@payrekha/gateway');
    const dir = mkdtempSync(join(tmpdir(), 'prk-'));
    const file = join(dir, 'state.json');
    const env = { PAYREKHA_API_KEYS: `lms:prod:${API}`, PAYREKHA_ADMIN_KEY: ADMIN, PAYREKHA_STATE_FILE: file, PAYREKHA_STATE_RETRY_MS: '60000' };
    const quiet = () => undefined;

    const a = bootFromEnv(env, quiet);
    assert.equal(a.gateway.stats.ready, false);
    await a.stateLoaded;
    assert.equal(a.gateway.stats.ready, true);
    a.firewall.raiseHighAlert('test', 'canary');
    assert.equal(await a.gateway.saveState(), true);

    const b = bootFromEnv(env, quiet);
    await b.stateLoaded;
    assert.equal(b.firewall.alertState, 'HIGH_ALERT');

    writeFileSync(file, '{not json');
    const c = bootFromEnv(env, quiet);
    await c.stateLoaded;
    assert.equal(c.gateway.stats.ready, false);
    assert.equal(c.gateway.stats.notReadyReason, 'state unreadable');
    assert.equal(await c.gateway.saveState(), false, 'must not overwrite an unreadable snapshot');
  });

  it('rejects both state backends at once', async () => {
    const { bootFromEnv } = await import('@payrekha/gateway');
    assert.throws(() => bootFromEnv({ PAYREKHA_API_KEYS: `lms:prod:${API}`, PAYREKHA_STATE_FILE: '/tmp/x', PAYREKHA_STATE_PG_URL: 'postgres://x' }, () => undefined), /not both/);
  });
});

describe('audit records and key parsing', () => {
  it('auditRecord stamps type:audit with ts/actor/action/reason', () => {
    const r = auditRecord({ atMs: T0, action: 'mode.set', actor: 'soc', reason: 'drill' });
    assert.equal(r.type, 'audit');
    assert.equal(r.action, 'mode.set');
    assert.equal(r.actor, 'soc');
    assert.equal(r.reason, 'drill');
    assert.equal(r.ts, '2026-11-04T05:30:00.000Z');
  });
  it('parseApiKeys reads an optional role list and keeps colon-bearing tokens', () => {
    const keyed = parseApiKeys('lms:prod:evaluate+read:tok-0123456789ab');
    assert.equal(keyed[0]?.id, 'lms');
    assert.deepEqual(keyed[0]?.roles, ['evaluate', 'read']);
    const legacy = parseApiKeys('lms:prod:tok:with:colons-0123');
    assert.equal(legacy[0]?.roles, undefined);
    assert.equal(legacy[0]?.sha256, sha('tok:with:colons-0123'));
  });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('shared state (ADR 0004 active-active)', () => {
  // Two gateways on one backend = two replicas on one authoritative store.
  // controlPollMs stays huge so every convergence in this suite is provably
  // commit-driven, except the fail-closed test which needs poll recovery.
  const backend = new MemorySharedBackend();
  const issuerKeys = [
    { keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519' as const, publicKey: LOS.publicKey, kinds: ['LOAN_DISBURSAL' as const, 'VERIFICATION' as const] },
    { keyId: 'los-2', issuer: 'los-prod', alg: 'ed25519' as const, publicKey: LOS2.publicKey, kinds: ['LOAN_DISBURSAL' as const] },
    { keyId: 'risk-1', issuer: 'risk-desk', alg: 'ed25519' as const, publicKey: RISK.publicKey, kinds: ['LOAN_DISBURSAL' as const] },
  ];
  const replica = (pollMs: number) => {
    const fw = new Payrekha(payrekhaRules({ band: false }).rules, {
      config: { mode: 'enforce', adminTokenSha256: sha(ADMIN) },
      keys: issuerKeys,
      now: () => T0,
    });
    return createGateway({
      firewall: fw,
      apiKeys: [
        { id: 'lms', sha256: sha(API), origin: 'prod' },
        { id: 'reg', sha256: sha(REGTOK), origin: 'prod', roles: ['intents'] },
      ],
      adminKeySha256: sha(ADMIN),
      hashKey: HK,
      sharedState: { backend, controlPollMs: pollMs },
      now: () => T0,
    });
  };
  const pair = { a: replica(3_600_000), b: replica(3_600_000) };
  const urls: Record<string, string> = {};
  before(async () => {
    urls['a'] = await listen(pair.a);
    urls['b'] = await listen(pair.b);
  });
  after(async () => {
    pair.a.server.close();
    pair.b.server.close();
    await pair.a.closeShared();
    await pair.b.closeShared();
  });
  const call = (side: 'a' | 'b', path: string, body: unknown, token = API, method = 'POST') =>
    fetch(urls[side]! + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const loan = { kind: 'LOAN_DISBURSAL', amountPaise: 2_40_000_00, beneficiaryRef: benRef, channel: 'IMPS' };

  it('an intent registered on replica A is consumable on replica B (miss-fetch)', async () => {
    assert.equal((await call('a', '/v1/intents', loanIntent('int-s1'), REGTOK)).status, 201);
    const v = (await (await call('b', '/v1/evaluate', { payoutId: 'p-s1', intentId: 'int-s1', ...loan })).json()) as { verdict: string };
    assert.equal(v.verdict, 'ALLOW', JSON.stringify(v));
  });

  it('two replicas cannot spend the same intent use', async () => {
    await call('a', '/v1/intents', loanIntent('int-s2'), REGTOK);
    const first = (await (await call('a', '/v1/evaluate', { payoutId: 'p-s2a', intentId: 'int-s2', ...loan })).json()) as { verdict: string };
    assert.equal(first.verdict, 'ALLOW');
    const second = (await (await call('b', '/v1/evaluate', { payoutId: 'p-s2b', intentId: 'int-s2', ...loan })).json()) as { verdict: string; hits: { rule: string }[] };
    assert.equal(second.verdict, 'BLOCK', JSON.stringify(second));
    assert.ok(second.hits.some((h) => h.rule === 'intent.reused'));
  });

  it('a payoutId duplicated across replicas replays the stored verdict', async () => {
    await call('a', '/v1/intents', loanIntent('int-s3'), REGTOK);
    const first = (await (await call('a', '/v1/evaluate', { payoutId: 'p-dup', intentId: 'int-s3', ...loan })).json()) as { decisionId: string; verdict: string };
    assert.equal(first.verdict, 'ALLOW');
    const second = (await (await call('b', '/v1/evaluate', { payoutId: 'p-dup', intentId: 'int-s3', ...loan })).json()) as { decisionId: string; verdict: string; deduped: boolean };
    assert.equal(second.verdict, 'ALLOW');
    assert.equal(second.deduped, true);
    assert.equal(second.decisionId, first.decisionId, 'the cross-replica retry gets the original decision');
  });

  it('a key revocation on replica A stops an in-flight cite on replica B via the commit gen check', async () => {
    // int-s5 is signed by los-2 — registered and written through while valid.
    assert.equal((await call('a', '/v1/intents', loanIntent('int-s5', 'los-2', LOS2.privateKey), REGTOK)).status, 201);
    const del = await call('a', '/v1/issuers/los-2', { actor: 'soc', reason: 'los-2 leaked' }, ADMIN, 'DELETE');
    assert.equal(del.status, 200);
    const v = (await (await call('b', '/v1/evaluate', { payoutId: 'p-s5', intentId: 'int-s5', ...loan })).json()) as { verdict: string; hits: { rule: string }[] };
    assert.equal(v.verdict, 'BLOCK', 'the revocation must reach the authorize path, not just the poll');
    assert.ok(v.hits.some((h) => h.rule === 'intent.bad-signature'), JSON.stringify(v.hits));
  });

  it('a failed outcome reported on replica B frees the intent committed by replica A', async () => {
    await call('a', '/v1/intents', loanIntent('int-s7'), REGTOK);
    const first = (await (await call('a', '/v1/evaluate', { payoutId: 'p-rel', intentId: 'int-s7', ...loan })).json()) as { verdict: string };
    assert.equal(first.verdict, 'ALLOW');
    const o = (await (await call('b', '/v1/outcomes', { payoutId: 'p-rel', outcome: 'failed' })).json()) as { known: boolean };
    assert.equal(o.known, true, 'replica B never held it — the shared row did');
    const next = (await (await call('b', '/v1/evaluate', { payoutId: 'p-rel2', intentId: 'int-s7', ...loan })).json()) as { verdict: string };
    assert.equal(next.verdict, 'ALLOW', 'the released use is spendable on another replica');
    // And replica A converges: its stale counter syncs on the intent.* block.
    const third = (await (await call('a', '/v1/evaluate', { payoutId: 'p-rel3', intentId: 'int-s7', ...loan })).json()) as { verdict: string; hits: { rule: string }[] };
    assert.equal(third.verdict, 'BLOCK');
    assert.ok(third.hits.some((h) => h.rule === 'intent.reused'), JSON.stringify(third.hits));
  });

  it('a failed registration write-through refuses the call', async () => {
    backend.failNext = true;
    assert.equal((await call('a', '/v1/intents', loanIntent('int-s8'), REGTOK)).status, 503);
    backend.failNext = false;
  });

  it('store down fails closed: DECLINE in enforce, readyz drops, poll recovers', async () => {
    const fast = replica(25);
    const fastUrl = await listen(fast);
    try {
      // Register on THIS replica so the local registry knows the intent —
      // only the commit path should fail below.
      assert.equal((await fetch(fastUrl + '/v1/intents', { method: 'POST', headers: { authorization: `Bearer ${REGTOK}`, 'content-type': 'application/json' }, body: JSON.stringify(loanIntent('int-s9')) })).status, 201);
      const post = (p: unknown) => fetch(fastUrl + '/v1/evaluate', { method: 'POST', headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' }, body: JSON.stringify(p) });
      backend.failNext = true;
      const v = (await (await post({ payoutId: 'p-down', intentId: 'int-s9', ...loan })).json()) as { verdict: string; effectiveAction: string; hits: { rule: string }[] };
      assert.equal(v.verdict, 'BLOCK');
      assert.equal(v.effectiveAction, 'DECLINE');
      assert.ok(v.hits.some((h) => h.rule === 'store.commit-failed'), JSON.stringify(v.hits));
      await sleep(60);
      assert.equal(fast.stats.ready, false, 'the impaired money path is not ready');
      backend.failNext = false;
      await sleep(80);
      assert.equal(fast.stats.ready, true, 'the poll restores readiness');
      const ok = (await (await post({ payoutId: 'p-back', intentId: 'int-s9', ...loan })).json()) as { verdict: string };
      assert.equal(ok.verdict, 'ALLOW');
    } finally {
      fast.server.close();
      await fast.closeShared();
    }
  });

  it('retention purges settled tombstones on a poll tick and /metrics exposes the commit counters', async () => {
    const ROTOK = 'ro-token-0123456789abcdef';
    const be = new MemorySharedBackend();
    // An already-settled tombstone seeded before the gateway starts — the
    // first refresh tick runs the (hourly-throttled) purge. The sleep ages
    // the row past the millisecond cutoff — real Date.now() has ~1ms grain.
    await be.importReservation({ payoutId: 'p-old', sourceKeyId: 'k', intentId: 'int-old', approvalIds: [], amountPaise: 1, verdict: { verdict: 'ALLOW' }, settled: true });
    await sleep(10);
    const fw = new Payrekha(payrekhaRules({ band: false }).rules, {
      config: { mode: 'enforce', adminTokenSha256: sha(ADMIN) },
      keys: issuerKeys,
      now: () => T0,
    });
    const gw = createGateway({
      firewall: fw,
      apiKeys: [
        { id: 'lms', sha256: sha(API), origin: 'prod' },
        { id: 'reg', sha256: sha(REGTOK), origin: 'prod', roles: ['intents'] },
        { id: 'ro', sha256: sha(ROTOK), origin: 'prod', roles: ['read'] },
      ],
      adminKeySha256: sha(ADMIN),
      hashKey: HK,
      sharedState: { backend: be, controlPollMs: 20, reservationRetentionMs: 1 },
      now: () => T0,
    });
    const u = await listen(gw);
    try {
      await sleep(80);
      assert.deepEqual(await be.reservationStats(), { pending: 0, settled: 0 }, 'the seeded tombstone must be purged');
      const post = (path: string, body: unknown, tok = API) => fetch(u + path, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post('/v1/intents', loanIntent('int-met'), REGTOK)).status, 201);
      const v = (await (await post('/v1/evaluate', { payoutId: 'p-met', intentId: 'int-met', ...loan })).json()) as { verdict: string };
      assert.equal(v.verdict, 'ALLOW');
      const text = await (await fetch(u + '/metrics', { headers: { authorization: `Bearer ${ROTOK}` } })).text();
      assert.ok(text.includes('payrekha_shared_commits_total 1'), text);
      assert.ok(text.includes('payrekha_shared_committed_total 1'), text);
      assert.ok(text.includes('payrekha_shared_purged_reservations_total 1'), text);
      assert.ok(text.includes('payrekha_shared_commit_ms_count 1'), text);
    } finally {
      gw.server.close();
      await gw.closeShared();
    }
  });
});
