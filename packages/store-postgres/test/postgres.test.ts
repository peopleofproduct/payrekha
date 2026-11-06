// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Payrekha, signSnapshot } from '@payrekha/core';
import { PostgresStateStore, StaleStateError } from '@payrekha/store-postgres';

const url = process.env['PAYREKHA_TEST_PG_URL'];
const adminToken = 'admin-token-0123456789';
const adminTokenSha256 = createHash('sha256').update(adminToken).digest('hex');
const fresh = () => new Payrekha([], { config: { mode: 'enforce', adminTokenSha256 } });
const name = `t${process.pid}${Date.now()}`;
const stores: PostgresStateStore[] = [];
const store = (n = name) => {
  const s = new PostgresStateStore({ connectionString: url!, name: n });
  stores.push(s);
  return s;
};

describe('PostgresStateStore', { skip: url === undefined ? 'set PAYREKHA_TEST_PG_URL to run' : false }, () => {
  after(async () => {
    for (const s of stores) await s.close();
  });

  it('first load finds nothing; HIGH_ALERT survives a restart through Postgres', async () => {
    const a = store();
    const fw = fresh();
    assert.equal(await a.load(fw), false);
    fw.raiseHighAlert('test', 'canary');
    await a.save(fw);
    await a.save(fw);

    const fw2 = fresh();
    assert.equal(await store().load(fw2), true);
    assert.equal(fw2.alertState, 'HIGH_ALERT');
  });

  it('a second writer is detected instead of silently overwriting', async () => {
    const n = `${name}-race`;
    const a = store(n);
    const b = store(n);
    const fwA = fresh();
    const fwB = fresh();
    await a.load(fwA);
    await b.load(fwB);
    fwA.raiseHighAlert('test', 'canary');
    await a.save(fwA);
    await assert.rejects(b.save(fwB), StaleStateError);

    const check = fresh();
    await store(n).load(check);
    assert.equal(check.alertState, 'HIGH_ALERT');
  });

  it('refuses to save before load', async () => {
    await assert.rejects(store(`${name}-noload`).save(fresh()), StaleStateError);
  });

  it('rejects unsafe table names and never puts credentials in describe', () => {
    assert.throws(() => new PostgresStateStore({ connectionString: url!, table: 'x; drop table y' }), /invalid table name/);
    const s = store();
    assert.equal(s.describe.includes('@'), false);
    assert.equal(s.describe, `postgres:payrekha_state/${name}`);
  });
});

// These run without a database: the pool is stubbed.
describe('PostgresStateStore with a stubbed pool', () => {
  const fakePool = (behaviour: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) => ({
    query: (sql: string, params?: unknown[]) => behaviour(sql, params),
    end: () => Promise.resolve(),
  });

  it('a transient init failure is retried, not cached forever', async () => {
    let calls = 0;
    const pool = fakePool((sql) => {
      calls += 1;
      return sql.startsWith('CREATE TABLE') && calls === 1 ? Promise.reject(new Error('pg not ready')) : Promise.resolve({ rows: [] });
    });
    const s = new PostgresStateStore({ pool: pool as never });
    await assert.rejects(s.load(fresh()), /pg not ready/);
    assert.equal(await s.load(fresh()), false, 'the retry must reach Postgres — an init failure must not stick');
  });

  it('HMAC-signed rows verify; a tampered row is refused', async () => {
    const key = 'pg-state-key-0123456789abcdef0123';
    const fw = fresh();
    fw.raiseHighAlert('test', 'canary');
    const signed = signSnapshot(fw.exportState(), key) as { d: { highAlert: unknown }; m: string };
    const ok = new PostgresStateStore({ pool: fakePool(() => Promise.resolve({ rows: [{ version: '7', snapshot: signed }] })) as never, hmacKey: key });
    const fw2 = fresh();
    assert.equal(await ok.load(fw2), true);
    assert.equal(fw2.alertState, 'HIGH_ALERT');
    // JSONB may reorder keys — the canonical-JSON MAC still catches a content change.
    const tampered = { d: { ...signed.d, highAlert: null }, m: signed.m };
    const bad = new PostgresStateStore({ pool: fakePool(() => Promise.resolve({ rows: [{ version: '8', snapshot: tampered }] })) as never, hmacKey: key });
    await assert.rejects(bad.load(fresh()), /signature mismatch/);
  });
});
