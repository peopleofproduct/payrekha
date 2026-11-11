# Decision-log schema & integrity

One JSON object per line in `decisions.jsonl` (or CEF when
`PAYREKHA_DECISION_LOG_FORMAT=cef` — decisions stay JSON-parseable).
Two record types share the file: `decision` (every evaluated payout) and
`audit` (mode/alert changes, denied outcomes, admin actions).

## `decision` record (packages/gateway/src/log.ts)

| Field                               | Type                    | Meaning                                                                                                                                                     |
| ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                              | `"decision"`            | discriminator                                                                                                                                               |
| `ts`                                | ISO-8601                | gateway evaluation time                                                                                                                                     |
| `requestId`                         | string                  | per-request id (from caller or generated)                                                                                                                   |
| `decisionId`                        | string                  | **stable across retries** — same payoutId + same state ⇒ same decisionId; a replayed decision replays the id, which is how auditors see dedupe              |
| `payoutId`                          | string ≤128             | caller's idempotency key                                                                                                                                    |
| `via`                               | `evaluate \| ext_authz` | which API path produced it                                                                                                                                  |
| `kind`, `amountPaise`, `merchantId` | optional                | echoed from the payout (amount is integer paise)                                                                                                            |
| `beneficiaryRef`                    | `hb1_…` or absent       | keyed-HMAC only — a raw-looking beneficiary is **dropped at log time** (`safe()` in `decisionRecord`); no code path can write a raw account/VPA/mobile here |
| `intentId`                          | string                  | intent the payout bound to, if any                                                                                                                          |
| `sourceKeyId`                       | string                  | API-key id — gateway-asserted, never caller-supplied on `/v1/evaluate`                                                                                      |
| `origin`                            | `prod\|nonprod`         | key/edge-asserted, never body-supplied                                                                                                                      |
| `sourceHint`                        | string                  | **untrusted** edge hint (peer IP / proxy headers) — evidence, not identity                                                                                  |
| `clientTimestampMs`                 | number                  | caller's claimed ts when overridden — recorded for skew forensics                                                                                           |
| `mode`, `alertState`                | strings                 | effective mode (`shadow`/`advise`/`enforce`) and alert at verdict time                                                                                      |
| `verdict`                           | `ALLOW\|REVIEW\|BLOCK`  | what the engine decided                                                                                                                                     |
| `effectiveAction`                   | `ALLOW\|HOLD\|DECLINE`  | what the caller was told to do — in shadow this is always `ALLOW` even for `BLOCK` verdicts                                                                 |
| `degraded`                          | bool                    | a rule threw or input was malformed — verdict is conservative                                                                                               |
| `deduped`                           | bool                    | answered from tombstone/shared stored-verdict rather than re-evaluated                                                                                      |
| `rules`                             | string[]                | rule ids that hit                                                                                                                                           |
| `hits`                              | object[]                | per-hit `{rule, verdict, detail}`                                                                                                                           |
| `ruleErrors`                        | string[]                | rules that threw (counted in `payrekha_rule_errors_total`)                                                                                                  |
| `elapsedMicros`                     | number                  | evaluate-path latency                                                                                                                                       |

## `audit` record

`{type:"audit", ts, actor, action, detail}` — actor is the admin key id
or `system`; actions include `mode.set`, `alert.enter`, `alert.reset`,
`issuer.revoked`, `outcome.denied`, snapshot save/load events.

## Integrity story — what an auditor should verify

1. **Append-only by construction**: the file is opened `flags:'a'`,
   mode `0600`; no code path truncates or rewrites it.
2. **Writes are fire-and-forget**: the verdict never waits on the log —
   the trade an auditor should know is that `payrekha_decision_log_errors_total`
   rising means a _gap window_ exists; investigate before attesting that
   window (`failure-modes.md`).
3. **State snapshots are HMAC-signed** (`PAYREKHA_STATE_HMAC_KEY`,
   `verifyAndUnwrap`): a tampered state file fails verification at boot —
   the _log_ is not itself signed; sign/ship it externally (SIEM
   forwarding — drill D7 — gives you a second tamper-evident copy).
4. **Reconstruction**: `npm run replay -- --decisions decisions.jsonl`
   rebuilds the timeline; `evidence-extraction.md` has the exact jq for
   a CERT-In/I4C incident report.
5. **Retention is operator policy**: the log grows unbounded; rotation
   and archival are your SIEM/logrotate story (production checklist).

## Minimal jq for a spot check

```sh
# verdict mix
jq -r 'select(.type=="decision") | .verdict' decisions.jsonl | sort | uniq -c
# any raw-beneficiary leak (must print nothing)
grep -c 'hb1_' decisions.jsonl; grep -cv 'hb1_\|"beneficiaryRef"' decisions.jsonl
```
