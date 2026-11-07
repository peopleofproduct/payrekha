<!-- SPDX-License-Identifier: Apache-2.0 -->
# Drills — evidence the failure modes actually work

Checklists don't catch broken failover; drills do. Run each at least once
before enforce, then on a schedule (crash/restore monthly, failover and
issuer-compromise quarterly). Every drill has a **pass criterion** — record
the date + result in your ops log.

| # | Drill | Automatable | Pass criterion |
|---|---|---|---|
| D1 | Kill -9 during save | `scripts/drill-crash.mjs` | Every restart: `/readyz` 200, state restored |
| D2 | Postgres standby promotion | Manual | Standby ready ≤ 60 s, serves *restored* state |
| D3 | Second writer fenced | Manual | Writer B goes unready; writer A unaffected |
| D4 | Compromised issuer key | `curl` + tabletop | Revoke → live intents dead ≤ 5 s, audited |
| D5 | Snapshot-key rotation | Manual | Old snapshot loads, next save under new key |
| D6 | HIGH_ALERT reset | `curl` | Verdicts resume; audit shows actor+reason |
| D7 | SIEM delivery | Manual | One decision + one audit line parse in SIEM |
| D8 | Active-active invariants | `scripts/drill-shared-state.mjs` | Exactly-one spend, stored verdicts, fail-closed outage, revocation reach |
| D9 | Active-active cutover | `scripts/state-to-shared.mjs` (manual) | Imported counters continue, old payoutIds replay REVIEW, no `uses` conflicts |

## D1 — kill -9 during save (automated)

```bash
npm run build && node scripts/drill-crash.mjs --rounds 5
```

Boots the real gateway, raises HIGH_ALERT, lets a save land, SIGKILLs at an
arbitrary point in the save cycle, restarts, asserts the signed snapshot
restored. **Pass: every round prints `alertState=HIGH_ALERT ✓`.** A miss
means the atomic write or HMAC verify path regressed — treat as a release
blocker. For Postgres, same drill against a dev DB with `PAYREKHA_STATE_PG_URL`.

## D2 — standby promotion

1. Deploy standby with the same `PAYREKHA_STATE_*` config; it stays unready
   while the active writes (expected — the CAS fence holds it).
2. Scale the active to 0 (or `kill -9` its pod for realism).
3. Start the standby; watch `/readyz`.

**Pass:** ready ≤ 60 s; `GET /v1/state` shows the restored alert/mode-by-kind;
a payout retried across the failover returns the original verdict via the
persisted reservation, not a fresh decision.

## D3 — second writer fencing

1. With the active running, boot a *second* instance on the same
   `PAYREKHA_STATE_NAME`/file.
2. Wait for both to attempt a save.

**Pass:** the loser flips `payrekha_ready == 0` with reason "state written by
another instance" and stays that way — it must never overwrite contested
state. `PayrekhaNotReady` fires. Kill the loser; the winner is unaffected.

## D4 — compromised issuer key (tabletop + curl)

Scenario: the LOS signing key for `los-prod` is posted publicly at 10:00.

1. `DELETE /v1/issuers/<keyId>` (admin, reason required).
2. Immediately re-evaluate a payout citing an intent that key signed.

**Pass:** intent now BLOCKs with `intent.key-revoked`; `keyring.generation`
bumped (cached verifications redone); `issuer.revoked` appears in the
decision log; after a restart the revocation still holds (it is in the
snapshot). **Measure:** time from "key posted" to "intents dead" — the metric
your IR plan quotes. Then mint/register under a **new** keyId — a revoked
keyId is a tombstone, never reused.

## D5 — snapshot-key rotation

1. Set `PAYREKHA_STATE_KEY=<new>` **and** `PAYREKHA_STATE_KEY_PREVIOUS=<old>`; restart.
2. Confirm ready (old snapshot verified under the previous key).
3. After one save interval, remove `PAYREKHA_STATE_KEY_PREVIOUS`; restart again.

**Pass:** both restarts ready; step 3 loads the snapshot written under the new
key. Negative check (do it on dev): `PAYREKHA_STATE_KEY` changed *without*
`..._PREVIOUS` → the service stays unready rather than silently starting
empty — that is the fail-closed behaviour working.

## D6 — HIGH_ALERT reset

1. Raise: `PUT /v1/state {"highAlert":"raise","actor":"drill","reason":"drill"}` (admin).
2. Confirm verdicts degrade/block per `requireIntent` policy.
3. Reset: same call with `"highAlert":"reset"`.

**Pass:** verdicts resume; decision log holds `alert.entered` and
`alert.cleared` with actor + reason; `payrekha_high_alert` gauge tracked both.
Reset without a recorded investigation is a process failure, not a system one.

## D7 — SIEM delivery

1. Generate one BLOCK decision and one admin audit.
2. In the SIEM, find both: decision as a `decision` record (or CEF line if
   `PAYREKHA_LOG_FORMAT=cef`), audit as a JSON `audit` record.
3. Verify the fields your detection rules need: `verdict`, `hits[].rule`,
   `actor`, `reason`, `requestId`.

**Pass:** both parsed, not raw-dumped; no beneficiary identifiers anywhere —
the log should contain only `h:v1:` hashed refs. If raw account/VPA strings
appear, the caller bypassed the hash-at-entry path — find out how.

## D8 — active-active invariants (automated)

```bash
node scripts/drill-shared-state.mjs            # in-memory backend
PAYREKHA_SHARED_PG_URL=postgres://… node scripts/drill-shared-state.mjs
```

Three gateway replicas on one shared backend, over real HTTP: (S1) five
concurrent evaluations on a `maxUses: 1` intent → exactly one ALLOW; (S2) a
payoutId storm across replicas → every retry replays the same decisionId;
(S3) store outage → enforce-mode DECLINE + `/readyz` 503 + poll recovery;
(S4) issuer-key revocation on A → B's next cite BLOCKs through the commit
generation check; (S5) a `failed` outcome on B frees the use A committed.

**Pass:** `Drill D2 PASSED`. A failure means the commit/conflict/fail-closed
machinery regressed — release blocker for any active-active deploy. Run it
against the real Postgres (`PAYREKHA_SHARED_PG_URL`) before go-live; the
in-memory run covers the flow, not the SQL.

## D9 — active-active cutover rehearsal (manual)

Before flipping a live single-node/snapshot deployment to active-active:

1. Export the live snapshot (`/v1/state` backup or the state file itself).
2. `PAYREKHA_STATE_KEY=… node scripts/state-to-shared.mjs --file <snap> --dry-run` — signature verifies, counts look right.
3. `PAYREKHA_SHARED_PG_URL=… node scripts/state-to-shared.mjs --file <snap>` — import completes; re-run it once to prove idempotency (counters merge upward, bindings keep first-write).
4. Boot a second replica with `sharedState` on; `payrekha_shared_commits_total` rises on both, `/readyz` 200.
5. Verify one in-flight intent from before the cutover: a payout citing it commits with `uses` continuing from the imported value, not restarting at zero.

**Pass:** imported intent spends from its pre-cutover counter, a pre-cutover
payoutId retry replays REVIEW (not a double spend), and no
`payrekha_shared_conflicts_total{conflict="uses"}` spike appears on cutover
day. A botched import that shows `intent '…' conflicts with the registered
copy` means the snapshot and the live store disagree — do not proceed.
