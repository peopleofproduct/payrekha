#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 — People of Product™
//
// ADR 0004 cutover tool — import a file-snapshot's intent counters,
// payoutId reservations and control state into the shared backend before
// flipping replicas to active-active.
//
//   PAYREKHA_SHARED_PG_URL=postgres://… node scripts/state-to-shared.mjs --file state.json
//   node scripts/state-to-shared.mjs --file state.json --dry-run
//
// Options:
//   --file PATH    snapshot to read (default $PAYREKHA_STATE_FILE, required)
//   --dry-run      verify the snapshot, print what would be imported, write nothing
//   --memory       import into a MemorySharedBackend (verification only — state is lost on exit)
//
// Env: PAYREKHA_STATE_KEY / _PREVIOUS unwrap signed snapshots;
//      PAYREKHA_SHARED_PG_PREFIX selects a non-default table prefix.
//
// Safety: the import is idempotent — intent counters GREATEST-merge (a
// replica that already committed is newer truth), reservation rows INSERT
// ON CONFLICT DO NOTHING, control state merges through the CAS path. Safe
// to re-run after a partial failure. For the strictest cutover quiesce
// traffic first; running it under live single-node traffic is safe too —
// commits that raced you win by construction.
import { readFileSync } from 'node:fs';
import { MemorySharedBackend, verifyAndUnwrap } from '../packages/core/dist/index.js';
import { PostgresSharedBackend } from '../packages/store-postgres/dist/index.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const die = (msg) => {
  console.error(`state-to-shared: ${msg}`);
  process.exit(1);
};

const file = opt('--file') ?? process.env['PAYREKHA_STATE_FILE'];
if (file === undefined) die('snapshot file required — pass --file PATH or set PAYREKHA_STATE_FILE');
const dryRun = flag('--dry-run');
const pgUrl = process.env['PAYREKHA_SHARED_PG_URL'];
if (!dryRun && !flag('--memory') && pgUrl === undefined) die('no backend — set PAYREKHA_SHARED_PG_URL or pass --memory/--dry-run');

let raw;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  die(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
}
let snap;
try {
  snap = verifyAndUnwrap(raw, process.env['PAYREKHA_STATE_KEY'], process.env['PAYREKHA_STATE_KEY_PREVIOUS']?.split(',') ?? []);
} catch (e) {
  die(`snapshot signature rejected: ${e instanceof Error ? e.message : String(e)}`);
}
if (snap === null || typeof snap !== 'object' || snap.intents === null || typeof snap.intents !== 'object')
  die('snapshot is missing the intents block — not a FirewallSnapshot?');

const intents = Array.isArray(snap.intents.intents) ? snap.intents.intents : [];
const reservations = Array.isArray(snap.intents.reservations) ? snap.intents.reservations : [];
const settled = reservations.filter(([, r]) => r?.settled === true).length;

console.log(`snapshot ${file}: ${intents.length} intents, ${reservations.length} reservations (${settled} settled tombstones)`);
console.log(
  `control: mode=${String(snap.mode)} highAlert=${snap.highAlert === null || snap.highAlert === undefined ? 'none' : 'ACTIVE'} revoked=${(snap.issuers?.revoked ?? []).length} keyIds modeByKind=${Object.keys(snap.modeByKind ?? {}).length} kinds`,
);
if (dryRun) {
  console.log('dry run — nothing written.');
  process.exit(0);
}

const backend = flag('--memory')
  ? new MemorySharedBackend()
  : new PostgresSharedBackend({ connectionString: pgUrl, tablePrefix: process.env['PAYREKHA_SHARED_PG_PREFIX'] });

// Imported tombstones carry REVIEW, not the original verdict: a retry holds
// for review instead of replaying a synthesized ALLOW into a second payout.
const importedVerdict = {
  verdict: 'REVIEW',
  reasons: [
    {
      rule: 'cutover-import',
      message: 'reservation imported at active-active cutover — original verdict was not retained in the snapshot',
    },
  ],
  imported: true,
};

let done = 0;
try {
  for (const rec of intents) {
    if (rec === null || typeof rec !== 'object' || typeof rec.intent !== 'object' || rec.intent === null)
      die('malformed intent record in snapshot');
    if (typeof rec.uses !== 'number' || typeof rec.usedPaise !== 'number')
      die(`intent '${String(rec.intent.intentId)}' has malformed counters`);
    await backend.importIntent({ intent: rec.intent, uses: rec.uses, usedPaise: rec.usedPaise });
    done += 1;
  }
  console.log(`imported ${done}/${intents.length} intents`);
  done = 0;
  for (const pair of reservations) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || pair[1] === null || typeof pair[1] !== 'object')
      die('malformed reservation row in snapshot');
    const [payoutId, r] = pair;
    if (typeof r.intentId !== 'string' || typeof r.amountPaise !== 'number')
      die(`reservation '${payoutId.slice(0, 12)}…' is missing intentId/amountPaise`);
    await backend.importReservation({
      payoutId,
      sourceKeyId: typeof r.sourceKeyId === 'string' ? r.sourceKeyId : '',
      intentId: r.intentId,
      approvalIds: Array.isArray(r.approvalIds) ? r.approvalIds : [],
      amountPaise: r.amountPaise,
      verdict: importedVerdict,
      settled: r.settled === true,
    });
    done += 1;
  }
  console.log(`imported ${done}/${reservations.length} reservations`);

  // Control: merge, never reset — revoked keys stay revoked, an alert stays up.
  await backend.writeControl((cur) => ({
    ...cur,
    highAlert: cur.highAlert ?? snap.highAlert ?? null,
    modeByKind: { ...(snap.modeByKind ?? {}), ...cur.modeByKind },
    revokedKeyIds: [...new Set([...(cur.revokedKeyIds ?? []), ...(snap.issuers?.revoked ?? [])])],
  }));
  console.log('control state merged (alert + revocations + per-kind modes — mode itself stays config-authoritative)');

  const st = await backend.reservationStats();
  console.log(`shared store now holds ${st.pending} pending + ${st.settled} settled reservations.`);
} finally {
  await backend.close?.();
}
console.log('cutover import complete — safe to start replicas with sharedState enabled.');
