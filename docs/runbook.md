# Runbook

Procedures for the alerts in `deploy/prometheus/alerts.yml`. Each ends with "if unsure": the safe default is always to leave PayRekha up-but-unready (fail closed) rather than restart into a guessed state.

## PayrekhaDown / PayrekhaNotReady (critical)

`up == 0`, or `payrekha_ready == 0` — serving 503 on every API call. With Envoy `failure_mode_allow: false` this also 403s payouts at the edge.

1. `kubectl logs deploy/payrekha --tail=100`. The unready reason is logged (`state unreadable`, `state written by another instance`).
2. `state unreadable` — the snapshot cannot be read. Check the PVC/PG connectivity. **Do not delete the state file** — it may be the only copy of HIGH_ALERT and spent intents. PayRekha retries every `PAYREKHA_STATE_RETRY_MS` and readies itself when the store returns.
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

| Key                         | Blast radius                                      | Do                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payout API key              | It can only evaluate (+ report its own outcomes)  | Mint a replacement key id, remove the old entry from `PAYREKHA_API_KEYS`, rolling restart. Its `sourceKeyId` name is burned — do not reuse it.                                                                                                                                  |
| Intent-signing (issuer) key | Attacker can mint intents within that key's kinds | `DELETE /v1/issuers/<keyId>` (admin, reason required) — kills every intent it signed immediately and the revocation persists in the snapshot. Then roll a **new** keyId through config (a revoked keyId is a tombstone, never reused) and have the LOS re-sign pending intents. |
| Admin token                 | Mode downgrade to shadow, HIGH_ALERT reset        | Rotate `PAYREKHA_ADMIN_KEY`, rolling restart, then audit the decision log `type:"audit"` entries for `mode.set`/`alert.reset` you didn't make.                                                                                                                                  |
| Hash key                    | Beneficiary refs become unlinkable                | Rotate requires re-keying all stored refs — plan this as a maintenance, not an incident fix; keep the old key until refs rotate.                                                                                                                                                |

## Incident response — reporting to CERT-In / CSIRT-Fin and I4C

CIAD-2026-0058 obligates affected entities to report suspicious activity to CERT-In/CSIRT-Fin (`incident@cert-in.org.in`) with relevant logs, and bulk fraudulent transactions to I4C's Cyber Fraud Mitigation Centre (CFCFRMS portal). PayRekha's decision log is the evidence bundle for the payout surface — it carries hashed refs only, so it is safe to attach.

1. **Isolate** — the affected host is yours to quarantine; PayRekha's part is `PUT /v1/state {"highAlert":"raise","actor":"<you>","reason":"INC-<id>"}` so every payout needs an intent while you work.
2. **Preserve** — copy the decision log and snapshot somewhere write-once before anything rotates:

   ```bash
   cp "$PAYREKHA_DECISION_LOG" /evidence/decisions-$(date +%s).jsonl
   cp "$PAYREKHA_STATE_FILE" /evidence/state-$(date +%s).json   # if file backend
   ```

3. **Extract the timeline** — every step of the attack chain is in the log:

   ```bash
   # every decision touching the suspect key in the window
   jq -c 'select(.type=="decision" and .sourceKeyId=="<key-id>")' decisions.jsonl
   # blocked/held payouts with rules and evidence
   jq -c 'select(.type=="decision" and .verdict!="ALLOW") | {ts,payoutId,kind,amountPaise,rules,origin,alertState}' decisions.jsonl
   # admin/audit events: who raised or reset what, denied outcome reports
   jq -c 'select(.type=="audit")' decisions.jsonl
   # the probe chain: micro then large to one beneficiary
   jq -c 'select(.type=="decision" and (.rules|index("probe.micro-then-large") != null))' decisions.jsonl
   ```

4. **Rotate credentials** — see "Credential compromise" above: revoke issuer keys with `DELETE /v1/issuers/<keyId>` (tombstoned, survives restarts), rotate `PAYREKHA_API_KEYS` entries, rotate `PAYREKHA_ADMIN_KEY` if admin actions look foreign.
5. **Report** — CERT-In/CSIRT-Fin at `incident@cert-in.org.in` (attach the extracted timeline + audit lines); bulk fraudulent transactions via I4C's CFCFRMS portal. Note in the report that beneficiary refs are `hb1_` keyed-HMAC hashes — share raw identifiers only through the legally required channels, from your own records.

## Promoting the standby (manual failover)

One writer only. Promote a standby by scaling the fenced/down active to 0 first, then the standby up — never two writers at once. The standby serves 503 until it has read the snapshot (`/readyz` green = it is serving the _restored_ state, not a guess).

## Capacity envelope (measured — `npm run loadcheck`)

Full table, methodology and tuning guidance: `docs/capacity-envelope.md`.
Headline numbers (dev host, enforce mode, behaviour rules + intent checks):

| State size                                      | eval p99 | snapshot export stall (sync) | serialize wall (off-loop) | heap after run |
| ----------------------------------------------- | -------- | ---------------------------- | ------------------------- | -------------- |
| 20k intents / 50k beneficiaries (~12 MB snap)   | ~32 µs   | ~6 ms                        | ~82 ms                    | ~124 MB        |
| 100k intents / 200k beneficiaries (~56 MB snap) | ~34 µs   | ~60 ms                       | ~340 ms                   | ~613 MB        |

B3 sliced serialization + HMAC off the event loop — the residual sync pause
is `exportState()` alone (linear in snapshot bytes; ~1% duty at 56 MB on the
default 5 s interval, tunable via `PAYREKHA_STATE_INTERVAL_MS`). Watch
`payrekha_eval_latency_micros` p99, `payrekha_state_save_ms_max`, and pod RSS
against the 512 Mi limit on day one — dedupe entries grow toward their cap
under unique payoutIds, so heap is driven by payout _rate_, not just
beneficiary count. If export ms climbs toward ~250 ms the next step is
per-section sharding, not a torn export — see the envelope doc.

## Rollback

Redeploy the previous image. State snapshots are forward-readable by older builds within the same minor line; if the snapshot format changed, restore from the pre-upgrade file copy you made (you did make one — it's in the deploy step).
