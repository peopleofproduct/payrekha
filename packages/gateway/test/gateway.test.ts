// SPDX-License-Identifier: Apache-2.0
import { strict as assert } from 'node:assert';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { generateIssuerKeyPair, hashBeneficiary, Payrekha, signIntent } from '@payrekha/core';
import { createGateway, memoryDecisionLog, signWebhook, toCef, WebhookSender, type GatewayHandle } from '@payrekha/gateway';
import { payrekhaRules } from '@payrekha/rules';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const API = 'api-token-0123456789';
const UAT = 'uat-token-0123456789';
const ADMIN = 'admin-token-0123456789';
const EXT = 'ext-token-0123456789';
const HK = 'gateway-hash-key-0123456789';
const T0 = Date.UTC(2026, 10, 4, 5, 30);
const LOS = generateIssuerKeyPair();

function boot(mode: 'shadow' | 'enforce') {
  const log = memoryDecisionLog();
  const fw = new Payrekha(payrekhaRules({ band: false }).rules, {
    config: { mode, adminTokenSha256: sha(ADMIN) },
    keys: [{ keyId: 'los-1', issuer: 'los-prod', alg: 'ed25519', publicKey: LOS.publicKey, kinds: ['LOAN_DISBURSAL', 'VERIFICATION'] }],
    now: () => T0,
  });
  const gw = createGateway({
    firewall: fw,
    apiKeys: [
      { id: 'lms-prod', sha256: sha(API), origin: 'prod' },
      { id: 'lms-uat', sha256: sha(UAT), origin: 'nonprod' },
    ],
    adminKeySha256: sha(ADMIN),
    hashKey: HK,
    decisionLog: log,
    now: () => T0,
    extAuthz: {
      origin: 'prod',
      keySha256: sha(EXT),
      mapping: {
        payoutId: 'body.request_id',
        kind: { const: 'LOAN_DISBURSAL' },
        amountPaise: 'body.amount_in_paise',
        intentId: 'header.x-payrekha-intent',
        beneficiary: { account: 'body.beneficiary.account_number', ifsc: 'body.beneficiary.ifsc' },
        channel: { const: 'IMPS' },
        sourceKeyId: 'header.x-client-id',
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
const loanIntent = (id: string) =>
  signIntent(
    { intentId: id, kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: benRef, maxUses: 1, notBeforeMs: T0 - 60_000, expiresAtMs: T0 + 3_600_000, issuer: 'los-prod', keyId: 'los-1' },
    { alg: 'ed25519', privateKey: LOS.privateKey },
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

  it('metrics in Prometheus text', async () => {
    const t = await (await fetch(url + '/metrics', { headers: { authorization: `Bearer ${API}` } })).text();
    assert.match(t, /payrekha_verdicts_total\{verdict="BLOCK"\} \d+/);
    assert.match(t, /payrekha_rule_hits_total\{rule="intent.missing"\} \d+/);
    assert.match(t, /payrekha_eval_latency_micros_bucket\{le="\+Inf"\}/);
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
    const line = toCef({ ts: new Date(T0).toISOString(), requestId: 'r', decisionId: 'd', payoutId: 'p=1|x', via: 'evaluate', mode: 'enforce', alertState: 'NORMAL', verdict: 'BLOCK', effectiveAction: 'DECLINE', degraded: false, deduped: false, rules: ['intent.missing'], hits: [{ rule: 'intent.missing', verdict: 'BLOCK', reason: 'a|b', evidence: {} }], ruleErrors: [], elapsedMicros: 3 });
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
