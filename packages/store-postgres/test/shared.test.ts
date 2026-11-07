// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { generateIssuerKeyPair, hashBeneficiary, signIntent } from '@payrekha/core';
import { PostgresSharedBackend } from '@payrekha/store-postgres';

const url = process.env['PAYREKHA_TEST_PG_URL'];
const T0 = Date.UTC(2026, 10, 4, 5, 30);
const LOS = generateIssuerKeyPair();
const benRef = hashBeneficiary({ account: '000123456789', ifsc: 'HDFC0001234' }, 'test-hash-key-0123456789');
const prefix = `sa${process.pid}${Date.now()}`.toLowerCase();
const backends: PostgresSharedBackend[] = [];
const backend = () => {
  const b = new PostgresSharedBackend({ connectionString: url!, tablePrefix: prefix });
  backends.push(b);
  return b;
};
const intent = (id: string, maxUses = 1) =>
  signIntent(
    { intentId: id, kind: 'LOAN_DISBURSAL', maxAmountPaise: 2_40_000_00, beneficiaryRef: benRef, maxUses, notBeforeMs: T0 - 60_000, expiresAtMs: T0 + 3_600_000, issuer: 'los-prod', keyId: 'los-1' },
    { alg: 'ed25519', privateKey: LOS.privateKey },
  );
const commitBody = (payoutId: string, i: ReturnType<typeof intent>, gen = 0) =>
  ({ payoutId, sourceKeyId: 'lms', intentId: i.intentId, approvalIds: [] as string[], intents: [i], amountPaise: 1_000_00, verdict: { verdict: 'ALLOW' }, controlGen: gen });

describe('PostgresSharedBackend', { skip: url === undefined ? 'set PAYREKHA_TEST_PG_URL to run' : false }, () => {
  after(async () => {
    for (const b of backends) await b.close();
  });

  it('commit is atomic and linearizable across two writers', async () => {
    const a = backend();
    const b = backend();
    const i = intent(`${prefix}-i1`);
    await a.putIntent(i);
    assert.deepEqual(await a.commit(commitBody(`${prefix}-p1`, i)), { committed: true, gen: 0, counters: { [i.intentId]: { uses: 1, usedPaise: 1_000_00 } } });
    // Same payoutId on the other replica → the stored verdict replays.
    const dup = await b.commit(commitBody(`${prefix}-p1`, i));
    assert.ok('conflict' in dup && dup.conflict === 'payoutId');
    // A different payout on the same maxUses=1 intent loses the race.
    const race = await b.commit(commitBody(`${prefix}-p2`, i));
    assert.ok('conflict' in race && race.conflict === 'uses');
    // And the authoritative counter is visible.
    assert.deepEqual(await a.intentState(i.intentId), { uses: 1, usedPaise: 1_000_00 });
  });

  it('the control generation gates the commit and writeControl CASs it forward', async () => {
    const a = backend();
    const i = intent(`${prefix}-i2`);
    const ok = await a.writeControl((cur) => ({ ...cur, highAlert: { since: T0, reason: 'drill' } }));
    assert.equal(ok, true);
    const cur = await a.readControl();
    assert.equal(cur.gen, 1);
    assert.deepEqual(cur.highAlert, { since: T0, reason: 'drill' });
    const r = await a.commit(commitBody(`${prefix}-p3`, i, 0));
    assert.ok('conflict' in r && r.conflict === 'control' && r.gen === 1, 'a stale replica must not commit');
    const settled = await a.commit(commitBody(`${prefix}-p3`, i, 1));
    assert.ok(!('conflict' in settled));
  });

  it('release gives every cited use back; settle tombstones', async () => {
    const a = backend();
    const i = intent(`${prefix}-i3`);
    await a.commit(commitBody(`${prefix}-p4`, i, (await a.readControl()).gen));
    assert.equal(await a.releaseReservation(`${prefix}-p4`, 'lms'), true);
    assert.deepEqual(await a.intentState(i.intentId), { uses: 0, usedPaise: 0 });
    assert.equal(await a.releaseReservation(`${prefix}-p4`, 'lms'), false, 'gone already');
    await a.commit(commitBody(`${prefix}-p5`, i, (await a.readControl()).gen));
    assert.equal(await a.settleReservation(`${prefix}-p5`, 'lms'), true);
    assert.equal(await a.releaseReservation(`${prefix}-p5`, 'lms'), false, 'a settled reservation cannot release');
  });
});

describe('PostgresSharedBackend without a database', () => {
  it('rejects an unsafe table prefix and keeps credentials out of describe', () => {
    assert.throws(() => new PostgresSharedBackend({ connectionString: 'postgres://u@h/db', tablePrefix: 'x; drop y' }), /invalid table prefix/);
    const b = new PostgresSharedBackend({ connectionString: 'postgres://u:secret@h/db' });
    assert.equal(b.describe.includes('secret'), false);
  });

  it('commit runs the control-gen check before the reservation insert, in one transaction', async () => {
    const sql: string[] = [];
    const behaviour = async (q: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
      sql.push(q.trim().split(/\s+/).slice(0, 4).join(' '));
      if (q.includes('FOR UPDATE')) return { rows: [{ gen: '0' }], rowCount: 1 };
      if (q.includes(`INSERT INTO payrekha_sa_reservations`)) return { rows: [{ payout_id: 'p' }], rowCount: 1 };
      if (q.includes('RETURNING uses')) return { rows: [{ uses: '1', used_paise: '100' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const client = { query: behaviour, release: () => undefined };
    const pool = { query: behaviour, connect: async () => client, end: async () => undefined };
    const b = new PostgresSharedBackend({ pool: pool as never });
    const r = await b.commit({ payoutId: 'p', sourceKeyId: 'k', intentId: 'i', approvalIds: [], intents: [], amountPaise: 1, verdict: {}, controlGen: 0 });
    assert.ok(!('conflict' in r));
    assert.ok(
      sql.findIndex((s) => s.startsWith('SELECT gen FROM')) < sql.findIndex((s) => s.startsWith('INSERT INTO payrekha_sa_reservations')),
      `control row must be locked before the reservation is written: ${JSON.stringify(sql)}`,
    );
    assert.equal(sql[0], 'CREATE TABLE IF NOT');
  });

  it('a duplicate payoutId replays the stored verdict instead of re-spending', async () => {
    const behaviour = async (q: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
      if (q.includes('FOR UPDATE')) return { rows: [{ gen: '0' }], rowCount: 1 };
      if (q.includes('ON CONFLICT (payout_id)')) return { rows: [], rowCount: 0 };
      if (q.includes('SELECT verdict')) return { rows: [{ verdict: { verdict: 'ALLOW', decisionId: 'pd_x' } }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const client = { query: behaviour, release: () => undefined };
    const pool = { query: behaviour, connect: async () => client, end: async () => undefined };
    const b = new PostgresSharedBackend({ pool: pool as never });
    const r = await b.commit({ payoutId: 'p', sourceKeyId: 'k', intentId: 'i', approvalIds: [], intents: [], amountPaise: 1, verdict: {}, controlGen: 0 });
    assert.ok('conflict' in r && r.conflict === 'payoutId');
    assert.deepEqual(r.verdict, { verdict: 'ALLOW', decisionId: 'pd_x' });
  });
});
