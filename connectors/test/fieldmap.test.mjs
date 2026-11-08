// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyFieldMap, dig, resolveSpec } from '../lib/fieldmap.mjs';
import { makeBridge } from '../lib/bridge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const losMap = JSON.parse(readFileSync(join(here, '../fieldmaps/los-disbursal.json'), 'utf8'));
const paMap = JSON.parse(readFileSync(join(here, '../fieldmaps/pa-settlement.json'), 'utf8'));

test('dig resolves dot paths and misses cleanly', () => {
  const ev = { loan: { id: 'L1', nested: { deep: 7 } } };
  assert.equal(dig(ev, 'loan.id'), 'L1');
  assert.equal(dig(ev, 'loan.nested.deep'), 7);
  assert.equal(dig(ev, 'loan.missing.path'), undefined);
});

test('los-disbursal map produces a valid mint body', () => {
  const ev = {
    loan: { id: 'loan-001', amount_paise: 49999900 },
    beneficiary: { account_number: '123456789012', ifsc: 'HDFC0001234' },
  };
  const body = applyFieldMap(losMap, ev);
  assert.equal(body.intentId, 'loan-001');
  assert.equal(body.kind, 'LOAN_DISBURSAL');
  assert.equal(body.amountPaise, 49999900);
  assert.equal(body.account, '123456789012');
  assert.equal(body.ifsc, 'HDFC0001234');
  assert.equal(body.maxUses, 1);
  assert.equal(body.ttlMs, 86400000);
  assert.equal(body._comment, undefined); // comments don't leak into the body
});

test('pa-settlement map: template id + coalesce notBeforeMs', () => {
  const ev = {
    settlement: { cycle_id: 'cyc-2026-11-01', net_paise: 1234500, payable_at: 1793853000000 },
    merchant: { id: 'm-42', settlement_account: '9988776655', settlement_ifsc: 'ICIC0000001' },
  };
  const body = applyFieldMap(paMap, ev);
  assert.equal(body.intentId, 'cyc-2026-11-01-m-42');
  assert.equal(body.kind, 'PA_SETTLEMENT');
  assert.equal(body.amountPaise, 1234500);
  assert.equal(body.notBeforeMs, 1793853000000);
  // second coalesce leg when payable_at is absent
  const ev2 = { settlement: { cycle_id: 'c', net_paise: 1, cycle_end_ms: 42 }, merchant: { id: 'm', settlement_account: '123456', settlement_ifsc: 'ICIC0000001' } };
  assert.equal(applyFieldMap(paMap, ev2).notBeforeMs, 42);
});

test('resolveSpec: const/map/template/now', () => {
  const ev = { rail: 'imps' };
  assert.equal(resolveSpec({ const: 'X' }, ev), 'X');
  assert.equal(resolveSpec({ map: { imps: 'IMPS' }, from: 'rail' }, ev), 'IMPS');
  assert.equal(resolveSpec({ map: { upi: 'UPI' }, from: 'rail', default: 'INTERNAL' }, ev), 'INTERNAL');
  assert.equal(resolveSpec({ template: 'a-{rail}' }, { rail: 'b' }), 'a-b');
  const t = resolveSpec({ now: true }, ev);
  assert.ok(Math.abs(t - Date.now()) < 5_000);
});

test('bridge posts the mapped body to /v1/intents/mint and emits a join line', async () => {
  const seen = {};
  const lines = [];
  const bridge = makeBridge({
    url: 'http://gw:8080',
    token: 'mint-key',
    fieldMap: losMap,
    fetchImpl: async (url, init) => {
      seen.url = url;
      seen.auth = init.headers.authorization;
      seen.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ intentId: seen.body.intentId }), { status: 201 });
    },
    onEmit: (l) => lines.push(l),
  });
  const out = await bridge({ loan: { id: 'L9', amount_paise: 100 }, beneficiary: { account_number: '1234567890', ifsc: 'HDFC0001234' } });
  assert.equal(out.ok, true);
  assert.equal(out.intentId, 'L9');
  assert.equal(seen.url, 'http://gw:8080/v1/intents/mint');
  assert.equal(seen.auth, 'Bearer mint-key');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].intentId, 'L9');
});

test('bridge: malformed event → 400 (no call), gateway 5xx → retried once', async () => {
  let calls = 0;
  const bridge = makeBridge({
    url: 'http://gw:8080',
    token: 'k',
    fieldMap: losMap,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: calls === 1 ? 500 : 201 });
    },
    onEmit: () => {},
  });
  const bad = await bridge({ loan: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  const good = await bridge({ loan: { id: 'x', amount_paise: 1 }, beneficiary: { account_number: '1234567890', ifsc: 'HDFC0001234' } });
  assert.equal(calls, 2); // retried the 500 once
  assert.equal(good.ok, true);
});
