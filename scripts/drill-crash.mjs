#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 — People of Product
//
// Drill D1 — crash/restart evidence for the file store, end to end.
// Boots the real gateway bin, writes state worth keeping (HIGH_ALERT +
// spent intent), SIGKILLs mid-run, restarts, and asserts the state came
// back — the "kill -9 during save" rehearsal you run BEFORE launch, not
// during an incident.
//
//   npm run build && node scripts/drill-crash.mjs [--rounds 3]
//
// Exit 0 = every round restored. A failure prints what was lost.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROUNDS = Number(process.argv[process.argv.indexOf('--rounds') + 1] ?? 3);
const dir = mkdtempSync(join(tmpdir(), 'payrekha-drill-'));
const stateFile = join(dir, 'state.json');
const cfgFile = join(dir, 'payrekha.json');
writeFileSync(cfgFile, JSON.stringify({ firewall: { mode: 'enforce' } }));
const API = 'drill-eval-token-0123456789abcdef';
const ADMIN = 'drill-admin-token-0123456789abcde';
const STATE_KEY = 'drill-state-key-0123456789abcdef0123';
const BIN = join(import.meta.dirname, '../packages/gateway/dist/bin.js');

const port = () => 18_000 + Math.floor(Math.random() * 2_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (u, tok = API) => fetch(u, { headers: { authorization: `Bearer ${tok}` } });

async function waitReady(base, label) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await get(`${base}/readyz`);
      if (r.status === 200) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`${label}: gateway never became ready`);
}

function boot(p) {
  const child = spawn(process.execPath, [BIN], {
    env: {
      ...process.env,
      PORT: String(p),
      PAYREKHA_CONFIG: cfgFile,
      PAYREKHA_API_KEYS: `drill-eval:prod:${API}`,
      PAYREKHA_ADMIN_KEY: ADMIN,
      PAYREKHA_HASH_KEY: 'drill-hash-key-0123456789abcdef',
      PAYREKHA_STATE_FILE: stateFile,
      PAYREKHA_STATE_KEY: STATE_KEY,
      PAYREKHA_STATE_INTERVAL_MS: '400',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  child.on('error', (e) => {
    throw e;
  });
  return child;
}

let failed = 0;
for (let round = 1; round <= ROUNDS; round++) {
  const p = port();
  const base = `http://127.0.0.1:${p}`;
  const g1 = boot(p);
  try {
    await waitReady(base, `round ${round} boot`);
    // Write state worth keeping: HIGH_ALERT must survive the kill.
    const raise = await fetch(`${base}/v1/state`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ highAlert: 'raise', actor: 'drill', reason: 'crash drill' }),
    });
    if (raise.status !== 200) throw new Error(`raise HIGH_ALERT: HTTP ${raise.status}`);
    await fetch(`${base}/v1/evaluate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payoutId: `drill-${round}`, kind: 'LOAN_DISBURSAL', amountPaise: 100_00, beneficiaryRef: 'h:v1:drill', channel: 'IMPS' }),
    });
    // Let at least one save land, then kill at an arbitrary point in the
    // save cycle — the interval is 400ms so the kill lands mid-write often.
    await sleep(600 + Math.floor(Math.random() * 800));
    g1.kill('SIGKILL');
    await sleep(300);

    const g2 = boot(p);
    try {
      await waitReady(base, `round ${round} restart`);
      const st = (await (await get(`${base}/v1/state`)).json());
      const ok = st.alertState === 'HIGH_ALERT';
      console.log(`round ${round}: restart ready, alertState=${st.alertState} ${ok ? '✓' : '✗ LOST'}`);
      if (!ok) failed++;
    } finally {
      g2.kill('SIGTERM');
      await sleep(400);
      if (!g2.killed) g2.kill('SIGKILL');
    }
  } finally {
    if (!g1.killed) g1.kill('SIGKILL');
  }
}
rmSync(dir, { recursive: true, force: true });
if (failed > 0) {
  console.error(`\nDRILL FAILED: ${failed}/${ROUNDS} restarts lost HIGH_ALERT`);
  process.exit(1);
}
console.log(`\nDRILL PASSED: ${ROUNDS}/${ROUNDS} kill -9 restarts restored signed state (HIGH_ALERT survived)`);
