// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Payrekha } from '@payrekha/core';
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
