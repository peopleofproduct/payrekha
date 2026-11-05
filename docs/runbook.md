# Runbook

Procedures for the alerts in `deploy/prometheus/alerts.yml`. Each ends with "if unsure": the safe default is always to leave Payrekha up-but-unready (fail closed) rather than restart into a guessed state.

## PayrekhaDown / PayrekhaNotReady (critical)

`up == 0`, or `payrekha_ready == 0` — serving 503 on every API call. With Envoy `failure_mode_allow: false` this also 403s payouts at the edge.

1. `kubectl logs deploy/payrekha --tail=100`. The unready reason is logged (`state unreadable`, `state written by another instance`).
2. `state unreadable` — the snapshot cannot be read. Check the PVC/PG connectivity. **Do not delete the state file** — it may be the only copy of HIGH_ALERT and spent intents. Payrekha retries every `PAYREKHA_STATE_RETRY_MS` and readies itself when the store returns.
3. `state written by another instance` — a second writer fenced this one. Find the other replica (`kubectl get pods -l app=payrekha`). Keep exactly one; the fenced instance stays unready until the store's writer row is its own again after the competing pod is gone and the store is repaired per `docs/operations.md`.
4. If the process is crash-looping on bad config, the last log line names the env var — fix the Secret/configmap, do not downgrade the image first.
5. **If unsure:** leave it unready and page the owner. A fail-closed 503 is louder than a silent wrong-verdict and far cheaper than a lost HIGH_ALERT.

## PayrekhaHighAlert (critical)

Entered on a canary touch, a block burst, or a manual raise. **It never expires on its own** — it is the one state an attacker cannot wait out.

1. Read the decision log around the entry: `type:"audit"` records name the actor and reason; `canary.tripped` and the block-burst hits name the rule and evidence.
2. Decide: contained (reset) or ongoing (leave raised). Leaving it raised forces intents on every kind — in shadow this only shows in the log.
3. Reset, always with a reason:

   ```bash
   curl -XPUT $GW/v1/state -H "authorization: Bearer $ADMIN" \
     -d '{"highAlert":"reset","actor":"<you>","reason":"INC-<id> <what you found>"}'
   ```

4. Rotate credentials named in the audit entries (a canary API key touched → that key is burned).

## PayrekhaStateSaveErrors (critical)

Snapshots are failing — up to the save interval of intent uses, velocity windows and alert state can be lost on a restart, and a crash now could come back without HIGH_ALERT.

1. Check disk full / PVC detached / PG connectivity and permissions.
2. If the store needs to move, update config and restart — the boot loader re-reads state before serving.

## PayrekhaDecisionLogErrors (warning → escalate)

Audit trail gap. Check the log path's disk and file permissions (`0600`, the container UID 1000 must own it). Every missed line is a decision or admin action with no record — for compliance, treat sustained errors like PayrekhaDown.

## PayrekhaRuleError (critical)

A rule threw — verdicts for that payout are `degraded`. Pull `payrekha_degraded_total` and the `ruleErrors` field in the decision log to name the rule. Degraded never becomes ALLOW, but a throwing rule silently reduces coverage; fix forward.

## Credential compromise

| Key | Blast radius | Do |
|---|---|---|
| Payout API key | It can only evaluate (+ report its own outcomes) | Mint a replacement key id, remove the old entry from `PAYREKHA_API_KEYS`, rolling restart. Its `sourceKeyId` name is burned — do not reuse it. |
| Intent-signing (issuer) key | Attacker can mint intents within that key's kinds | `DELETE /v1/issuers/<keyId>` (admin, reason required) — kills every intent it signed immediately and the revocation persists in the snapshot. Then roll a **new** keyId through config (a revoked keyId is a tombstone, never reused) and have the LOS re-sign pending intents. |
| Admin token | Mode downgrade to shadow, HIGH_ALERT reset | Rotate `PAYREKHA_ADMIN_KEY`, rolling restart, then audit the decision log `type:"audit"` entries for `mode.set`/`alert.reset` you didn't make. |
| Hash key | Beneficiary refs become unlinkable | Rotate requires re-keying all stored refs — plan this as a maintenance, not an incident fix; keep the old key until refs rotate. |

## Promoting the standby (manual failover)

One writer only. Promote a standby by scaling the fenced/down active to 0 first, then the standby up — never two writers at once. The standby serves 503 until it has read the snapshot (`/readyz` green = it is serving the *restored* state, not a guess).

## Capacity envelope (measured — `npm run loadcheck`)

On an M-series laptop, enforce mode with behaviour rules + intent checks:

| State size | eval p99 | snapshot serialize+HMAC stall | heap after run |
|---|---|---|---|
| 20k beneficiaries / 5k intents | ~42 µs | ~20 ms (0.4% of the 5 s cycle) | ~140 MB |
| 100k beneficiaries / 30k intents | ~64 µs | ~205 ms (4.1%) | ~260 MB |

The stall scales roughly linearly with snapshot bytes and is HMAC-dominated.
**Trigger for async snapshot serialization: snapshots routinely > ~20 MB.**
Watch `payrekha_eval_latency_micros` p99 and pod RSS against the 512 Mi limit
on day one — dedupe entries grow toward their cap under unique payoutIds, so
heap is driven by payout *rate*, not just beneficiary count.

## Rollback

Redeploy the previous image. State snapshots are forward-readable by older builds within the same minor line; if the snapshot format changed, restore from the pre-upgrade file copy you made (you did make one — it's in the deploy step).
